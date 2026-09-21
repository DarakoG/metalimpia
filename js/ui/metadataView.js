/*
 * MetaLimpia — metadata view (Phase 4)
 *
 * Replaces the Phase 3 placeholder (resultsView.js) with the
 * full grouped, classified, per-tag-checkbox metadata view
 * per Data Model §3.3 / §3.4 and the Implementation Plan
 * tasks 4.4–4.13.
 *
 * Public API:
 *
 *   renderResults(container, file, metadata, callbacks)
 *
 *     container   — the #view-container element. Its
 *                   innerHTML is reset before rendering.
 *     file        — the original File the user dropped. Used
 *                   to show the filename in the header and to
 *                   thread through to Phase 5's download.
 *     metadata    — the parsed FileMetadata produced by
 *                   metadataParser.parseExiftoolOutput.
 *     callbacks   — { onSelectionChange, onBack, onRemove }.
 *                   onSelectionChange fires on every checkbox
 *                   toggle with the resulting MetadataSelection
 *                   shape (Data Model §3.4). onBack / onRemove
 *                   fire on their respective buttons.
 *                   onRemove signature (Phase 5):
 *                       onRemove({
 *                         removeAll: boolean,
 *                         fileId: string,
 *                         tagsToRemove: string[] | null
 *                       })
 *                   tagsToRemove is the live selection (NOT
 *                   derived from the last onSelectionChange
 *                   callback — it is read from the model's
 *                   current state at click time so a stale
 *                   orchestrator cache can never send the
 *                   Worker the wrong set of tags).
 *                   null is sent for removeAll (the Worker
 *                   interprets missing tagsToRemove as "all").
 *
 * Rendering contract:
 *
 *   - Header: filename + total-count summary.
 *   - If totalCount === 0, render the empty state instead of
 *     the grouped list (Data Model §4.9 / task 4.9).
 *   - Per-group sections with the i18n label from
 *     results.groups.<id> and a sensitive badge when
 *     `group.sensitive === true`.
 *   - Each tag is a row with a checkbox, the canonical tag
 *     name, and the formatted value. The full value is
 *     always available as the row's `title` attribute; the
 *     visible text is truncated to a sensible length with
 *     CSS (text-overflow: ellipsis) for single-line values
 *     and a JS clamp for multi-line values.
 *   - Each group header collapses / expands its tag list
 *     with a smooth height transition that honours
 *     prefers-reduced-motion via the global CSS rule.
 *   - A "select all / deselect all" toggle per group flips
 *     all tag checkboxes in that group between all-checked
 *     and all-unchecked.
 *   - Action bar at the bottom:
 *       Borrar todo       (calls onRemove({ removeAll: true }))
 *       Borrar seleccionados
 *                          (calls onRemove({ removeAll: false }))
 *       Cambiar archivo   (calls onBack)
 *     In Phase 4 these buttons are styled and enabled but
 *     onRemove is a stub from main.js (it logs and returns).
 *
 * CSP / a11y:
 *   - No innerHTML with user data. Every dynamic value is
 *     set via .textContent (tag name, tag value, badge).
 *   - aria-expanded / aria-controls on every group header.
 *   - role="group" on each group's tag list, aria-labelledby
 *     points to the group header.
 *   - Every checkbox has an explicit <label> wrapping so
 *     click targets are large and screen readers announce
 *     the state correctly.
 *   - prefers-reduced-motion is honored via the global CSS
 *     rule that nullifies all transition durations.
 */

/*
 * Truncation threshold (in characters) for tag values. Long
 * values get the CSS `text-overflow: ellipsis` treatment in
 * the view; the full text is always in the `title` attribute
 * so the user can see / hear the whole thing on hover /
 * focus.
 */
const VALUE_TRUNCATE_CHARS = 80;

import { t } from '../i18n.js';

