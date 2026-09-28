/*
 * MetaLimpia — PDF cleanup scope disclosure view
 *
 * Rendered BETWEEN the metadata results view and the actual scrub
 * for PDF files. The orchestrator's handleRemove detects the .pdf
 * filename and transitions results → pdfScope (this view) instead
 * of results → processing. The user reads the honest scope, then
 * clicks the "Limpiar y descargar" CTA to confirm; that CTA fires
 * handlePdfScopeConfirm in main.js which dynamic-imports
 * js/pdfScrubber.js (pdf-lib) and runs the scrub.
 *
 * Why a dedicated view (not a modal, not an inline card on
 * results):
 *
 *   - Matches the orchestrator's single-page-app state machine
 *     (Data Model §3.1) — every UI surface is a view state, so
 *     the cancel button ("Cambiar archivo") can land back on
 *     landing via the same setState path as the other views.
 *   - The focus management gate (Phase 6.8) auto-handles the
 *     heading and primary CTA focus for free — the first h2 in
 *     the card is the title; the primary CTA is the first
 *     `.btn-primary` in the action bar.
 *   - The screen-reader announcement on transition is more
 *     meaningful when the new view is a full card with a clear
 *     role="region" + aria-labelledby instead of a partial
 *     replacement of the results card.
 *
 * Two sections rendered as <ul> lists, both data-driven from the
 * locale so a future English translation only needs to update
 * locales/en.json (currently es-only):
 *
 *   results.pdfCleanupScope.willRemove       (array of strings)
 *   results.pdfCleanupScope.willNotRemove    (array of strings)
 *
 * Plus a heading for each list (added separately) and a single
 * "Limpiar y descargar" CTA.
 *
 * Accessibility:
 *
 *   - role="region" + aria-labelledby pointing at the title so
 *     screen readers announce the card boundary.
 *   - Each list has an aria-label that mirrors its visible
 *     heading so users navigating by landmark or by list hear
 *     the same words.
 *   - All dynamic text comes from locale lookups; no
 *     innerHTML with user data.
 */

import { t, tRaw } from '../i18n.js';

/**
 * Render the PDF cleanup scope view.
 *
 * @param {HTMLElement} container
 * @param {File | null | undefined} file — original File object (filename shown in title)
 * @param {{ onConfirm?: () => void, onBack?: () => void }} [callbacks]
 */
export function renderPdfScopeView(container, file, callbacks = {}) {
  if (!container) return;

  const onConfirm =
    typeof callbacks.onConfirm === 'function' ? callbacks.onConfirm : null;
  const onBack = typeof callbacks.onBack === 'function' ? callbacks.onBack : null;

  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'pdf-scope-card';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'pdf-scope-title');

  // --- Title --------------------------------------------------
  const title = document.createElement('h2');
  title.className = 'pdf-scope-title text-h1';
  title.id = 'pdf-scope-title';
  title.textContent = t('results.pdfCleanupScope.title', {
    filename: file && file.name ? file.name : '',
  });
  card.appendChild(title);

  // --- Subtitle (one-line summary) ----------------------------
  const subtitle = document.createElement('p');
  subtitle.className = 'pdf-scope-subtitle text-body';
  subtitle.textContent = t('results.pdfCleanupScope.subtitle');
  card.appendChild(subtitle);

  // --- Will remove list ---------------------------------------
  card.appendChild(buildScopeList(
    'willRemoveHeading',
    'willRemove',
    'pdf-scope-list--remove',
  ));

  // --- Will NOT remove list -----------------------------------
  card.appendChild(buildScopeList(
    'willNotRemoveHeading',
    'willNotRemove',
    'pdf-scope-list--keep',
  ));

  // --- Action bar ---------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'pdf-scope-actions';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = t('results.actions.back');
  if (onBack) backBtn.addEventListener('click', onBack);
  actions.appendChild(backBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = t('results.pdfCleanupScope.cleanAll');
  if (onConfirm) confirmBtn.addEventListener('click', onConfirm);
  actions.appendChild(confirmBtn);

  card.appendChild(actions);
  container.appendChild(card);
}

/**
 * Build one of the two scope lists (will-remove / will-NOT-remove).
 * The visible heading and the list items both come from the locale;
 * if the array is missing or malformed we render an empty list with
 * a safe fallback so the view never throws.
 */
function buildScopeList(headingKey, itemsKey, listModifierClass) {
  const wrapper = document.createElement('section');
  wrapper.className = 'pdf-scope-section';

  const heading = document.createElement('h3');
  heading.className = 'pdf-scope-heading text-h3';
  heading.textContent = t(`results.pdfCleanupScope.${headingKey}`);
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  list.className = `pdf-scope-list ${listModifierClass}`;
  list.setAttribute(
    'aria-label',
    t(`results.pdfCleanupScope.${headingKey}`)
  );

  const items = tRaw(`results.pdfCleanupScope.${itemsKey}`);
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item !== 'string' || item.length === 0) continue;
      const li = document.createElement('li');
      li.className = 'pdf-scope-item';
      li.textContent = item;
      list.appendChild(li);
    }
  }

  wrapper.appendChild(list);
  return wrapper;
}