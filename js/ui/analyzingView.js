/*
 * MetaLimpia — analyzing view
 *
 * Renders the loading card the user sees while the ExifTool
 * Worker is processing the dropped file. Two messages are
 * supported:
 *
 *   - `analyzing.loading` ("Inicializando ExifTool...") shown
 *     while the WASM is downloaded and the Perl interpreter
 *     initialises on first use in a session.
 *   - `analyzing.message` ("Analizando metadatos...") shown
 *     once the Worker has acknowledged `init` and is reading
 *     the file.
 *
 * Phase 3 owns the live progress; this module is purely
 * presentational and follows the same `container.innerHTML = ''`
 * contract used by errorView.
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
  // for the Worker to finish `init` (first WASM download) or
  // already running the read op. The orchestrator passes
  // `state.phase = 'loading' | 'reading'` from Phase 6; in the
  // Phase 3 subset the orchestrator only ever passes
  // `phase: 'loading'` because the transition to results
  // happens via `setState({ view: 'results', ... })` from the
  // Worker response, never via this view's onReady.
  const phase = (state && state.phase) || 'reading';
  const i18nKey = phase === 'loading' ? 'analyzing.loading' : 'analyzing.message';

  const card = document.createElement('div');
  card.className = 'analyzing-card';

  // Pure-CSS spinner — no external assets, no JS animation
  // loops. honour prefers-reduced-motion via the global
  // media query in css/styles.css (animation-duration: 0.001ms).
  const spinner = document.createElement('div');
  spinner.className = 'analyzing-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const message = document.createElement('p');
  message.className = 'analyzing-message text-body';
  // Polite announcement so screen readers do not interrupt
  // the user. The card sits inside an aria-live=polite
  // container (#view-container) already, so this is the
  // inner announcement for the change of phase.
  message.setAttribute('role', 'status');
  message.textContent = t(i18nKey);

  card.appendChild(spinner);
  card.appendChild(message);
  container.appendChild(card);
}