/**
 * Truncate a string to `limit` characters, appending an
 * ellipsis when shortened. Returns the input verbatim when
 * it already fits — so callers can pass values of any
 * length without pre-checking.
 *
 * @param {string} value
 * @param {number} limit
 * @returns {string}
 */
function truncate(value, limit) {
  if (typeof value !== 'string') return String(value ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Render the metadata view into the given container.
 *
 * @param {HTMLElement} container
 * @param {File | null | undefined} file
 * @param {{
 *   fileId: string,
 *   totalCount: number,
 *   groups: Array<object>,
 *   warnings: string[],
 * }} metadata
 * @param {{
 *   onSelectionChange?: (selection: {
 *     fileId: string,
 *     selectedTagIds: Set<string>,
 *     removeAll: boolean,
 *   }) => void,
 *   onBack?: () => void,
 *   onRemove?: (mode: {
 *     removeAll: boolean,
 *     fileId: string,
 *     tagsToRemove: string[] | null,
 *   }) => void,
 * }} callbacks
 */
export function renderResults(container, file, metadata, callbacks = {}) {
  if (!container) return;

  const onSelectionChange =
    typeof callbacks.onSelectionChange === 'function'
      ? callbacks.onSelectionChange
      : null;
  const onBack = typeof callbacks.onBack === 'function' ? callbacks.onBack : null;
  const onRemove =
    typeof callbacks.onRemove === 'function' ? callbacks.onRemove : null;

  // Per-instance state. We keep a parallel "live" model so
  // checkbox toggles mutate the displayed state in place
  // without rebuilding the entire DOM — the metadata object
  // is the source of truth, but the view holds its own
  // snapshot to track intermediate changes between callbacks.
  const model = cloneMetadata(metadata);

  // Centralised notification: every checkbox / group
  // toggle funnels through here so we keep the orchestrator
  // callback AND the action-bar's disabled state in sync.
  const fireSelectionChange = () => notifySelectionChange(
    model,
    onSelectionChange,
    () => actionsState.syncRemoveSelected()
  );

  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'results-card';
  card.appendChild(buildHeader(file, model));
  card.appendChild(buildSummary(model));

  // Build the action bar first so we can hand its
  // disabled-setter down to the per-tag handlers.
  const actionsState = buildActions({ onBack, onRemove, model });

  if (model.totalCount === 0 || model.groups.length === 0) {
    card.appendChild(buildEmptyState());
  } else {
    card.appendChild(buildGroupList(model, fireSelectionChange));
  }

  card.appendChild(actionsState.element);
  actionsState.syncRemoveSelected();

  container.appendChild(card);
}

/**
 * Deep-clone the metadata structure so per-tag toggles
 * mutate the view's own state without leaking back to the
 * orchestrator's reference. The orchestrator gets the
 * updated state via onSelectionChange.
 */
function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { fileId: '', totalCount: 0, groups: [], warnings: [] };
  }
  return {
    fileId: metadata.fileId || '',
    totalCount: typeof metadata.totalCount === 'number' ? metadata.totalCount : 0,
    groups: Array.isArray(metadata.groups)
      ? metadata.groups.map((g) => ({
          id: g.id,
          labelKey: g.labelKey,
          sensitive: Boolean(g.sensitive),
          tags: Array.isArray(g.tags)
            ? g.tags.map((t) => ({
                id: t.id,
                labelKey: t.labelKey,
                value: t.value,
                rawValue: t.rawValue,
                selected: t.selected !== false, // default true
                groupId: t.groupId,
              }))
            : [],
        }))
      : [],
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice() : [],
  };
}

/**
 * Build the card header (filename + i18n title).
 */
function buildHeader(file, model) {
  const header = document.createElement('div');
  header.className = 'results-header';

  const title = document.createElement('h2');
  title.className = 'results-title text-h1';
  title.textContent = t('results.title', {
    filename: file && file.name ? file.name : '',
  });
  header.appendChild(title);

  return header;
}

