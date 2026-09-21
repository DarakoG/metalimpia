/*
 * MetaLimpia — Privacy Verifier
 *
 * Phase 7.3 — turns the Phase 1 static "0 conexiones externas"
 * placeholder into a live monitor of every resource the browser
 * has loaded for this page.
 *
 * Source of truth: the browser's `performance.getEntriesByType('resource')`
 * API. Every same-origin entry counts as an internal resource; every
 * cross-origin entry would be an alarm. In correct operation the
 * cross-origin count is always 0 — the alarm state is here so a
 * privacy regression (e.g. someone accidentally adding a CDN script
 * tag) flips the verifier into a red, visible alert instead of
 * silently staying green.
 *
 * Public API (per Data Model §5.2 + the Phase 7.3 brief):
 *
 *   initVerifier({ container })
 *     Returns a controller with:
 *       - getReport() : PrivacyReport (externalCount, internalResources,
 *                       lastUpdated) — synchronous snapshot of the
 *                       current state.
 *       - destroy()   : tear down the polling interval and stop
 *                       reading performance entries.
 *
 * The function does NOT own the toggle button — the toggle is
 * already wired with the click handler in this module's init()
 * call so the orchestrator does not have to know about the
 * widget's internal DOM structure.
 *
 * Privacy stance (per TRD §6.5):
 *   - No innerHTML with user data. Every dynamic value is set via
 *     textContent. The single innerHTML use is `listEl.innerHTML = ''`
 *     to clear the list between renders — this is the standard
 *     "reset container" pattern documented across the rest of the
 *     codebase (see js/ui/metadataView.js, doneView.js, etc.).
 *   - No fetch / XMLHttpRequest / WebSocket / EventSource — the
 *     verifier is purely a consumer of browser APIs.
 *   - No localStorage / sessionStorage / cookies. The verifier is
 *     stateless across renders.
 *
 * Polling cadence: 1 second. This is short enough that a freshly
 * loaded WASM (after the user's first file drop) appears in the
 * resource list within ~1 s, and long enough that the verifier
 * does not produce visible jank.
 */

import { t } from '../i18n.js';

/**
 * Default poll interval (ms). Per Phase 7.3 brief: "Re-runs the
 * count periodically (every 1s) so newly loaded resources (e.g.,
 * the lazy WASM after first file drop) are reflected."
 */
const POLL_INTERVAL_MS = 1000;

/**
 * @typedef {import('../i18n.js')} i18n
 *
 * @typedef {Object} ResourceInfo
 * @property {string} name — basename of the loaded URL
 *   (e.g. "main.js", "styles.css", "exiftool.wasm")
 * @property {string} origin — always equal to window.location.origin
 *   in correct operation
 * @property {'script'|'style'|'image'|'wasm'|'font'|'fetch'|'other'} type
 * @property {number} size — bytes transferred (transferSize) or
 *   encoded body size as a fallback for cached / cross-origin
 *   resources where transferSize is 0
 * @property {number} loadTime — duration in ms (rounded)
 *
 * @typedef {Object} PrivacyReport
 * @property {number} externalCount — count of resources whose
 *   origin differs from window.location.origin. Should be 0 in
 *   correct operation; a non-zero value flips the verifier into
 *   the alarm state.
 * @property {ResourceInfo[]} internalResources
 * @property {number} lastUpdated — Date.now() at render time
 */

/**
 * Initialize the privacy verifier widget.
 *
 * @param {Object} options
 * @param {HTMLElement} options.container — the `.verifier` root
 *   element. The verifier reads existing child elements by id /
 *   class (it does not rebuild the markup — Phase 1 already
 *   shipped the static structure).
 * @returns {{ getReport: () => PrivacyReport, destroy: () => void }}
 */
