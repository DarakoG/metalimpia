/*
 * MetaLimpia — drag-drop and click-to-select uploader
 *
 * Wires the #dropzone element to a hidden <input type="file">
 * and exposes a single `onFile` callback for the orchestrator.
 *
 * Implementation Plan §5, tasks 2.2–2.5:
 *  - dragenter / dragover / dragleave / drop with preventDefault
 *    so the browser actually accepts the drop
 *  - is-dragging class on the dropzone for visual feedback
 *  - click on dropzone opens the file picker (and Enter / Space
 *    on the keyboard does the same — dropzone is role=button)
 *  - hidden <input type="file"> with accept attribute from
 *    the fileHandler allowlist
 *  - only the first file of a dropped batch is processed
 *    (subsequent files silently ignored per spec §5 task 2.2)
 *
 * CSP: no eval, no inline handlers, no fetch. The orchestrator
 * decides what to do with the file; this module never touches
 * state beyond the dropzone element and the input element.
 */

import { ACCEPT_ATTR } from '../fileHandler.js';

/**
 * Wire the dropzone to a file picker and drag-drop target.
 *
 * @param {object} config
 * @param {string} config.dropzoneSelector — CSS selector for
 *   the dropzone element (defaults to '#dropzone').
 * @param {string} config.inputId — id attribute of the hidden
 *   file input (defaults to 'file-input'). If the element does
 *   not exist yet, one is created and appended to <body>.
 * @param {(file: File) => void} config.onFile — invoked once
 *   per accepted file. Only the first file of a multi-file
 *   drop is passed through.
 */
export function wireUploader({
  dropzoneSelector = '#dropzone',
  inputId = 'file-input',
  onFile,
} = {}) {
  const dropzone = document.querySelector(dropzoneSelector);
  if (!dropzone) return;

  const input = ensureFileInput(inputId);

  if (typeof onFile === 'function') {
    bindHandlers(dropzone, input, onFile);
  }
}

/**
 * Heuristic check for "this dropped entry is a directory, not
 * a file". Per Flow §7 edge case 7.5 / Implementation Plan §9
 * task 6.10: directories are silently ignored — no error UI.
 *
 * Detection: directory entries arrive as File objects with
 *   - size === 0
 *   - type === '' (no MIME type)
 *   - name without a file extension
 *
 * This combination is also possible for "real" empty files
 * without an extension (e.g. "README" with 0 bytes), but those
 * will be rejected by validateFile with the existing
 * 'empty' / 'unsupported_format' error path; treating the
 * directory case as silent-ignore is the gentler behaviour
 * because it keeps a stray folder drop from blowing up the
 * UI when the user clearly did not intend to upload one.
 *
 * @param {File} file
 * @returns {boolean}
 */
function isProbablyDirectory(file) {
  if (!file) return false;
  if (typeof file.size !== 'number' || file.size !== 0) return false;
  if (file.type) return false;
  // Has a file extension? Treat as a (possibly empty) file,
  // not a directory.
  return !/\.[^./\\]+$/.test(file.name || '');
}

/**
 * Get or create the hidden <input type="file"> and apply the
 * allowlist as the `accept` attribute. The `accept` attribute
 * is set programmatically every boot so the source of truth
 * for the allowlist stays in fileHandler.js.
 */
function ensureFileInput(id) {
  let input = document.getElementById(id);
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    input.hidden = true;
    document.body.appendChild(input);
  }
  input.accept = ACCEPT_ATTR;
  return input;
}

function bindHandlers(dropzone, input, onFile) {
  // dragCounter pattern: dragenter / dragleave fire for child
  // elements too, so a naïve toggle would flicker when the
  // pointer crosses the icon / text spans. Counting entries
  // vs. leaves and only clearing at 0 keeps the highlight
  // stable while a drag is in progress.
  let dragDepth = 0;

  function setDragging(on) {
    dropzone.classList.toggle('is-dragging', on);
  }

  // Click anywhere on the dropzone opens the file picker.
  dropzone.addEventListener('click', () => {
    input.click();
  });

  // Keyboard activation: Enter or Space on the role="button"
  // dropzone opens the picker. preventDefault on Space so the
  // page does not scroll.
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  // Prevent the browser from navigating to the file when
  // dropped outside a dropzone (default browser behaviour
  // for the whole document). We attach to window so a missed
  // drop does not break the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    setDragging(true);
  });

  dropzone.addEventListener('dragover', (e) => {
    // Required to allow the drop. Calling preventDefault
    // without setting dropEffect produces the default copy
    // cursor, which is fine — the file is "kept" locally.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    setDragging(false);

    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      // Per spec §5 task 2.2: only the first file of a batch
      // is processed. Subsequent files are silently ignored.
      const first = files[0];
      // Flow §7 edge case — a directory drop is silently
      // ignored (no error UI) so a stray folder does not
      // blow up the screen.
      if (isProbablyDirectory(first)) return;
      onFile(first);
    }
  });

  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) {
      const first = input.files[0];
      if (isProbablyDirectory(first)) {
        // Reset the input even on ignored directories so a
        // subsequent legitimate pick fires the change event.
        input.value = '';
        return;
      }
      onFile(first);
      // Reset the input so selecting the same file twice
      // still fires the change event. Without this, the
      // browser caches the value and skips the handler.
      input.value = '';
    }
  });
}