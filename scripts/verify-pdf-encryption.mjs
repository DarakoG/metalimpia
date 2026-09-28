/*
 * MetaLimpia — PDF encryption detection verify script.
 *
 * Unit-tests the looksLikeEncryptedPdf() helper against synthetic
 * ExifTool stderr / last-error shapes. Does NOT spin up the Worker
 * or the WASM runtime — that is the Playwright suite's job. This
 * script's value is exercising the regex phrase list in isolation
 * so future ExifTool upgrades can extend the list without
 * regression.
 *
 * Run from C:\NodeJS\MetaLimpia:
 *   node scripts/verify-pdf-encryption.mjs
 *
 * Exit code:
 *   0 — every assertion passed.
 *   1 — at least one assertion failed (printed to stderr).
 *
 * Not shipped with MetaLimpia; lives under scripts/ alongside the
 * other Phase-N verify harnesses (verify-exiftool, verify-write).
 */

import { looksLikeEncryptedPdf } from '../js/workers/pdfEncryptionDetect.js';

/**
 * Test cases. Each entry: { detail, fileName, expected, why }.
 * `expected` is the boolean the detection function must return.
 */
const CASES = [
  // ---- TRUE: classic encryption shapes on PDFs. ----
  {
    detail: 'Error: PDF is encrypted - could not read/write tags',
    fileName: 'contrato.pdf',
    expected: true,
    why: 'canonical "PDF is encrypted" stderr',
  },
  {
    detail: 'File is encrypted with AES-256. Skipping write.',
    fileName: 'doc.pdf',
    expected: true,
    why: '"file is encrypted" variant',
  },
  {
    detail: 'Bad password: ExifTool could not decrypt the PDF',
    fileName: 'informe.pdf',
    expected: true,
    why: '"Bad password" ExifTool phrase',
  },
  {
    detail: 'Wrong password supplied for /path/to/file.pdf',
    fileName: 'sample.pdf',
    expected: true,
    why: '"Wrong password" alternate phrasing',
  },
  {
    detail: 'Warning: file appears to be ENCRYPTED; cannot modify in place',
    fileName: 'mixed-case.Pdf',
    expected: true,
    why: 'case-insensitive phrase match + case-insensitive extension',
  },
  {
    detail: 'A password is required to write this PDF file.',
    fileName: 'protected.pdf',
    expected: false,
    why: '"password is required" does NOT contain adjacent "password required" — design choice, see header comment',
  },
  {
    detail: 'The password you supplied is incorrect for archivo.PDF',
    fileName: 'archivo.PDF',
    expected: false,
    why: 'non-canonical "password is incorrect" — ExifTool uses "Bad/Wrong password", not "password incorrect"',
  },

  // ---- FALSE: same phrases on non-PDF extensions. ----
  {
    detail: 'Error: file is encrypted',
    fileName: 'photo.jpg',
    expected: false,
    why: 'extension gate: JPG is never "encrypted PDF"',
  },
  {
    detail: 'Bad password',
    fileName: 'document.docx',
    expected: false,
    why: 'extension gate: DOCX is never "encrypted PDF"',
  },
  {
    detail: 'Bad password',
    fileName: 'spreadsheet.xlsx',
    expected: false,
    why: 'extension gate: XLSX is never "encrypted PDF"',
  },
  {
    detail: 'Bad password',
    fileName: 'presentation.pptx',
    expected: false,
    why: 'extension gate: PPTX is never "encrypted PDF"',
  },
  {
    detail: 'Bad password',
    fileName: 'photo.png',
    expected: false,
    why: 'extension gate: PNG is never "encrypted PDF"',
  },

  // ---- FALSE: real write failures on PDFs that are NOT encryption. ----
  {
    detail: 'Error: xref table is corrupt at byte 12345',
    fileName: 'broken.pdf',
    expected: false,
    why: 'PDF but the failure is structural, not encryption',
  },
  {
    detail: 'Nothing to do.',
    fileName: 'empty-tags.pdf',
    expected: false,
    why: 'PDF but no encryption indicators',
  },
  {
    detail: '',
    fileName: 'unknown.pdf',
    expected: false,
    why: 'empty stderr detail must not false-positive',
  },

  // ---- FALSE: adversarial inputs. ----
  {
    detail: 'UserPassword tag set to 12345',
    fileName: 'metadata.pdf',
    expected: false,
    why: 'PDF with metadata containing the word "password" is not encrypted',
  },
  {
    detail: null,
    fileName: 'test.pdf',
    expected: false,
    why: 'null detail must not throw and must return false',
  },
  {
    detail: 'Bad password',
    fileName: null,
    expected: false,
    why: 'null fileName must not throw and must return false',
  },
  {
    detail: 'Bad password',
    fileName: '',
    expected: false,
    why: 'empty fileName must return false (no .pdf suffix)',
  },
  {
    detail: 'Bad password',
    fileName: 'pdf-without-dot',
    expected: false,
    why: 'no .pdf extension at all',
  },
];

function run() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const tc of CASES) {
    let got;
    try {
      got = looksLikeEncryptedPdf(tc.detail, tc.fileName);
    } catch (err) {
      failed += 1;
      failures.push({
        case: tc,
        got: `THREW: ${err.message}`,
      });
      continue;
    }
    if (got === tc.expected) {
      passed += 1;
    } else {
      failed += 1;
      failures.push({
        case: tc,
        got,
      });
    }
  }

  console.log(`--- MetaLimpia PDF encryption detection verify ---`);
  console.log(`total cases: ${CASES.length}`);
  console.log(`passed:      ${passed}`);
  console.log(`failed:      ${failed}`);
  console.log();

  if (failures.length > 0) {
    console.error('FAILURES:');
    for (const f of failures) {
      console.error(
        `  expected=${f.case.expected} got=${f.got}\n` +
          `    detail:   ${JSON.stringify(f.case.detail)}\n` +
          `    fileName: ${JSON.stringify(f.case.fileName)}\n` +
          `    why:      ${f.case.why}`
      );
    }
    process.exit(1);
  }

  console.log('SUCCESS — every detection case matched the expected verdict.');
  console.log('Run from project root: node scripts/verify-pdf-encryption.mjs');
}

run();