/**
 * Build the "Se encontraron N metadatos." summary line.
 * Hidden in the empty state (handled separately by
 * buildEmptyState).
 */
function buildSummary(model) {
  const summary = document.createElement('p');
  summary.className = 'results-summary text-body';
  summary.textContent = t('results.summary', { count: model.totalCount });
  return summary;
}

/**
 * Build the "ya está limpio" empty state. Replaces the
 * grouped list when there is nothing user-visible to
 * remove.
 */
function buildEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'results-empty';

  const icon = document.createElement('div');
  icon.className = 'results-empty-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✓';
  empty.appendChild(icon);

  const title = document.createElement('p');
  title.className = 'results-empty-title text-h3';
  title.textContent = t('results.empty.title');
  empty.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'results-empty-subtitle text-body';
  subtitle.textContent = t('results.empty.subtitle');
  empty.appendChild(subtitle);

  return empty;
}

/**
 * Build the list of groups. Each group is collapsible,
 * has a per-group select-all toggle, a sensitive badge
 * when applicable, and renders its tag rows.
 */
function buildGroupList(model, onSelectionChange) {
  const list = document.createElement('div');
  list.className = 'metadata-list';

  for (const group of model.groups) {
    list.appendChild(buildGroup(group, model, onSelectionChange));
  }
  return list;
}

/**
 * Build one group's section: header (label + badge +
 * toggle), collapsible body (tag rows).
 */
