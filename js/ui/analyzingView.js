/*
 * MetaLimpia — analyzing stub view
 *
 * Phase 2 placeholder. Renders a loading card with the
 * `analyzing.message` i18n key ("Analizando metadatos...")
 * so the orchestrator can transition into a loading state
 * without knowing the upcoming Phase 3 ExifTool worker
 * details.
 *
 * Phase 3 replaces this with a Worker-backed progress
 * indicator that streams messages from js/workers/exiftool.
 * The replacement only needs to honour the same
 * `container.innerHTML = ''` contract used by errorView.
 */

import { t } from '../i18n.js';

export function renderAnalyzingView(container) {
  if (!container) return;

  container.innerHTML = '';

  const message = document.createElement('p');
  message.className = 'analyzing-message text-body';
  // Polite announcement so screen readers do not interrupt
  // the user; the card sits inside an aria-live=polite
  // container already, so this is the inner announcement.
  message.setAttribute('role', 'status');
  message.textContent = t('analyzing.message');

  container.appendChild(message);
}