/*
 * MetaLimpia — entry point / orchestrator
 *
 * Phase 6: canonicalises the AppState union from Data Model §3.1
 * (no more `phase` on `analyzing` / `downloadName` on `done` —
 * those are render hints, not state). Adds browser-too-old
 * detection on boot, centralises every transition through
 * `setState`, and prepares the orchestrator for focus management
 * (Phase 6.8) and edge-case coverage (Phase 6.10).
 *
 * Pipeline on a valid file drop:
 *
 *   1. Validate the file (Phase 2 unchanged).
 *   2. Read into pendingBuffer (Phase 2 unchanged).
 *   3. Generate a session-scoped fileId via crypto.randomUUID.
 *   4. setState({ view: 'analyzing', file }) with render hint
 *      `analyzingPhase = 'loading'`
 *      → WASM download + Worker init.
 *   5. setState({ view: 'analyzing', file }) with render hint
 *      `analyzingPhase = 'reading'`
 *      → ExifTool read op.
 *   6. Read raw ExifTool JSON → metadataParser.parseExiftoolOutput
 *      → setState({ view: 'results', file, metadata }).
 *   7. User clicks "Borrar todo" or "Borrar seleccionados":
 *      a. setState({ view: 'processing', file, selection })
 *         → Worker `write` op with the live tagsToRemove.
 *      b. On success → setState({ view: 'done', file,
 *                                 cleanedBuffer, removedCount }).
 *         The download button triggers a same-origin Blob URL
 *         download (js/ui/downloader.js). The "Procesar otro
 *         archivo" button returns to landing.
 *      c. On failure → setState({ view: 'error', errorKey })
 *         mapped from the Worker's error code.
 *
 * View states exercised by this orchestrator (Flow §2.1):
 *
 *   landing     — dropzone visible
 *   analyzing   — analyzingPhase 'loading' or 'reading' message;
 *                 dropzone hidden. Render hint only.
 *   results     — metadata list with checkboxes, collapse/expand,
 *                 sensitive badges, and action bar (Borrar todo /
 *                 Borrar seleccionados / Cambiar archivo).
 *   processing  — spinner card with "Limpiando archivo..." while
 *                 the Worker runs the write op.
 *   done        — confirmation card with the cleaned count, a
 *                 "Descargar" primary action, and a "Procesar otro
 *                 archivo" secondary action.
 *   error       — dropzone hidden, error card with back button.
 *
 * The AppState shape is the canonical discriminated union from
 * Data Model §3.1. Render hints (analyzingPhase) and module-
 * local storage (pendingBuffer, lastSelection, activeFileId) live
 * OUTSIDE the state so the discriminated union stays clean.
 */

import { init as initI18n, t } from './i18n.js';
import { validateFile, readFile } from './fileHandler.js';
import { wireUploader } from './ui/uploader.js';
import { renderErrorView } from './ui/errorView.js';
import { renderAnalyzingView } from './ui/analyzingView.js';
import { renderResults } from './ui/metadataView.js';
import { renderDoneView } from './ui/doneView.js';
import { buildCleanedFilename, triggerDownload } from './ui/downloader.js';
import { parseExiftoolOutput } from './metadataParser.js';
import { loadExiftool, readMetadata, writeMetadata, terminateWorker } from './exiftoolLoader.js';

/**
 * Canonical AppState — Data Model §3.1 discriminated union.
 *
 *   { view: 'landing' }
 *   | { view: 'analyzing'; file: File }
 *   | { view: 'results'; file: File; metadata: FileMetadata }
 *   | { view: 'processing'; file: File; selection: MetadataSelection }
 *   | { view: 'done'; file: File; cleanedBuffer: ArrayBuffer; removedCount: number }
 *   | { view: 'error'; errorKey: string; context?: Record<string, unknown> }
 *
 * @typedef {Object} AppStateLanding
 * @property {'landing'} view
 *
 * @typedef {Object} AppStateAnalyzing
 * @property {'analyzing'} view
 * @property {File} file
 *
 * @typedef {Object} AppStateResults
 * @property {'results'} view
 * @property {File} file
 * @property {import('./metadataParser.js').FileMetadata} metadata
 *
 * @typedef {Object} AppStateProcessing
 * @property {'processing'} view
 * @property {File} file
 * @property {{ removeAll: boolean, tagsToRemove: string[] }} selection
 *
 * @typedef {Object} AppStateDone
 * @property {'done'} view
 * @property {File} file
 * @property {ArrayBuffer} cleanedBuffer
 * @property {number} removedCount
 *
 * @typedef {Object} AppStateError
 * @property {'error'} view
 * @property {string} errorKey
 * @property {Record<string, unknown>=} context
 *
 * @typedef {AppStateLanding | AppStateAnalyzing | AppStateResults | AppStateProcessing | AppStateDone | AppStateError} AppState
 */

