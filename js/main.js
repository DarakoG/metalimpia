/*
 * MetaLimpia — entry point / orchestrator
 *
 * Phase 5: wires the existing onRemove callbacks from the
 * Phase 4 results view to the Worker's `write` op and adds
 * the `processing` and `done` view states to the state
 * machine.
 *
 * Pipeline on a valid file drop:
 *
 *   1. Validate the file (Phase 2 unchanged).
 *   2. Read into pendingBuffer (Phase 2 unchanged).
 *   3. Generate a session-scoped fileId via crypto.randomUUID.
 *   4. { view: 'analyzing', phase: 'loading' }
 *      → WASM download + Worker init.
 *   5. { view: 'analyzing', phase: 'reading' }
 *      → ExifTool read op.
 *   6. Read raw ExifTool JSON → metadataParser.parseExiftoolOutput
 *      → { view: 'results', file, metadata, fileId }.
 *   7. User clicks "Borrar todo" or "Borrar seleccionados":
 *      a. { view: 'processing', phase: 'processing', file, selection }
 *         → Worker `write` op with the live tagsToRemove.
 *      b. On success → { view: 'done', file, cleanedBuffer,
 *                        downloadName, removedCount }.
 *         The download button triggers a same-origin Blob URL
 *         download (js/ui/downloader.js). The "Procesar otro
 *         archivo" button returns to landing.
 *      c. On failure → { view: 'error', errorKey } mapped from
 *         the Worker's error code.
 *
 * View states exercised by this orchestrator:
 *
 *   landing     — dropzone visible
 *   analyzing   — loading or reading message; dropzone hidden
 *   results     — Phase 4 metadata list with checkboxes,
 *                 collapse/expand, sensitive badges, and
 *                 action bar (Borrar todo / Borrar
 *                 seleccionados / Cambiar archivo).
 *   processing  — Phase 5 spinner card with "Limpiando
 *                 archivo..." while the Worker runs the write op.
 *   done        — Phase 5 confirmation card with the cleaned
 *                 count, a "Descargar" primary action, and a
 *                 "Procesar otro archivo" secondary action.
 *   error       — dropzone hidden, error card with back button.
 *
 * The state shape is the discriminated union defined in
 * Data Model §3.1, extended with `downloadName` for `done`
 * (the spec's CleanedFile §5.1 model also carries downloadName).
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
import { loadExiftool, readMetadata, writeMetadata } from './exiftoolLoader.js';

// AppState per Data Model §3.1 — Phase 5 subset. Phase 6 will
// harden the transitions; the shape is already stable.
let state = { view: 'landing' };

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
 * State is always replaced wholesale — there are no
 * incremental updates in Phase 3.
 */
function setState(next) {
  state = next;
  render();
}

/**
 * Render the current state into the DOM. Idempotent —
 * safe to call multiple times.
 */
function render() {
  const app = document.getElementById('app');
  const dropzoneSection = document.querySelector('.dropzone-section');
  const viewContainer = document.getElementById('view-container');
  if (!app || !dropzoneSection || !viewContainer) return;

  app.dataset.view = state.view;

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
    renderAnalyzingView(viewContainer, { phase: state.phase });
    return;
  }

  if (state.view === 'processing') {
    // Reuses the analyzing card layout (same spinner / same
    // card) but with the Phase 5 'processing.message' i18n
    // key, picked by analyzingView's phase-based lookup.
    renderAnalyzingView(viewContainer, { phase: 'processing', file: state.file });
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
    renderDoneView(viewContainer, state.file, {
      cleanedBuffer: state.cleanedBuffer,
      removedCount: state.removedCount,
      downloadName: state.downloadName,
    }, {
      onDownload: () => {
        triggerDownload(
          state.cleanedBuffer,
          state.downloadName,
          state.file && state.file.type ? state.file.type : undefined
        );
      },
      onAnother: () => setState({ view: 'landing' }),
    });
    return;
  }
}

/**
 * Build the i18n interpolation context for an error view
 * based on the validator error code and the offending file.
 */

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
 *   - 'wasm_load_failed' → engine never came up
 *   - 'corrupted'        → exiftool could not parse the file
 *   - 'write_failed'     → exiftool refused to write the cleaned copy
 *   - 'crashed'          → unhandled throw inside the Worker
 *                          (write/read runtime issue)
 *   - anything else      → treat as generic worker_crashed
 */
function mapLoaderErrorToI18nKey(code) {
  if (code === 'wasm_load_failed') return 'wasm_load_failed';
  if (code === 'corrupted') return 'corrupted';
  if (code === 'write_failed') return 'writeFailed';
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
 *   4. On success → 'done' view with the cleaned buffer,
 *      the download name, and the user-visible "removed"
 *      count (number of tags the user asked to remove).
 *   5. On failure → 'error' view mapped through
 *      mapLoaderErrorToI18nKey.
 *
 * The 'processing' state is not a placeholder — we do not
 * pre-allocate the cleanedBuffer on failure; the user can
 * retry from the error view's back button (which lands
 * them on results via Phase 6's error → results wiring).
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

  setState({ view: 'processing', phase: 'processing', file });

  try {
    const cleanedBuffer = await writeMetadata(pendingBuffer, file.name, {
      removeAll,
      tagsToRemove,
    });

    const downloadName = buildCleanedFilename(file.name);
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
      downloadName,
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
  setState({ view: 'analyzing', phase: 'loading', file });

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

  setState({ view: 'analyzing', phase: 'reading', file });

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
    setState({ view: 'results', file, metadata, fileId: activeFileId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia: readMetadata failed', err);
    setState({
      view: 'error',
      errorKey: mapLoaderErrorToI18nKey(err && err.code),
    });
  }
}

async function bootstrap() {
  await initI18n();
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
  // Phase 1 fallback. Phase 6 (edge cases) routes this
  // through the full error view per Flow section 6.
  // eslint-disable-next-line no-console
  console.error('MetaLimpia: bootstrap failed', err);
});