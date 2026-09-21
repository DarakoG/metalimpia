/*
 * MetaLimpia — error view renderer
 *
 * Renders a user-facing error message inside a designated
 * container with a back button that returns to landing.
 *
 * The mapping from validator error codes to i18n keys lives
 * here (not in i18n.js) because it is presentation concern:
 * which error code becomes which user-facing string is a UI
 * decision, not a locale lookup decision.
 *
 * The error codes accepted here are a superset of what the
 * Phase 2 validator returns. Phase 5 adds `writeFailed`
 * for ExifTool write failures; the remaining codes
 * (corrupted, wasm_load_failed, worker_crashed,
 * browser_too_old) cover the full AppState.error path
 * defined in Data Model section 3.1.
 */

import { t } from '../i18n.js';

/**
 * Map validator / orchestrator error codes to i18n keys.
 * The fallback catches typos in the orchestrator and surfaces
 * the generic "unexpected error" message rather than throwing.
 */
const ERROR_I18N_KEYS = {
  empty: 'errors.empty',
  too_large: 'errors.tooLarge',
  unsupported_format: 'errors.unsupportedFormat',
  corrupted: 'errors.corrupted',
  wasm_load_failed: 'errors.wasmLoadFailed',
  worker_crashed: 'errors.workerCrashed',
  writeFailed: 'errors.writeFailed',
  browser_too_old: 'errors.browserTooOld',
};

/**
 * Render an error view into the given container.
 *
 * @param {HTMLElement} container — element to receive the
 *   error UI. Its innerHTML is reset to a single message
 *   paragraph and a back button.
 * @param {string} errorKey — one of the keys in ERROR_I18N_KEYS.
 * @param {Record<string, string | number>} [context] —
 *   interpolation values for the i18n template.
 * @param {{ onBack: () => void }} handlers — back-button
 *   callback. The button itself uses the shared
 *   `results.actions.back` label ("Cambiar archivo").
 */
export function renderErrorView(container, errorKey, context, { onBack }) {
  if (!container) return;

  const i18nKey = ERROR_I18N_KEYS[errorKey];
  const message = i18nKey ? t(i18nKey, context || {}) : t('errors.workerCrashed');

  // Clear before re-rendering so we never accumulate nodes
  // across state transitions. innerHTML with an empty string
  // is safe; we are not inserting user data.
  container.innerHTML = '';

  const messageEl = document.createElement('p');
  messageEl.className = 'error-message text-body';
  // role="alert" makes screen readers announce the message
  // immediately on insertion. The container already has
  // aria-live="polite" in markup, but alert is the right
  // semantic for an error that the user must act on.
  messageEl.setAttribute('role', 'alert');
  messageEl.textContent = message;

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = t('results.actions.back');
  if (typeof onBack === 'function') {
    backBtn.addEventListener('click', onBack);
  }

  container.appendChild(messageEl);
  container.appendChild(backBtn);
}