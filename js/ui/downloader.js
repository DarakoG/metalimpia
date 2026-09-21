/*
 * MetaLimpia — download helper
 *
 * Phase 5 wires the cleaned file from the Worker's write op
 * into a browser download. Two responsibilities live here:
 *
 *   1. buildCleanedFilename(originalName) — produce the
 *      download filename following the spec pattern
 *      `{originalNameWithoutExt}-limpio.{ext}`. Used by the
 *      orchestrator when transitioning to the `done` state.
 *
 *   2. triggerDownload(cleanedBuffer, downloadName, mimeType)
 *      — programmatic Blob URL download per Data Model §7.3.
 *      Constructed from the cleaned ArrayBuffer so the file
 *      never leaves the browser (no fetch, no data-URI
 *      round-trip, no DOM insertion).
 *
 * Privacy notes:
 *   - The Blob URL is same-origin (per browser spec, blob:
 *     URLs created from the page's own blobs inherit the
 *     creator origin). The strict CSP already allows
 *     `blob:` for workers; the click() does not trigger a
 *     network request, only the local download.
 *   - URL.revokeObjectURL is called immediately after the
 *     click(). The browser has already read the bytes to
 *     start the download; revoking the URL only frees the
 *     Blob reference, it does not abort the in-flight
 *     download.
 *   - The `<a>` element is created in memory and clicked
 *     programmatically. It is NOT appended to the DOM, so
 *     it never appears as an `<a href="blob:...">` element
 *     in the page.
 *
 * CSP / a11y:
 *   - No innerHTML, no eval, no inline handlers.
 *   - The function is fire-and-forget — the caller's UI
 *     updates (e.g. moving to the `done` state) happen on
 *     the click, which is synchronous.
 */

/**
 * Build the cleaned-file download name from the original
 * filename. Per Implementation Plan task 5.3 / Data Model
 * §5.1: pattern is `{originalNameWithoutExt}-limpio.{ext}`.
 *
 * Edge cases:
 *   - "vacaciones.jpg"           → "vacaciones-limpio.jpg"
 *   - "IMG_1234.HEIC"            → "IMG_1234-limpio.heic"
 *     (extension is lowercased — keeps the file association
 *      consistent with the original extension's casing in
 *      `file.name`, which is what the OS uses to pick the
 *      default app).
 *   - "my.photo.backup.tar.gz"   → "my.photo.backup.tar-limpio.gz"
 *     (last `.` is the extension boundary).
 *   - "README" (no extension)    → "README-limpio"
 *   - ".hidden" (dotfile)        → ".hidden-limpio"
 *     (hidden files have a leading `.` but no name.ext split
 *      — treat the entire name as the "base").
 *   - "" / null / undefined      → "limpio"
 *     (defensive default; the orchestrator should always
 *      pass a real filename but this avoids throwing).
 *
 * @param {string} originalName
 * @returns {string}
 */
export function buildCleanedFilename(originalName) {
  if (typeof originalName !== 'string' || originalName.length === 0) {
    return 'limpio';
  }
  const lastDot = originalName.lastIndexOf('.');
  if (lastDot <= 0) {
    // No extension, or a dotfile (leading dot — no real
    // base/ext split). Treat the whole name as the base.
    return `${originalName}-limpio`;
  }
  const baseName = originalName.slice(0, lastDot);
  const extension = originalName.slice(lastDot + 1).toLowerCase();
  if (!extension) {
    return `${originalName}-limpio`;
  }
  return `${baseName}-limpio.${extension}`;
}

/**
 * Trigger a browser download of the cleaned bytes. Same-origin
 * Blob URL per Data Model §7.3.
 *
 * The download fires synchronously inside this function (via
 * `a.click()`); the function does not return a Promise because
 * the caller does not need to await it. The browser keeps the
 * download alive even after URL.revokeObjectURL() — the URL
 * just needs to be valid at click() time.
 *
 * @param {ArrayBuffer} cleanedBuffer — the bytes returned by
 *   the Worker's `write` op.
 * @param {string} downloadName — file name suggested to the
 *   browser via `a.download`. Built via buildCleanedFilename().
 * @param {string} [mimeType] — MIME type for the Blob. Falls
 *   back to `application/octet-stream` so the browser still
 *   offers "Save as" without guessing.
 * @returns {void}
 */
export function triggerDownload(cleanedBuffer, downloadName, mimeType) {
  if (!(cleanedBuffer instanceof ArrayBuffer)) {
    throw new TypeError(
      'triggerDownload: cleanedBuffer must be an ArrayBuffer (got ' +
        typeof cleanedBuffer +
        ')'
    );
  }
  if (typeof downloadName !== 'string' || downloadName.length === 0) {
    throw new TypeError(
      'triggerDownload: downloadName must be a non-empty string'
    );
  }

  const blob = new Blob([cleanedBuffer], {
    type: mimeType || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  // NOT appended to the DOM. Programmatic click() on a detached
  // <a download> still triggers the browser's download path.
  a.click();

  URL.revokeObjectURL(url);
}
