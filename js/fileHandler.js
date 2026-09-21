/*
 * MetaLimpia — file validation
 *
 * Per Data Model §8.1:
 * - Empty file (size === 0)         → 'empty' error
 * - File > 200 MB                   → 'too_large' error
 * - Extension not in allowlist      → 'unsupported_format' error
 *
 * The validator is a pure function: it returns one of the
 * shapes below and does not touch the DOM, the network, or
 * any module-level mutable state. The orchestrator decides
 * how to surface the result (error view, transition, etc.).
 *
 * `readFile` is a thin wrapper over `File.arrayBuffer()`. We
 * keep it here so any future streaming / chunked-reading
 * strategy lives in one module rather than scattered across
 * callers.
 */

/**
 * Maximum accepted file size, in bytes. Matches the spec
 * §4 of the Implementation Plan and the language used in
 * `errors.tooLarge`.
 */
export const MAX_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * Lowercase, dot-less file extensions MetaLimpia can process.
 * Mirrored in the locale string `errors.formatsList`; keep
 * the human-readable list in sync when this set changes.
 */
export const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'tiff',
  'tif',
  'heic',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
]);

/**
 * Pre-formatted `accept` attribute value for a hidden
 * `<input type="file">`. e.g. ".jpg,.jpeg,.png,...". Exposed
 * so the uploader can wire the input without duplicating the
 * allowlist in markup.
 */
export const ACCEPT_ATTR = Array.from(ALLOWED_EXTENSIONS, (ext) => `.${ext}`).join(',');

/**
 * Validate a File against the MetaLimpia allowlist.
 *
 * Returns either `{ ok: true }` or `{ ok: false, error }`
 * where `error` is one of the string codes documented above.
 * Callers can switch on `error` to attach context for the
 * i18n interpolation (e.g. the file size for `too_large`).
 *
 * @param {File} file
 * @returns {{ok: true} | {ok: false, error: 'empty' | 'too_large' | 'unsupported_format'}}
 */
export function validateFile(file) {
  if (file.size === 0) {
    return { ok: false, error: 'empty' };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, error: 'too_large' };
  }

  // `split('.').pop()` mirrors the Data Model §8.1 reference
  // implementation. Optional chaining guards against a missing
  // `pop` result on edge inputs; the falsy check rejects both
  // undefined and empty-string results.
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'unsupported_format' };
  }

  return { ok: true };
}

/**
 * Read a File into an ArrayBuffer using the modern Promise
 * API. Kept here so any future chunked / streaming strategy
 * lives in one module.
 *
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFile(file) {
  return file.arrayBuffer();
}