export function initVerifier({ container } = {}) {
  if (!container || !(container instanceof HTMLElement)) {
    throw new Error('privacyVerifier: container must be an HTMLElement');
  }

  const summaryEl = /** @type {HTMLElement|null} */ (
    container.querySelector('.verifier-summary')
  );
  const listEl = /** @type {HTMLElement|null} */ (
    container.querySelector('.verifier-list')
  );
  const toggle = /** @type {HTMLButtonElement|null} */ (
    container.querySelector('#verifier-toggle')
  );
  const detail = /** @type {HTMLElement|null} */ (
    container.querySelector('#verifier-detail')
  );
  const labelEl = toggle ? toggle.querySelector('.verifier-toggle-label') : null;

  if (!summaryEl || !listEl || !toggle || !detail || !labelEl) {
    // Fail loudly during development if the markup drifts away
    // from the contract the verifier expects. In production the
    // browser will not crash; we just log and bail.
    // eslint-disable-next-line no-console
    console.warn('MetaLimpia verifier: required child elements missing');
    return {
      getReport: () => ({
        externalCount: 0,
        internalResources: [],
        lastUpdated: Date.now(),
      }),
      destroy: () => {},
    };
  }

  // Wire the toggle once. Subsequent re-inits (none expected
  // in MVP, but defensive) would re-add the listener and
  // double-fire; we tag the container so we don't.
  if (!container.dataset.verifierWired) {
    toggle.addEventListener('click', onToggleClick);
    container.dataset.verifierWired = 'true';
  }

  function onToggleClick() {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    const next = !isExpanded;
    toggle.setAttribute('aria-expanded', String(next));
    detail.hidden = !next;
    labelEl.textContent = next ? t('verifier.collapse') : t('verifier.expand');
  }

  // First render synchronously so the user sees correct data
  // even before the first 1-second tick fires.
  render();

  // Periodic polling. setInterval returns a number in browsers;
  // we type-cast for clarity.
  /** @type {number|null} */
  let intervalId = window.setInterval(render, POLL_INTERVAL_MS);

  /**
   * Build a PrivacyReport snapshot from the current Performance API state.
   *
   * @returns {PrivacyReport}
   */
  function buildReport() {
    const entries = readResourceEntries();
    const pageOrigin = window.location.origin;
    /** @type {ResourceInfo[]} */
    const internalResources = [];
    let externalCount = 0;

    for (const entry of entries) {
      const url = entry.name || '';
      let entryOrigin = '';
      try {
        entryOrigin = new URL(url, window.location.href).origin;
      } catch {
        // Malformed URL — skip. Should never happen for resources
        // the browser actually loaded, but defensive.
        continue;
      }

      // The URL constructor returns 'null' as origin for
      // file://, blob:, data:, etc. Treat those as "not external
      // to a meaningful origin" — neither internal nor external
      // for the user's mental model. Blob: URLs we create
      // ourselves (the cleaned-file download) do NOT appear in
      // performance entries because they are not loaded as
      // resources; only the same-origin createObjectURL call
      // is on the main thread.
      if (entryOrigin === 'null' || entryOrigin === '') continue;

      if (entryOrigin === pageOrigin) {
        internalResources.push(toResourceInfo(entry));
      } else {
        externalCount += 1;
      }
    }

    return {
      externalCount,
      internalResources,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Render the current PrivacyReport into the DOM.
   *
   * - Updates the summary line ("0 conexiones externas" or
   *   "{count} conexiones externas").
   * - Flips the alarm class when externalCount > 0.
   * - Rebuilds the resource list from scratch.
   *
   * The list rebuild is the single point where we use
   * `listEl.innerHTML = ''` to clear before re-rendering.
   * That is the "clear container" pattern documented across
   * the rest of the codebase (see js/ui/metadataView.js,
   * doneView.js, errorView.js, analyzingView.js). Every
   * subsequent child element is created with DOM APIs and
   * populated with textContent — no user-derived strings are
   * ever assigned to innerHTML.
   */
  function render() {
    const report = buildReport();
    renderSummary(summaryEl, report);
    renderList(listEl, report);
    return report;
  }

  /**
   * Format bytes for the resource list. Mirrors the convention
   * used by DevTools so the verifier reads like a familiar tool.
   *
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Tear down the verifier: stop the polling interval. Safe to
   * call multiple times.
   */
  function destroy() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  return {
    getReport: () => buildReport(),
    destroy,
  };

  // ----------------------------------------------------------------
  // helpers below — kept in the closure so they cannot be called
  // outside the verifier lifecycle.
  // ----------------------------------------------------------------

  /**
   * Read performance entries safely. Older browsers may not
   * expose `performance.getEntriesByType`; we return an empty
   * array in that case so the verifier degrades to "0 resources
   * loaded" instead of throwing.
   *
   * @returns {PerformanceResourceTiming[]}
   */
  function readResourceEntries() {
    if (
      typeof performance === 'undefined' ||
      typeof performance.getEntriesByType !== 'function'
    ) {
      return [];
    }
    try {
      // The Performance API may throw if the page is navigated
      // mid-call. Treat as "no entries" so the verifier stays
      // stable across transitions.
      return /** @type {PerformanceResourceTiming[]} */ (
        performance.getEntriesByType('resource')
      );
    } catch {
      return [];
    }
  }

  /**
   * Convert a PerformanceResourceTiming entry to the ResourceInfo
   * shape from Data Model §5.2.
   *
   * @param {PerformanceResourceTiming} entry
   * @returns {ResourceInfo}
   */
  function toResourceInfo(entry) {
    let name = entry.name || '';
    try {
      const parsed = new URL(entry.name, window.location.href);
      // Use the basename for legibility (the verifier list is
      // meant to read like DevTools' "Name" column). Fall back
      // to the full pathname for resources without a basename
      // (e.g. trailing-slash URLs).
      const basename = parsed.pathname.split('/').filter(Boolean).pop();
      name = basename || parsed.pathname || parsed.href;
    } catch {
      // keep original
    }
    return {
      name,
      origin: window.location.origin,
      type: classifyType(entry),
      size:
        typeof entry.transferSize === 'number' && entry.transferSize > 0
          ? entry.transferSize
          : typeof entry.encodedBodySize === 'number'
            ? entry.encodedBodySize
            : 0,
      loadTime: Math.round(entry.duration || 0),
    };
  }

  /**
   * Classify a resource entry into the ResourceInfo.type union.
   * Uses initiatorType when available; falls back to URL extension
   * heuristics so WASM and CSS imports are typed correctly.
   *
   * @param {PerformanceResourceTiming} entry
   * @returns {ResourceInfo['type']}
   */
  function classifyType(entry) {
    const initiator = (entry.initiatorType || '').toLowerCase();
    if (initiator === 'script') return 'script';
    if (initiator === 'link' || initiator === 'style') return 'style';
    if (initiator === 'img' || initiator === 'image') return 'image';
    if (initiator === 'font') return 'font';
    if (initiator === 'fetch' || initiator === 'xmlhttprequest') return 'fetch';

    // Vite-served Worker scripts report initiatorType === 'other'
    // (the browser does not surface the worker import as a normal
    // resource). WASM is also 'other'. Use URL extension as a
    // tie-breaker.
    const url = (entry.name || '').toLowerCase();
    if (url.endsWith('.wasm')) return 'wasm';
    if (url.endsWith('.css')) return 'style';
    if (url.endsWith('.js') || url.endsWith('.mjs')) return 'script';
    if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') ||
        url.endsWith('.gif') || url.endsWith('.svg') || url.endsWith('.webp')) {
      return 'image';
    }
    if (url.endsWith('.woff') || url.endsWith('.woff2') || url.endsWith('.ttf')) {
      return 'font';
    }
    return 'other';
  }

  /**
   * @param {HTMLElement} el
   * @param {PrivacyReport} report
   */
  function renderSummary(el, report) {
    const key =
      report.externalCount === 0
        ? 'verifier.summary.zero'
        : 'verifier.summary.nonzero';
    el.textContent = t(key, { count: report.externalCount });
    const isAlarm = report.externalCount > 0;
    el.classList.toggle('verifier-summary--alarm', isAlarm);
    el.setAttribute('data-external-count', String(report.externalCount));
    // Defensive a11y: the dot indicator (the small green circle
    // next to the verifier title) also flips red on alarm.
    const dot = container.querySelector('.verifier-title-dot');
    if (dot) {
      dot.classList.toggle('verifier-title-dot--alarm', isAlarm);
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {PrivacyReport} report
   */
  function renderList(el, report) {
    // Standard "clear container" pattern. Every child below is
    // created via DOM APIs and populated with textContent — no
    // user-derived strings are assigned to innerHTML.
    el.innerHTML = '';

    if (report.internalResources.length === 0) {
      const li = document.createElement('li');
      li.className = 'verifier-list-empty';
      li.textContent = t('verifier.list.empty');
      el.appendChild(li);
      return;
    }

    // Use a fragment so the live list updates as a single DOM
    // mutation (one reflow, no flicker between rows).
    const fragment = document.createDocumentFragment();
    for (const resource of report.internalResources) {
      fragment.appendChild(buildResourceRow(resource));
    }
    el.appendChild(fragment);
  }

  /**
   * Build one <li> for the resource list. Pure DOM construction,
   * textContent only — no innerHTML with data.
   *
   * @param {ResourceInfo} resource
   * @returns {HTMLLIElement}
   */
  function buildResourceRow(resource) {
    const li = document.createElement('li');
    li.className = 'verifier-list-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'verifier-list-item-name';
    nameEl.textContent = resource.name;

    const metaEl = document.createElement('span');
    metaEl.className = 'verifier-list-item-meta';
    metaEl.textContent =
      `${resource.type} · ${formatBytes(resource.size)} · ${resource.loadTime} ms`;

    li.appendChild(nameEl);
    li.appendChild(metaEl);
    return li;
  }
}