function buildGroup(group, model, onSelectionChange) {
  const section = document.createElement('section');
  section.className = 'metadata-group';
  if (group.sensitive) section.classList.add('metadata-group--sensitive');

  const headerId = `metadata-group-${group.id}-header`;
  const bodyId = `metadata-group-${group.id}-body`;

  // Clickable header — wraps the label, badge and toggle.
  // Keyboard activation is via Enter / Space on the
  // <button> child below.
  const header = document.createElement('div');
  header.className = 'metadata-group-header';

  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.className = 'metadata-group-header-button';
  headerButton.setAttribute('aria-expanded', 'true');
  headerButton.setAttribute('aria-controls', bodyId);
  headerButton.id = headerId;
  headerButton.setAttribute('aria-label', t(group.labelKey));

  const label = document.createElement('span');
  label.className = 'metadata-group-label text-h3';
  label.textContent = t(group.labelKey);
  headerButton.appendChild(label);

  if (group.sensitive) {
    const badge = document.createElement('span');
    badge.className = 'metadata-group-badge';
    badge.textContent = t('results.groups.sensitive.badge');
    headerButton.appendChild(badge);
  }

  const chevron = document.createElement('span');
  chevron.className = 'metadata-group-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';
  headerButton.appendChild(chevron);

  header.appendChild(headerButton);

  // Per-group "select all / deselect all" toggle. Visual
  // is a single button whose label flips based on the
  // group's current state — first click deselects all,
  // next selects all, and so on.
  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'metadata-group-toggle-all btn btn-secondary';
  selectAllBtn.textContent = computeToggleLabel(group);
  selectAllBtn.addEventListener('click', () => {
    const allSelected = group.tags.every((t) => t.selected);
    const nextSelected = !allSelected;
    for (const tag of group.tags) {
      tag.selected = nextSelected;
    }
    // Re-sync UI: every tag row's checkbox + the toggle's
    // own label.
    section
      .querySelectorAll('.metadata-tag-checkbox')
      .forEach((cb) => {
        cb.checked = nextSelected;
      });
    section
      .querySelectorAll('.metadata-tag-row')
      .forEach((row) => {
        row.classList.toggle('metadata-tag-row--deselected', !nextSelected);
      });
    selectAllBtn.textContent = computeToggleLabel(group);
    onSelectionChange();
  });
  header.appendChild(selectAllBtn);

  // Collapsible body — uses CSS grid-row trick for smooth
  // height animation; the global prefers-reduced-motion
  // rule disables the transition for users who request it.
  const body = document.createElement('div');
  body.className = 'metadata-group-body';
  body.id = bodyId;
  body.setAttribute('role', 'group');
  body.setAttribute('aria-labelledby', headerId);

  const bodyInner = document.createElement('ul');
  bodyInner.className = 'metadata-tag-list';
  body.appendChild(bodyInner);

  for (const tag of group.tags) {
    bodyInner.appendChild(buildTagRow(tag, model, onSelectionChange));
  }

  headerButton.addEventListener('click', () => {
    const isExpanded = headerButton.getAttribute('aria-expanded') === 'true';
    const next = !isExpanded;
    headerButton.setAttribute('aria-expanded', String(next));
    body.classList.toggle('is-collapsed', !next);
  });

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

/**
 * Compute the visible label for a group's select-all /
 * deselect-all toggle based on its current selection
 * state. When every tag is selected the next action is
 * to deselect; otherwise it's to select all.
 */
function computeToggleLabel(group) {
  const allSelected = group.tags.length > 0 && group.tags.every((t) => t.selected);
  return t(allSelected ? 'results.toggle.deselectAll' : 'results.toggle.selectAll');
}

/**
 * Walk the live model and return the canonical tag IDs the
 * user currently has checked. The array order follows the
 * model order (groups first, then tags in declaration order);
 * duplicates are impossible because tag.id is canonicalised
 * by metadataParser and the UI never inserts the same tag
 * twice.
 *
 * Phase 5: used by the "Borrar seleccionados" click handler
 * to pass the live selection to the orchestrator's write
 * call. The view — not the orchestrator's cached
 * `lastSelection` — is the source of truth at click time.
 *
 * @param {{groups: Array<{tags: Array<{id: string, selected: boolean}>}>}} model
 * @returns {string[]}
 */
function collectSelectedIds(model) {
  if (!model || !Array.isArray(model.groups)) return [];
  const ids = [];
  for (const group of model.groups) {
    if (!Array.isArray(group.tags)) continue;
    for (const tag of group.tags) {
      if (tag && tag.selected && typeof tag.id === 'string') {
        ids.push(tag.id);
      }
    }
  }
  return ids;
}

/**
 * Build a single tag row: checkbox + label + value.
 * The row is wrapped in a <label> so the entire row is
 * clickable, and the checkbox state stays in sync with
 * `tag.selected`.
 */
function buildTagRow(tag, model, onSelectionChange) {
  const li = document.createElement('li');
  li.className = 'metadata-tag-row';
  if (!tag.selected) li.classList.add('metadata-tag-row--deselected');

  const labelEl = document.createElement('label');
  labelEl.className = 'metadata-tag-label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'metadata-tag-checkbox';
  checkbox.checked = Boolean(tag.selected);
  checkbox.setAttribute(
    'aria-label',
    `${tag.id}: ${tag.value}`
  );
  checkbox.addEventListener('change', () => {
    tag.selected = checkbox.checked;
    li.classList.toggle('metadata-tag-row--deselected', !tag.selected);
    // Sync the group's select-all toggle label (it may
    // have flipped from "all selected" to "not all").
    const section = li.closest('.metadata-group');
    if (section) {
      const toggleAll = section.querySelector('.metadata-group-toggle-all');
      if (toggleAll) {
        const cbs = section.querySelectorAll('.metadata-tag-checkbox');
        const allChecked = Array.from(cbs).every((cb) => cb.checked);
        toggleAll.textContent = t(
          allChecked
            ? 'results.toggle.deselectAll'
            : 'results.toggle.selectAll'
        );
      }
    }
    onSelectionChange();
  });
  labelEl.appendChild(checkbox);

  const name = document.createElement('span');
  name.className = 'metadata-tag-name text-mono';
  name.textContent = tag.id;
  labelEl.appendChild(name);

  // The value is rendered in its own span so the CSS
  // truncation / ellipsis applies to the value only —
  // the tag name should always fit on screen.
  const valueEl = document.createElement('span');
  valueEl.className = 'metadata-tag-value text-body';
  // Title attribute always carries the full, un-truncated
  // value for hover / focus tooltip.
  valueEl.setAttribute('title', tag.value);
  // Visible text: truncated single-line value via
  // CSS; the JS truncate() ensures we never feed the DOM
  // a value longer than the threshold even on browsers
  // without text-overflow support.
  valueEl.textContent = truncate(tag.value, VALUE_TRUNCATE_CHARS);
  labelEl.appendChild(valueEl);

  li.appendChild(labelEl);
  return li;
}

/**
 * Build the bottom action bar. Returns the element PLUS a
 * `syncRemoveSelected()` helper so the per-tag handlers
 * can update the "Borrar seleccionados" disabled state
 * without re-walking the DOM (the previous MutationObserver
 * approach was too clever and missed updates when buttons
 * were added to the DOM after the observer was created).
 */
function buildActions({ onBack, onRemove, model }) {
  const bar = document.createElement('div');
  bar.className = 'results-actions';

  // Phase 5: these fire onRemove with the live selection.
  // For "Borrar todo", tagsToRemove is null (the Worker
  // interprets it as "everything writable"). For "Borrar
  // seleccionados", tagsToRemove is the current selectedIds
  // array read from the model AT CLICK TIME — not from the
  // last onSelectionChange callback — so a stale orchestrator
  // cache cannot send the Worker the wrong set of tags.
  const removeAllBtn = document.createElement('button');
  removeAllBtn.type = 'button';
  removeAllBtn.className = 'btn btn-primary';
  removeAllBtn.textContent = t('results.actions.removeAll');
  removeAllBtn.addEventListener('click', () => {
    if (onRemove) onRemove({ removeAll: true, fileId: model.fileId, tagsToRemove: null });
  });
  bar.appendChild(removeAllBtn);

  const removeSelectedBtn = document.createElement('button');
  removeSelectedBtn.type = 'button';
  removeSelectedBtn.className = 'btn';
  removeSelectedBtn.textContent = t('results.actions.removeSelected');
  removeSelectedBtn.addEventListener('click', () => {
    if (onRemove) onRemove({
      removeAll: false,
      fileId: model.fileId,
      tagsToRemove: collectSelectedIds(model),
    });
  });
  bar.appendChild(removeSelectedBtn);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn';
  backBtn.textContent = t('results.actions.back');
  if (onBack) backBtn.addEventListener('click', onBack);
  bar.appendChild(backBtn);

  function syncRemoveSelected() {
    const anySelected = model.groups.some((g) =>
      g.tags.some((t) => t.selected)
    );
    removeSelectedBtn.disabled = !anySelected;
  }

  return { element: bar, syncRemoveSelected };
}

/**
 * Notify the orchestrator that the selection changed.
 * The MetadataSelection shape per Data Model §3.4 is
 * rebuilt from the live model every time.
 *
 * @param {object} model
 * @param {((s: object) => void) | null} onSelectionChange
 * @param {() => void} [onAfter] — internal hook fired
 *   after the orchestrator callback, used to keep the
 *   action bar's disabled state in sync.
 */
function notifySelectionChange(model, onSelectionChange, onAfter) {
  const selectedTagIds = new Set();
  let totalSelected = 0;
  let totalTags = 0;
  for (const group of model.groups) {
    for (const tag of group.tags) {
      totalTags += 1;
      if (tag.selected) {
        selectedTagIds.add(tag.id);
        totalSelected += 1;
      }
    }
  }
  if (typeof onSelectionChange === 'function') {
    onSelectionChange({
      fileId: model.fileId,
      selectedTagIds,
      removeAll: totalTags > 0 && totalSelected === totalTags,
    });
  }
  if (typeof onAfter === 'function') onAfter();
}