/** @type {AppState} */
let state = { view: 'landing' };

/**
 * Render hint for the `analyzing` view. The canonical state has
 * a single `analyzing` shape; the orchestrator swaps which
 * spinner message ("Inicializando ExifTool..." vs "Analizando
 * metadatos...") is shown by updating this hint and re-rendering,
 * without adding a `phase` field to the discriminated union.
 * Reset to `null` on every transition out of `analyzing`.
 *
 * @type {'loading' | 'reading' | null}
 */
let analyzingPhase = null;

// Holds the ArrayBuffer of the file that the user dropped.
// Phase 3 hands it to the ExifTool worker. Phase 5 also
// reuses it as the input to the write op (the Worker
// re-reads the bytes; we never feed the cleaned buffer back
// into a second write). Cleared on every transition back to
// landing so memory is released between rounds.
let pendingBuffer = null;

// Cached last selection. Phase 5 does NOT rely on this for
// the write path — the metadataView passes the live selection
// in the onRemove payload (see js/ui/metadataView.js). This
// variable is kept for future analytics / Phase 6 keyboard
// shortcut work and so the onSelectionChange contract from
// Phase 4 stays intact.
let lastSelection = null;

// Session-scoped file id. Generated locally via
// crypto.randomUUID() so it tracks the file across the
// landing → analyzing → results transitions without
// leaking to the network. Data Model §3.2 (UserFile.id).
let activeFileId = null;

/**
 * Replace the current state, then re-render the view.
 *
 * Every transition in the app goes through here, so this is
 * the single place where:
 *   - the previous state's transient storage (pendingBuffer,
 *     lastSelection, activeFileId) gets released on the way
 *     back to landing;
 *   - the render hint (analyzingPhase) gets reset on the way
 *     out of `analyzing`;
 *   - focus management (Phase 6.8) can hook in one place.
 *
 * @param {AppState} next
 */
function setState(next) {
  state = next;

  // Out-of-analyzing: clear the render hint so a future
  // transition back to analyzing starts fresh.
  if (next.view !== 'analyzing') {
    analyzingPhase = null;
  }

  render();
}

/**
 * Update the render hint for the current `analyzing` state
 * without changing the discriminated union shape. Re-renders
 * so the spinner message swaps ("Inicializando ExifTool..." →
 * "Analizando metadatos...").
 *
 * @param {'loading' | 'reading'} phase
 */
function setAnalyzingPhase(phase) {
  if (state.view !== 'analyzing') return;
  analyzingPhase = phase;
  render();
}

/**
 * Render the current state into the DOM. Idempotent —
 * safe to call multiple times.
 *
 * Phase 6.7 — sets aria-busy on the view container for the
 * two async views (analyzing + processing). Screen readers
 * suspend their live-region announcements while aria-busy is
 * true and re-announce when it flips to false, so this keeps
 * partial-phase swaps ("Inicializando..." → "Analizando...")
 * from being announced as separate events.
 *
 * Phase 6.1 — the canonical state does NOT carry `phase` or
 * `downloadName`. Both are computed here (render hint +
 * buildCleanedFilename) instead of being stored on the state.
 */
