/*
 * MetaLimpia — PDF encryption detection (pure helper)
 *
 * ExifTool's stderr text contains recognizable phrases when a PDF
 * is encrypted with an owner or user password:
 *
 *   - "encrypted"        — canonical phrase: "PDF is encrypted",
 *                          "file is encrypted", "encrypted PDF".
 *                          Strongest signal; covers most owner-
 *                          encrypted PDFs.
 *   - "bad password"     — ExifTool prompted for the user password
 *                          and the value was wrong. Canonical
 *                          ExifTool wording.
 *   - "wrong password"   — alternate phrasing observed across
 *                          ExifTool 11.x and 12.x; kept for
 *                          coverage.
 *
 * The list is bounded on purpose: we only claim "encrypted" when
 * we can prove (via the file extension) the file even CAN be
 * encrypted. JPG / PNG / DOCX never carry these phrases in
 * ExifTool stderr, and the extension gate keeps false positives
 * impossible.
 *
 * The phrase "password required" or "password is required" appears
 * in some ExifTool variants when a user password is needed but not
 * supplied. We intentionally do NOT match those phrases because the
 * matching would need word-order-tolerant regexes (e.g. "password
 * is required" vs "password required") that introduce false-positive
 * risk on PDFs whose metadata contains the word "password" (a real
 * edge case — some PDFs do carry a `UserPassword` field as actual
 * metadata, not encryption). The .pdf extension gate protects us
 * from format-level false positives, but the strongest in-PDF
 * signal is still "encrypted" — ExifTool will mention it when the
 * file is actually encrypted.
 *
 * PURE FUNCTION — importable from Node verify scripts without a
 * Worker / WASM runtime. The Worker imports this module via the
 * standard ESM `import` syntax; Vite bundles it into the worker
 * bundle the same way it bundles the vendored ExifTool wrapper.
 *
 * ExifTool 13.42 is the vendored version; if a future version
 * introduces a new phrase (say, "PDF write-protected"), extend
 * the list here and update scripts/verify-pdf-encryption.mjs in
 * the same commit.
 */

/**
 * Return true if the supplied ExifTool stderr / last-error text
 * smells like an encrypted or password-protected PDF.
 *
 * The file extension is the safety belt: without a `.pdf` suffix
 * (case-insensitive), the function returns false regardless of
 * what `detail` contains. This keeps a JPG whose ExifTool stderr
 * happens to contain the substring "encrypted" (theoretically
 * possible if a tag's name contains that word) from being
 * misclassified.
 *
 * @param {string} detail — ExifTool stderr / last Perl error.
 * @param {string} fileName — original filename (extension gate).
 * @returns {boolean}
 */
export function looksLikeEncryptedPdf(detail, fileName) {
  if (typeof fileName !== 'string') return false;
  if (!fileName.toLowerCase().endsWith('.pdf')) return false;
  if (typeof detail !== 'string' || detail.length === 0) return false;
  const lower = detail.toLowerCase();
  return (
    lower.includes('encrypted') ||
    lower.includes('bad password') ||
    lower.includes('wrong password')
  );
}