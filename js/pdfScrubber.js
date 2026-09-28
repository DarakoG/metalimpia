/*
 * MetaLimpia — PDF metadata scrubber (pdf-lib)
 *
 * Lazy-loaded module. Imported only on the PDF write path
 * (handlePdfScopeConfirm in js/main.js) so non-PDF loads do not
 * pay the ~300 KB tree-shaken pdf-lib bundle cost on first paint.
 *
 * What this module strips from a PDF, per the design spec for the
 * PDF path:
 *
 *   - Info dict (Title / Author / Subject / Keywords / Producer /
 *     Creator / CreationDate / ModDate). Reference cleared from
 *     trailerInfo.Info so the PDFWriter omits /Info from the
 *     trailer dictionary; the underlying indirect object is also
 *     removed from the PDFContext so it is not serialised as an
 *     orphan (PDFWriter.ts and PDFStreamWriter.ts iterate the
 *     full indirectObjects map; just unlinking from the catalog
 *     is not enough).
 *
 *   - Catalog keys: /Metadata (XMP stream), /PieceInfo (editor
 *     history), /StructTreeRoot (logical structure), /AA
 *     (additional-actions), /MarkInfo (document marks), /Names
 *     (the names dictionary — including embedded JavaScript).
 *     Each one is removed from the catalog AND, when its value
 *     is an indirect PDFRef, from the context (same reason as
 *     the Info dict).
 *
 *   - pdf-lib's own metadata stamp (Producer: "pdf-lib..." and
 *     ModDate: now). Disabled via the `updateMetadata: false`
 *     load option so pdf-lib does not overwrite any fields that
 *     survive the scrub above with its own fingerprint.
 *
 * What this module does NOT touch:
 *
 *   - PDF text content, fonts, images, page trees. Re-serialising
 *     the document with PDFWriter preserves them.
 *   - Page-level annotation authors (they live on each page's
 *     /Annots entry, not in the catalog keys above).
 *   - Digital signatures — re-serialising invalidates them.
 *     Documented in the BEFORE-cleanup scope disclosure.
 *
 * Errors:
 *
 *   - EncryptedPDFError → Error { code: 'pdf_encrypted' }.
 *     The orchestrator routes that through mapLoaderErrorToI18nKey
 *     to errors.pdfEncrypted (which already exists in locales/es.json
 *     and the ERROR_I18N_KEYS table in js/ui/errorView.js).
 *
 *   - Any other pdf-lib load/save throw → Error { code: 'corrupted' }
 *     because the file is unreadable or the save collapsed.
 *
 * `ignoreEncryption` is left at the default (`false`) on purpose:
 * we MUST surface encrypted PDFs to the user instead of silently
 * scrubbing the unencrypted wrappers. See Data Model §3.5 and the
 * encrypted-PDF detection flow in js/workers/pdfEncryptionDetect.js
 * for the complementary Worker-side detection that catches
 * encrypted PDFs at the ExifTool stage.
 */

import { PDFDocument, EncryptedPDFError } from 'pdf-lib';

/**
 * Catalog key names to drop from the PDF. Each name is the
 * un-prefixed form (without the leading "/"); we compare against
 * PDFName.asString() which returns the leading-slash form and
 * slice it off.
 */
const CATALOG_KEYS_TO_REMOVE = new Set([
  'Metadata',       // XMP metadata stream (PDF 1.4+)
  'PieceInfo',      // private editor application data
  'StructTreeRoot', // logical structure tree
  'AA',             // additional-actions (open/close/etc.)
  'MarkInfo',       // document mark info
  'Names',          // names dictionary (incl. embedded JavaScript)
]);

/**
 * Scrub PDF metadata from a buffer.
 *
 * @param {ArrayBuffer} buffer — raw PDF bytes (transferable; not mutated)
 * @returns {Promise<ArrayBuffer>} — cleaned PDF bytes
 *
 * Throws:
 *   - Error { code: 'pdf_encrypted' } for password-protected PDFs
 *   - Error { code: 'corrupted' } for unreadable / unloadable PDFs
 */