function render() {
  const app = document.getElementById('app');
  const dropzoneSection = document.querySelector('.dropzone-section');
  const viewContainer = document.getElementById('view-container');
  if (!app || !dropzoneSection || !viewContainer) return;

  app.dataset.view = state.view;

  const isAsyncView =
    state.view === 'analyzing' || state.view === 'processing';
  viewContainer.setAttribute('aria-busy', String(isAsyncView));

  if (state.view === 'landing') {
    dropzoneSection.hidden = false;
    viewContainer.hidden = true;
    viewContainer.innerHTML = '';
    // Drop any in-memory buffer from a previous round so
    // memory is released between file picks (Data Model §7.2).
    pendingBuffer = null;
    lastSelection = null;
    activeFileId = null;
    return;
  }

  // error / analyzing / processing / results / done all hide
  // the dropzone and show the shared view container. Each
  // renderer resets the container itself, so we never
  // accumulate DOM nodes across transitions.
  dropzoneSection.hidden = true;
  viewContainer.hidden = false;
  viewContainer.innerHTML = '';

  if (state.view === 'error') {
    renderErrorView(viewContainer, state.errorKey, state.context, {
      onBack: () => setState({ view: 'landing' }),
    });
    return;
  }

  if (state.view === 'analyzing') {
    renderAnalyzingView(viewContainer, { phase: analyzingPhase });
    return;
  }

  if (state.view === 'processing') {
    // Reuses the analyzing card layout (same spinner / same
    // card) but with the Phase 5 'processing.message' i18n
    // key, picked by analyzingView's phase-based lookup.
    // Phase 6.6 — pass onCancel so the user can abort the
    // in-flight Worker write op and return to landing.
    renderAnalyzingView(
      viewContainer,
      { phase: 'processing' },
      { onCancel: handleCancelProcessing }
    );
    return;
  }

  if (state.view === 'results') {
    renderResults(viewContainer, state.file, state.metadata, {
      onBack: () => setState({ view: 'landing' }),
      onRemove: handleRemove,
      onSelectionChange: (selection) => {
        lastSelection = selection;
      },
    });
    return;
  }

  if (state.view === 'done') {
    // downloadName is computed on render from file.name per
    // Data Model §5.1 (CleanedFile.downloadName). The state
    // does not carry it; storing it would duplicate a
    // derivable value.
    const downloadName = buildCleanedFilename(state.file.name);
    renderDoneView(viewContainer, state.file, {
      cleanedBuffer: state.cleanedBuffer,
      removedCount: state.removedCount,
      downloadName,
    }, {
      onDownload: () => {
        triggerDownload(
          state.cleanedBuffer,
          downloadName,
          state.file && state.file.type ? state.file.type : undefined
        );
      },
      onAnother: () => setState({ view: 'landing' }),
    });
    return;
  }
}

/**
 * Generate a session-scoped id for a dropped file. Uses
 * `crypto.randomUUID()` when available (every browser we
 * support — Phase 9's targets all have it), falling back
 * to a timestamp + Math.random() combination in the very
 * unlikely case it isn't present.
 */
