/*
 * MetaLimpia — analyzing view
 *
 * Renders the loading card the user sees while the ExifTool
 * Worker is processing the dropped file. Three messages are
 * supported, picked by `state.phase`:
 *
 *   - 'loading'    → `analyzing.loading` ("Inicializando
 *                     ExifTool...") shown while the WASM is
 *                     downloaded and the Perl interpreter
 *                     initialises on first use in a session.
 *   - 'reading'    → `analyzing.message` ("Analizando
 *                     metadatos...") shown once the Worker
 *                     has acknowledged `init` and is reading
 *                     the file.
 *   - 'processing' → `processing.message` ("Limpiando
 *                     archivo...") shown during Phase 5's
 *                     Worker `write` op. Reuses the same
 *                     spinner / card layout so the visual
 *                     language stays consistent across the
 *                     three "wait" moments.
 *
 * Phase 3 owns the live progress; this module is purely
 * presentational and follows the same `container.innerHTML = ''`
 * contract used by errorView / doneView.
 */

import { t } from '../i18n.js';

/**
 * Render the analyzing view into the given container.
 *
 * @param {HTMLElement} container — element to receive the
 *   loading card. Its innerHTML is reset before rendering.
 * @param {object} [state] — current state. Today only `view` is
 *   meaningful; reserved for Phase 6 progress percentages.
 * @param {{ onReady?: () => void }} [handlers] — reserved for
 *   future progress events. Not consumed in Phase 3.
 */
export function renderAnalyzingView(container, state, handlers) {
  if (!container) return;

  container.innerHTML = '';

  // The message key depends on whether we are still waiting
  // for the Worker to finish `init` (first WASM download),
  // already running the read op, or running the write op
  // (Phase 5). The orchestrator passes
  // `state.phase = 'loading' | 'reading' | 'processing'`.
  const phase = (state && state.phase) || 'reading';
  let i18nKey;
  if (phase === 'loading') {
    i18nKey = 'analyzing.loading';
  } else if (phase === 'processing') {
    i18nKey = 'processing.message';
  } else {
    i18nKey = 'analyzing.message';
  }

  const card = document.createElement('div');
  card.className = 'analyzing-card';
  // Phase 6.7 — labeled region inside <main>. The message
  // doubles as the heading for this view (it's the only
  // text), so we point aria-labelledby at its id.
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'analyzing-message');

  // Pure-CSS spinner — no external assets, no JS animation
  // loops. honour prefers-reduced-motion via the global
  // media query in css/styles.css (animation-duration: 0.001ms).
  const spinner = document.createElement('div');
  spinner.className = 'analyzing-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const message = document.createElement('p');
  message.className = 'analyzing-message text-body';
  message.id = 'analyzing-message';
  // Polite announcement so screen readers do not interrupt
  // the user. The card sits inside an aria-live=polite
  // container (#view-container) already, so this is the
  // inner announcement for the change of phase.
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = t(i18nKey);

  card.appendChild(spinner);
  card.appendChild(message);
  container.appendChild(card);
}