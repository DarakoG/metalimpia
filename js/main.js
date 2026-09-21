/*
 * MetaLimpia — entry point / orchestrator
 *
 * Phase 3: extends the Phase 2 file upload flow with the
 * ExifTool WASM integration. The Worker (js/workers/exiftool.
 * worker.js) runs the vendored Perl/WASI runtime and returns
 * metadata JSON. The orchestrator:
 *
 *   1. Validates the dropped file (Phase 2 unchanged).
 *   2. Reads it into pendingBuffer (Phase 2 unchanged).
 *   3. Transitions to { view: 'analyzing', phase: 'loading' }
 *      so the UI shows the WASM-init message.
 *   4. Calls loadExiftool() — lazy-spawns the Worker and
 *      waits for the init handshake. On failure transitions
 *      to { view: 'error', errorKey: 'wasm_load_failed' }.
 *   5. Transitions to { view: 'analyzing', phase: 'reading' }
 *      so the UI shows the analyzing message.
 *   6. Calls readMetadata(buffer, fileName). On success
 *      transitions to { view: 'results', metadata: raw }
 *      where Phase 4 will replace the placeholder renderer
 *      with the real grouped/classified view. On failure
 *      transitions to an error view (corrupted / worker_crashed).
 *
 * View states exercised by this orchestrator:
 *
 *   landing   — dropzone visible
 *   analyzing — loading or reading message; dropzone hidden
 *   results   — Phase 3 placeholder: a "metadata loaded" card
 *               with the raw tag count and a back button.
 *               Phase 4 replaces the renderer with metadataView.
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
import { renderResultsView } from './ui/resultsView.js';
import { loadExiftool, readMetadata } from './exiftoolLoader.js';

// AppState per Data Model §3.1 — Phase 3 subset. The full
// state machine (processing, done) is completed in Phase 6.
let state = { view: 'landing' };

// Holds the ArrayBuffer of the file that the user dropped.
// Phase 3 hands it to the ExifTool worker. Cleared on every
// transition back to landing so memory is released between
// rounds.
let pendingBuffer = null;

// Cached raw metadata returned by the Worker. Phase 4's
// metadataParser will replace this with a richer structure.
let lastMetadata = null;

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
    lastMetadata = null;
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
    renderResultsView(viewContainer, state.file, state.metadata, {
      onBack: () => setState({ view: 'landing' }),
    });
    return;
  }
}

/**
 * Build the i18n interpolation context for an error view
 * based on the validator error code and the offending file.
 */
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
 * Map an exiftoolLoader error code to an i18n error key. The
 * loader rejects with one of:
 *   - 'wasm_load_failed' → engine never came up
 *   - 'corrupted'         → exiftool could not parse the file
 *   - 'write_failed'      → exiftool refused to write the cleaned copy
 *   - 'worker_crashed'    → unhandled throw inside the Worker
 *   - anything else       → treat as generic worker_crashed
 */
function mapLoaderErrorToI18nKey(code) {
  if (code === 'wasm_load_failed') return 'wasm_load_failed';
  if (code === 'corrupted') return 'corrupted';
  if (code === 'write_failed') return 'corrupted';
  return 'workerCrashed';
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
    const metadata = await readMetadata(pendingBuffer, file.name);
    lastMetadata = metadata;
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