function generateFileId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Ignore — fall through.
  }
  return `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildErrorContext(errorKey, file) {
  if (errorKey === 'too_large') {
    return { size: Math.round(file.size / (1024 * 1024)) };
  }
  if (errorKey === 'unsupported_format') {
    return { formats: t('errors.formatsList') };
  }
  return {};
}

/**
 * Map an exiftoolLoader error code to the errorKey string
 * the orchestrator stores on the AppState.error state. The
 * errorView.js ERROR_I18N_KEYS table maps this string to a
 * locale key (or falls back to errors.workerCrashed).
 *
 * Phase 6 normalises the orchestrator's error keys to the
 * snake_case codes the Data Model §3.5 Worker protocol uses
 * — the loader's `write_failed` no longer aliases to the
 * camelCase 'writeFailed' that Phase 5 introduced.
 *
 *   - 'wasm_load_failed' → engine never came up
 *   - 'corrupted'        → exiftool could not parse the file
 *   - 'unsupported'      → exiftool refused the file type
 *   - 'write_failed'     → exiftool refused to write the cleaned copy
 *   - 'crashed'          → unhandled throw inside the Worker
 *                          (write/read runtime issue)
 *   - anything else      → treat as generic worker_crashed
 */
function mapLoaderErrorToI18nKey(code) {
  if (code === 'wasm_load_failed') return 'wasm_load_failed';
  if (code === 'corrupted') return 'corrupted';
  if (code === 'unsupported') return 'unsupported';
  if (code === 'write_failed') return 'write_failed';
  if (code === 'crashed') return 'crashed';
  return 'worker_crashed';
}

/**
 * Orchestrate the Worker `write` op from the results view's
 * action bar. Called with the live selection payload from
 * metadataView (Data Model §3.4 / Implementation Plan §8
 * task 5.6).
 *
 * Flow:
 *   1. Snapshot the file reference so we can render the
 *      processing card if the user clicks mid-transition.
 *   2. Switch to the 'processing' view so the user sees the
 *      Phase 5 "Limpiando archivo..." spinner card.
 *   3. Call writeMetadata with the live tagsToRemove /
 *      removeAll pair. The Worker runs exiftool with
 *      `-unsafe -All= -o <tmp> <in>` (removeAll) or
 *      `-Tag= -o <tmp> <in>` (selective) per Phase 5.1.
 *   4. On success → 'done' view with the cleaned buffer
 *      and the user-visible "removed" count (number of
 *      tags the user asked to remove).
 *   5. On failure → 'error' view mapped through
 *      mapLoaderErrorToI18nKey.
 *
 * @param {{removeAll: boolean, fileId?: string, tagsToRemove?: string[] | null}} payload
 */
async function handleRemove(payload) {
  const removeAll = Boolean(payload && payload.removeAll);
  const tagsToRemove =
    payload && Array.isArray(payload.tagsToRemove)
      ? payload.tagsToRemove
      : [];

  // Need a file reference + buffer to write. The results
  // view only mounts when state has both, so this should
  // always be set; the guard is for robustness.
  const file = state.view === 'results' ? state.file : null;
  if (!file || !pendingBuffer) {
    setState({
      view: 'error',
      errorKey: 'worker_crashed',
    });
    return;
  }

  setState({
    view: 'processing',
    file,
    selection: { removeAll, tagsToRemove },
  });

  try {
    const cleanedBuffer = await writeMetadata(pendingBuffer, file.name, {
      removeAll,
      tagsToRemove,
    });

    // "Se eliminaron N metadatos." — the count is what the
    // user ASKED to remove, not what ExifTool actually
    // erased (we do not re-read the file to count). For
    // removeAll that equals state.metadata.totalCount; for
    // selective it equals tagsToRemove.length. Edge case:
    // an empty metadata file with removeAll → totalCount
    // is 0 and we still produce a download.
    const removedCount = removeAll
      ? state.metadata.totalCount
      : tagsToRemove.length;

    setState({
      view: 'done',
      file,
      cleanedBuffer,
      removedCount,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia: writeMetadata failed', err);
    setState({
      view: 'error',
      errorKey: mapLoaderErrorToI18nKey(err && err.code),
    });
  }
}

/**
 * Phase 6.6 — Cancel the in-flight processing write op.
 *
 * Kills the ExifTool Worker (so its pending WASM write
 * stops), resets the loader's memoisation so the next file
 * drop spawns a fresh Worker, and returns to landing. The
 * orchestrator's awaiting `handleRemove` promise stays
 * pending forever; the GC reclaims it when the page unloads
 * because nothing in the new state machine references it.
 */
function handleCancelProcessing() {
  terminateWorker();
  setState({ view: 'landing' });
}

/**
 * File-handling pipeline. Called by the uploader with
 * exactly one file per drop or pick.
 */
async function handleFile(file) {
  if (!file) return;

  const result = validateFile(file);
  if (!result.ok) {
    setState({
      view: 'error',
      errorKey: result.error,
      context: buildErrorContext(result.error, file),
    });
    return;
  }

  try {
    pendingBuffer = await readFile(file);
    // Generate a session-scoped id for this file. Used by
    // the parser (FileMetadata.fileId) and threaded through
    // to Phase 5's MetadataSelection.
    activeFileId = generateFileId();
  } catch (err) {
    // The browser rejected the read (e.g. the user revoked
    // the permission mid-pick). Treat as a corrupted file
    // for the user; the orchestrator stays the same.
    // eslint-disable-next-line no-console
    console.warn('MetaLimpia: file read failed', err);
    setState({ view: 'error', errorKey: 'corrupted' });
    return;
  }

  // Phase 3 pipeline:
  //   1. Show "Inicializando ExifTool..." while the WASM loads.
  //   2. Load the engine (lazy-spawn the Worker; first call
  //      downloads the WASM, subsequent calls reuse the cached
  //      Worker).
  //   3. Show "Analizando metadatos..." while the Worker
  //      extracts the tags.
  //   4. Transition to results (Phase 4 will replace the
  //      placeholder renderer with a real grouped view).
  setState({ view: 'analyzing', file });
  setAnalyzingPhase('loading');

  try {
    await loadExiftool();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia: worker init failed', err);
    setState({
      view: 'error',
      errorKey: mapLoaderErrorToI18nKey(err && err.code),
    });
    return;
  }

  setAnalyzingPhase('reading');

  try {
    const rawMetadata = await readMetadata(pendingBuffer, file.name);
    // Parse raw ExifTool JSON into the FileMetadata shape
    // the view expects (Data Model §3.3). The `formatBinary`
    // callback threads the results.binaryValue i18n key
    // through to the parser without making the parser
    // import i18n.js (which would break Node unit tests).
    const metadata = parseExiftoolOutput(rawMetadata, activeFileId, {
      formatBinary: (size) => t('results.binaryValue', { size }),
    });
    setState({ view: 'results', file, metadata });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia: readMetadata failed', err);
    setState({
      view: 'error',
      errorKey: mapLoaderErrorToI18nKey(err && err.code),
    });
  }
}

/**
 * Phase 6.3 — feature-detect the browser's required APIs on
 * boot. We refuse to render any other view until the page can
 * at least run the analysis pipeline.
 *
 * Returns an AppState error shape if any required feature is
 * missing, or null if the page can proceed.
 *
 * Per Flow §6.6 + Design Spec §5: if the browser is too old
 * the user sees the upgrade-browser message and nothing else
 * is reachable. There is no recovery path in the page; the
 * user must upgrade.
 *
 * @returns {AppStateError | null}
 */
function checkBrowserSupport() {
  if (typeof WebAssembly === 'undefined') {
    return { view: 'error', errorKey: 'browser_too_old' };
  }
  if (typeof Worker === 'undefined') {
    return { view: 'error', errorKey: 'browser_too_old' };
  }
  if (typeof ArrayBuffer === 'undefined') {
    return { view: 'error', errorKey: 'browser_too_old' };
  }
  if (typeof Blob === 'undefined') {
    return { view: 'error', errorKey: 'browser_too_old' };
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { view: 'error', errorKey: 'browser_too_old' };
  }
  return null;
}

async function bootstrap() {
  await initI18n();

  // Phase 6.3 — check browser support BEFORE wiring any UI.
  // If we fail, render the error state and stop.
  const unsupportedState = checkBrowserSupport();
  if (unsupportedState) {
    setState(unsupportedState);
    return;
  }

  wireVerifierToggle();
  wireUploader({
    dropzoneSelector: '#dropzone',
    inputId: 'file-input',
    onFile: handleFile,
  });
  render();
}

function wireVerifierToggle() {
  // Phase 1 wiring — unchanged. Kept inline rather than
  // extracted so the orchestrator stays the single source
  // of truth for boot-time DOM hooks.
  const toggle = document.getElementById('verifier-toggle');
  const detail = document.getElementById('verifier-detail');
  const labelEl = toggle && toggle.querySelector('.verifier-toggle-label');
  if (!toggle || !detail || !labelEl) return;

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    const next = !isExpanded;
    toggle.setAttribute('aria-expanded', String(next));
    detail.hidden = !next;
    labelEl.textContent = next ? t('verifier.collapse') : t('verifier.expand');
  });
}

bootstrap().catch((err) => {
  // Phase 6 — route bootstrap failures through the same
  // error view as runtime failures. We cannot reach this
  // branch in a browser that already passed checkBrowserSupport
  // (i18n.init is the only await before setState), but it
  // catches pathological cases (e.g. the locale JSON failing
  // to parse). The generic worker_crashed message is the
  // right fallback here too.
  // eslint-disable-next-line no-console
  console.error('MetaLimpia: bootstrap failed', err);
  setState({ view: 'error', errorKey: 'worker_crashed' });
});