export async function scrubPdf(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    const err = new Error('scrubPdf: buffer must be an ArrayBuffer');
    err.code = 'corrupted';
    throw err;
  }

  let pdfDoc;
  try {
    // updateMetadata:false — skip pdf-lib's auto-stamp of
    //   Producer (pdf-lib URL) + ModDate (now). We are not
    //   authoring the file; we are cleaning it.
    // ignoreEncryption:false (the default) — encrypted PDFs
    //   MUST surface as a user-facing error rather than
    //   silently scrubbing the unencrypted wrappers.
    pdfDoc = await PDFDocument.load(buffer, {
      updateMetadata: false,
      ignoreEncryption: false,
    });
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      const wrapped = new Error(
        'PDF protegido con contraseña (no se puede limpiar)'
      );
      wrapped.code = 'pdf_encrypted';
      throw wrapped;
    }
    const detail = err && err.message ? err.message : String(err);
    const wrapped = new Error(`No se pudo leer el PDF: ${detail}`);
    wrapped.code = 'corrupted';
    throw wrapped;
  }

  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;

  // ---- 1. Drop the Info dict -----------------------------------
  // The Info dict lives in trailerInfo.Info, NOT in the catalog.
  // We clear the trailer reference first so the writer omits
  // /Info from the trailer dictionary (createTrailerDict() in
  // PDFWriter.ts keys off trailerInfo.Info), then unlink the
  // indirect object so the writer does not serialise it as an
  // orphan.
  if (context.trailerInfo && context.trailerInfo.Info) {
    const infoRef = context.trailerInfo.Info;
    context.trailerInfo.Info = undefined;
    if (infoRef && typeof infoRef.objectNumber === 'number') {
      context.delete(infoRef);
    }
  }

  // ---- 2. Drop the listed catalog keys -------------------------
  // Walk the catalog's existing PDFName keys (returned by
  // PDFDict.keys()) and for each one that matches our list:
  //   - delete from the catalog so the writer does not emit
  //     the key in the catalog dictionary;
  //   - if the value is an indirect PDFRef, also delete from
  //     the context so the writer does not emit the orphaned
  //     indirect object.
  for (const key of catalog.keys()) {
    const encoded = typeof key.asString === 'function' ? key.asString() : null;
    if (typeof encoded !== 'string' || !encoded.startsWith('/')) continue;
    const name = encoded.slice(1);
    if (!CATALOG_KEYS_TO_REMOVE.has(name)) continue;
    const value = catalog.get(key);
    catalog.delete(key);
    if (value && typeof value.objectNumber === 'number') {
      context.delete(value);
    }
  }

  // ---- 2.5. Compact largestObjectNumber -----------------------
  // After deleting indirect objects, the context's
  // `largestObjectNumber` counter still remembers the
  // highest number it ever handed out. The PDFWriter writes
  // `Size: largestObjectNumber + 1` in the trailer dict, so
  // leaving the counter stale would inflate /Size on the
  // FIRST scrub (where deleted objects pushed it up) but
  // not on subsequent scrubs of the cleaned bytes — making
  // the output non-byte-identical between scrubs.
  //
  // Walk the surviving indirect objects and recompute the
  // counter from the actual highest ref. This keeps /Size
  // stable across re-scrubs and gives the spec-required
  // "idempotent re-clean gives same bytes" property.
  let maxObjNum = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (ref.objectNumber > maxObjNum) maxObjNum = ref.objectNumber;
  }
  context.largestObjectNumber = maxObjNum;

// ---- 3. Re-serialise -----------------------------------------
  // pdf-lib returns a Uint8Array; the rest of the app expects
  // an ArrayBuffer. Allocate a fresh buffer so the bytes are
  // independent of the underlying Uint8Array's memory and can
  // be safely transferred or wrapped in a Blob for download.
  //
  // Options we set explicitly (and why):
  //
  //   useObjectStreams: false  — pdf-lib's default writes
  //     indirect objects into compressed cross-reference
  //     object streams, which are non-deterministic across
  //     re-parse/re-save round trips (verified by
  //     scripts/verify-pdf-scrubber.mjs without this flag:
  //     first scrub output is byte-different from the
  //     second scrub output even though they carry the same
  //     metadata-absent content). Disabling object streams
  //     makes the writer emit every indirect object as its
  //     own top-level `N 0 obj ... endobj` block, which is
  //     deterministic and gives the spec-required
  //     "idempotent re-clean gives same bytes" property.
  //     Cost: output is roughly 2× the size of the compressed
  //     output (acceptable — the cleaned file replaces the
  //     original upload; ~1 MB extra for a typical PDF).
  //
  //   updateFieldAppearances: false — pdf-lib would otherwise
  //     lazily create an empty AcroForm dictionary the first
  //     time getForm() is accessed (save() calls it for field
  //     appearance regeneration). The cleaned PDF does not
  //     carry form-field metadata we care about scrubbing, so
  //     we skip the AcroForm side-effect to keep the output
  //     structure as close to the input as possible.
  const out = await pdfDoc.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
  const cleaned = new ArrayBuffer(out.byteLength);
  new Uint8Array(cleaned).set(out);
  return cleaned;
}