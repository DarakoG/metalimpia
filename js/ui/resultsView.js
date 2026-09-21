/*
 * MetaLimpia — results view (Phase 3 placeholder)
 *
 * Renders a minimal "metadata loaded" card with the file
 * name, the raw ExifTool tag count, and a back button.
 *
 * Phase 4 (Metadata Display + Selection) replaces this with
 * the grouped, classified, per-tag-checkbox view per Design
 * Spec §4. Today the placeholder exists so the orchestrator
 * can complete the Phase 3 state machine (`landing → analyzing
 * → results`) without leaving the user stuck on the spinner.
 *
 * The shape of `metadata` here is whatever ExifTool's
 * `-j -G1 -a -s <file>` produces for a single file: a flat
 * object whose keys are canonical ExifTool tag names
 * (e.g. "Make", "Model", "GPSLatitude"). No grouping, no
 * exclusion of operational tags, no value formatting —
 * Phase 4 owns all of that.
 */

import { t } from '../i18n.js';

/**
 * Render the results view into the given container.
 *
 * @param {HTMLElement} container — element to receive the
 *   results card. Its innerHTML is reset before rendering.
 * @param {File} file — the original dropped file, used only
 *   to show its name to the user.
 * @param {object} metadata — raw ExifTool JSON for the file.
 *   The object may have any keys; we only count them today.
 * @param {{ onBack: () => void }} handlers — the back button
 *   routes through this callback to the orchestrator.
 */
export function renderResultsView(container, file, metadata, handlers) {
  if (!container) return;

  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'results-card';

  // Heading: "Tu archivo: <filename>" via the i18n template.
  // We pass the filename as an interpolation parameter; the
  // locale key expects {filename}.
  const title = document.createElement('h2');
  title.className = 'results-title text-h1';
  title.textContent = t('results.title', {
    filename: file ? file.name : '',
  });
  card.appendChild(title);

  // Tag count: today we count top-level keys. Phase 4's
  // metadataParser will turn this into the count of tags
  // we actually surface to the user (excluding operational
  // metadata per Data Model §4.3).
  const totalCount = metadata && typeof metadata === 'object'
    ? Object.keys(metadata).length
    : 0;

  const summary = document.createElement('p');
  summary.className = 'results-summary text-body';
  summary.textContent = t('results.summary', { count: totalCount });
  card.appendChild(summary);

  // Phase 3 placeholder. Renders nothing visual but logs the
  // raw payload so a developer can confirm the Worker
  // contract end-to-end. Phase 4 will replace the entire
  // card with the grouped/classified list.
  if (metadata && typeof metadata === 'object') {
    const tags = Object.keys(metadata);
    if (tags.length > 0) {
      const dev = document.createElement('p');
      dev.className = 'results-dev-note text-small text-muted';
      dev.textContent = `Metadatos detectados (${tags.length}): ${tags
        .slice(0, 8)
        .join(', ')}${tags.length > 8 ? '…' : ''}`;
      card.appendChild(dev);
    }
  }

  // Back button. Routes to handlers.onBack. The locale key
  // already exists from Phase 1/2 ("Cambiar archivo").
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = t('results.actions.back');
  if (handlers && typeof handlers.onBack === 'function') {
    backBtn.addEventListener('click', handlers.onBack);
  }
  card.appendChild(backBtn);

  container.appendChild(card);
}