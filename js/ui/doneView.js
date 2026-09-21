/*
 * MetaLimpia — done view (Phase 5)
 *
 * Renders the confirmation card shown after the Worker's
 * `write` op completes successfully. Three pieces of UI:
 *
 *   - Title  ("Archivo limpio", done.title)
 *   - Summary ("Se eliminaron {count} metadatos.",
 *              done.summary — count = tags the user asked
 *              to remove, NOT tags the user originally had.
 *              A file with 24 tags cleaned to 0 reports
 *              "Se eliminaron 24 metadatos.".)
 *   - Two actions:
 *       * Descargar archivo limpio (done.download)
 *         → triggers downloader.triggerDownload with the
 *           cleaned ArrayBuffer + filename.
 *       * Procesar otro archivo (done.another)
 *         → returns to landing; pendingBuffer is dropped by
 *           the orchestrator's landing transition so the
 *           next file gets a clean memory slate.
 *
 * Public API:
 *
 *   renderDoneView(container, file, data, callbacks)
 *
 *     container — the #view-container element. Its
 *                 innerHTML is reset before rendering.
 *     file      — the original File the user dropped.
 *                 Carried through so the done view knows the
 *                 original MIME type (used for the Blob).
 *     data      — { cleanedBuffer, removedCount, downloadName }
 *                 produced by the orchestrator from the
 *                 Worker's write response + the live
 *                 selection. downloadName is the result of
 *                 buildCleanedFilename(file.name).
 *     callbacks — { onDownload, onAnother } fired on the
 *                 respective buttons. Both are required;
 *                 the view throws if either is missing to
 *                 surface wiring bugs at boot rather than
 *                 silently no-op'ing the click.
 *
 * CSP / a11y:
 *   - No innerHTML with user data — every dynamic value is
 *     set via .textContent. removedCount is coerced to a
 *     string; downloadName is verbatim from the orchestrator.
 *   - role="status" on the summary so screen readers
 *     announce the count without interrupting the user.
 *   - The primary "Descargar" button is a btn-primary;
 *     "Procesar otro archivo" is a regular btn. Both have
 *     visible focus rings via the global :focus-visible rule.
 */

import { t } from '../i18n.js';

/**
 * Render the done view into the given container.
 *
 * @param {HTMLElement} container
 * @param {File | null | undefined} file
 * @param {{
 *   cleanedBuffer: ArrayBuffer,
 *   removedCount: number,
 *   downloadName: string,
 * }} data
 * @param {{
 *   onDownload: () => void,
 *   onAnother: () => void,
 * }} callbacks
 */
export function renderDoneView(container, file, data, callbacks = {}) {
  if (!container) return;

  const onDownload =
    typeof callbacks.onDownload === 'function'
      ? callbacks.onDownload
      : null;
  const onAnother =
    typeof callbacks.onAnother === 'function' ? callbacks.onAnother : null;

  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'done-card';
  // Phase 6.7 — labeled region inside <main>. The done-title
  // heading doubles as the accessible name; we point
  // aria-labelledby at its id.
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'done-title');

  // Check icon — same circular-badge treatment as the
  // results-empty success state. Reuses the .results-empty-icon
  // token (--color-success background, --color-text-inverse
  // glyph) so success feedback feels consistent across views.
  const icon = document.createElement('div');
  icon.className = 'done-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✓';
  card.appendChild(icon);

  // Title — "Archivo limpio".
  const title = document.createElement('h2');
  title.className = 'done-title text-h1';
  title.id = 'done-title';
  title.textContent = t('done.title');
  card.appendChild(title);

  // Summary — "Se eliminaron {count} metadatos."
  // count is the count of tags the user asked to remove,
  // not the count ExifTool actually removed from the file
  // (we don't re-read to count — the privacy cost of a
  // second WASM pass per file is not worth the precision).
  const summary = document.createElement('p');
  summary.className = 'done-summary text-body';
  summary.setAttribute('role', 'status');
  summary.textContent = t('done.summary', {
    count: typeof data.removedCount === 'number' ? data.removedCount : 0,
  });
  card.appendChild(summary);

  // Actions block — primary download + secondary "process
  // another file".
  const actions = document.createElement('div');
  actions.className = 'done-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-primary';
  downloadBtn.textContent = t('done.download');
  if (onDownload) {
    downloadBtn.addEventListener('click', onDownload);
  }
  actions.appendChild(downloadBtn);

  const anotherBtn = document.createElement('button');
  anotherBtn.type = 'button';
  anotherBtn.className = 'btn';
  anotherBtn.textContent = t('done.another');
  if (onAnother) {
    anotherBtn.addEventListener('click', onAnother);
  }
  actions.appendChild(anotherBtn);

  card.appendChild(actions);
  container.appendChild(card);
}
