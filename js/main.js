/*
 * MetaLimpia — entry point / orchestrator
 *
 * Phase 4: replaces the Phase 3 results placeholder with the
 * full grouped metadata view (js/ui/metadataView.js) driven
 * by parsed FileMetadata from js/metadataParser.js.
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
 *      The view receives the parsed FileMetadata and the
 *      orchestrator's callbacks (onBack, onRemove,
 *      onSelectionChange). Phase 5 will wire onRemove to
 *      the ExifTool write op.
 *
 * View states exercised by this orchestrator:
 *
 *   landing   — dropzone visible
 *   analyzing — loading or reading message; dropzone hidden
 *   results   — Phase 4 metadata list with checkboxes,
 *               collapse/expand, sensitive badges, and
 *               action bar (Borrar todo / Borrar
 *               seleccionados / Cambiar archivo).
 *   error     — dropzone hidden, error card with back button.
 *
 * The state shape is the discriminated union defined in
 * Data Model §3.1. The full state machine (processing, done)
 * is completed in Phase 6.
 */

import { init as initI18n, t } from './i18n.js';
import { validateFile, readFile } from './fileHandler.js';
import { wireUploader } from './ui/uploader.js';
import { renderErrorView } from './ui/errorView.js';
import { renderAnalyzingView } from './ui/analyzingView.js';
import { renderResults } from './ui/metadataView.js';
import { parseExiftoolOutput } from './metadataParser.js';
import { loadExiftool, readMetadata } from './exiftoolLoader.js';

// AppState per Data Model §3.1 — Phase 3 subset. The full
// state machine (processing, done) is completed in Phase 6.
let state = { view: 'landing' };

// Holds the ArrayBuffer of the file that the user dropped.
// Phase 3 hands it to the ExifTool worker. Cleared on every
// transition back to landing so memory is released between
// rounds.
let pendingBuffer = null;

// Cached last selection. Phase 5's write path needs it;
// Phase 4 only writes it as a no-op side effect of the
// onSelectionChange callback so future phases can pick
// it up without re-plumbing the view.
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
    // Drop any in-memory buffer from a previous round.
    pendingBuffer = null;
    lastSelection = null;
    activeFileId = null;
    return;
  }

  // error / analyzing / results all hide the dropzone and
  // show the shared view container. Each renderer resets the
  // container itself, so we never accumulate DOM nodes
  // across transitions.
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

  if (state.view === 'results') {
    renderResults(viewContainer, state.file, state.metadata, {
      onBack: () => setState({ view: 'landing' }),
      // Phase 4 stub: the action buttons are wired but the
      // actual ExifTool write op is Phase 5. We log so a
      // developer can confirm the callback fires.
      onRemove: ({ removeAll }) => {
        // eslint-disable-next-line no-console
        console.info(
          `MetaLimpia: onRemove stub fired (removeAll=${Boolean(
            removeAll
          )}) — Phase 5 will wire the ExifTool write op here.`
        );
      },
      onSelectionChange: (selection) => {
        lastSelection = selection;
      },
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