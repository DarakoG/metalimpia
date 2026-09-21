/*
 * MetaLimpia — entry point
 *
 * Phase 1: bootstraps the i18n module and wires the privacy
 * verifier toggle (expand/collapse the technical detail panel).
 * The state machine, dropzone handlers, and live verifier data
 * are introduced in later phases; this file stays small on
 * purpose so the orchestrator grows incrementally.
 */

import { init as initI18n, t } from './i18n.js';

async function bootstrap() {
  await initI18n();
  wireVerifierToggle();
}

function wireVerifierToggle() {
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
  // Phase 1 surfaces nothing user-facing here; later phases add a
  // proper error view per Flow section 6.
  console.error('MetaLimpia: bootstrap failed', err);
});