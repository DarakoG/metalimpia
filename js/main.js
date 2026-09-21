/*
 * MetaLimpia — entry point / orchestrator
 *
 * Phase 2: extends Phase 1 bootstrap with the file upload
 * flow. The dropzone is wired to drag-drop and click-to-
 * select via js/ui/uploader.js; each accepted file flows
 * through validateFile(), is read into an ArrayBuffer, and
 * pushes the page into one of three view states:
 *
 *   landing   — dropzone visible
 *   analyzing — dropzone hidden, stub progress card shown
 *               (Phase 3 replaces this with a Worker-backed
 *               progress feed)
 *   error     — dropzone hidden, error card with a back
 *               button shown
 *
 * The state shape is the discriminated union defined in
 * Data Model section 3.1, restricted to the Phase 2 subset.
 * The full state machine (results, processing, done) is
 * completed in Phase 6.
 */

import { init as initI18n, t } from './i18n.js';
import { validateFile, readFile } from './fileHandler.js';
import { wireUploader } from './ui/uploader.js';
import { renderErrorView } from './ui/errorView.js';
import { renderAnalyzingView } from './ui/analyzingView.js';

// AppState per Data Model section 3.1 — Phase 2 subset.
// Other variants (results, processing, done) are added in
// later phases.
let state = { view: 'landing' };

// Holds the ArrayBuffer of the file that the user dropped.
// Phase 2 just keeps a reference; Phase 3 hands it to the
// ExifTool worker. Cleared on every transition back to
// landing so memory is released between rounds.
let pendingBuffer = null;

/**
 * Replace the current state, then re-render the view.
 * State is always replaced wholesale — there are no
 * incremental updates in Phase 2.
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
    return;
  }

  // error and analyzing both hide the dropzone and show the
  // shared view container. Each renderer resets the container
  // itself, so we never accumulate DOM nodes across transitions.
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
    renderAnalyzingView(viewContainer);
    return;
  }
}

/**
 * Build the i18n interpolation context for an error view
 * based on the validator error code and the offending file.
 * Centralised here so errorView.js stays purely presentational.
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

  // Phase 2 stub: hand off to the analyzing view. Phase 3
  // will spawn the ExifTool worker here and replace the
  // view when the worker posts its first metadata payload.
  setState({ view: 'analyzing', file });
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