/*
 * Phase 4 verification script — NOT shipped with MetaLimpia.
 *
 * Exercises metadataParser.parseExiftoolOutput against a
 * realistic sample of ExifTool output (the same shape the
 * Phase 3 Worker returns with `-j -G1 -a -s`), plus the
 * real output from `scripts/verify-exiftool.mjs` so we
 * confirm the parser handles both the synthetic and the
 * real shape.
 *
 * Run from C:\NodeJS\MetaLimpia:
 *   node scripts/verify-metadata-parser.mjs
 *
 * Goal: prove the parser produces a correct FileMetadata
 * shape (Data Model §3.3) — i.e. group classification works,
 * operational tags are filtered, value formatting is sane.
 *
 * The script is read-only: it never imports the DOM modules,
 * it only imports metadataParser.js and feeds it JSON.
 */

import { parseExiftoolOutput, __internals } from '../js/metadataParser.js';

// Stub `formatBinary` so the parser stays i18n-agnostic in
// the verification environment. The real call site in
// main.js wires this to `t('results.binaryValue', { size })`.
const formatBinary = (size) => `[datos binarios — ${size} bytes]`;

// ---------------------------------------------------------------------------
// Synthetic ExifTool output (mimics a typical iPhone photo with GPS).
// Keys are prefixed with the ExifTool-internal group because we ran
// the Worker with `-G1`. This is the shape the Phase 3 Worker returns.
// ---------------------------------------------------------------------------

const SYNTHETIC_JPG = {
  // Operational — must be filtered
  SourceFile: '/Users/carla/IMG_1234.jpg',
  'ExifTool:ExifToolVersion': 13.42,
  'System:FileName': 'IMG_1234.jpg',
  'System:Directory': '/Users/carla',
  'System:FileSize': '2.4 MB',
  'System:FileModifyDate': '2024:12:15 10:00:00',
  'System:FileAccessDate': '2024:12:15 10:00:00',
  'System:FileInodeChangeDate': '2024:12:15 10:00:00',
  'System:FilePermissions': 'rw-r--r--',
  'ExifTool:Warning': '[minor] something',

  // Author group (sensitive)
  'XMP-dc:Creator': 'Carla Mendoza',
  'XMP-dc:Rights': '© 2024 Carla Mendoza',
  'EXIF:Artist': 'Carla Mendoza',
  'EXIF:Copyright': '© 2024 Carla Mendoza',

  // Location group (sensitive)
  'GPS:GPSLatitude': '40 deg 45\' 30.00" N',
  'GPS:GPSLongitude': '73 deg 59\' 12.00" W',
  'GPS:GPSAltitude': '15 m Above Sea Level',
  'XMP:GPSLatitude': '40.7583',
  'XMP:GPSLongitude': '-73.9867',

  // Dates group
  'EXIF:DateTimeOriginal': '2024:12:15 14:32:10',
  'EXIF:CreateDate': '2024:12:15 14:32:10',
  'EXIF:ModifyDate': '2024:12:15 14:32:10',

  // Device group (sensitive)
  'EXIF:Make': 'Apple',
  'EXIF:Model': 'iPhone 15 Pro',
  'EXIF:LensModel': 'iPhone 15 Pro back triple camera 6.86mm f/1.78',

  // Software group
  'EXIF:Software': '17.1.1',
  'XMP:CreatorTool': 'Apple Photos 8.0',

  // Document group
  'XMP-dc:Title': 'Sunset over Manhattan',
  'XMP-dc:Description': 'A photo from the High Line',
  'XMP-dc:Subject': ['sunset', 'manhattan', 'iphone'],
  'XMP:PageCount': 1,

  // Comments group
  'EXIF:UserComment': 'Best photo of 2024!',
  'EXIF:XPComment': 'Test comment',

  // "Other" group
  'File:ImageWidth': 4032,
  'File:ImageHeight': 3024,
  'File:ColorSpace': 'sRGB',
};

// ---------------------------------------------------------------------------
// Edge-case payload: an "empty" file plus a binary tag plus a long value.
// ---------------------------------------------------------------------------

const EDGE_CASE = {
  // Real shape from a file with NO user-visible metadata.
  SourceFile: '/tmp/clean.pdf',
  'System:FileName': 'clean.pdf',
  'System:FileSize': '512 bytes',
  'System:FileModifyDate': '2024:01:01 00:00:00',

  // Binary blob (ExifTool can emit Uint8Array for some
  // embedded previews and object streams).
  'EXIF:ThumbnailImage': new Uint8Array(1024),

  // Very long string value (truncation is a view concern,
  // but the parser must not blow up).
  'XMP:Description': 'a'.repeat(500),

  // Array with mixed types — should be joined.
  'XMP:Keywords': ['foo', 'bar', 1, true],

  // An unusual non-UTF8 character — should round-trip.
  'XMP:Title': 'Mañana — résumé',
};

let failures = 0;

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${message}`);
    // eslint-disable-next-line no-console
    console.error(`  expected: ${JSON.stringify(expected)}`);
    // eslint-disable-next-line no-console
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function assert(cond, message) {
  if (!cond) {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${message}`);
  }
}

function dumpSection(title, value) {
  // eslint-disable-next-line no-console
  console.log(`\n--- ${title} ---`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------------------
// Test 1 — Synthetic JPG: full classification + filtering + formatting.
// ---------------------------------------------------------------------------

console.log('--- MetaLimpia Phase 4 parser verification ---');
console.log('Test 1: synthetic JPG with GPS, author, device');

const meta1 = parseExiftoolOutput(SYNTHETIC_JPG, 'file-1', { formatBinary });

dumpSection('FileMetadata (synthetic JPG)', {
  fileId: meta1.fileId,
  totalCount: meta1.totalCount,
  groups: meta1.groups.map((g) => ({
    id: g.id,
    labelKey: g.labelKey,
    sensitive: g.sensitive,
    tagCount: g.tags.length,
    sample: g.tags.slice(0, 2).map((t) => ({ id: t.id, value: t.value })),
  })),
});

// Operational tags MUST NOT appear anywhere in the parsed result.
const allTagIds = meta1.groups.flatMap((g) => g.tags.map((t) => t.id));
for (const op of __internals.OPERATIONAL_TAGS) {
  if (op === 'Warning') continue; // Warning is technically operational but not in Data Model §4.3; we filter it anyway
  assert(
    !allTagIds.includes(op),
    `operational tag "${op}" leaked into the parsed output`
  );
}

// Group presence + ordering.
const groupIds = meta1.groups.map((g) => g.id);
assertEqual(groupIds[0], 'author', 'first group is author');
assert(groupIds.includes('location'), 'location group present');
assert(groupIds.includes('dates'), 'dates group present');
assert(groupIds.includes('device'), 'device group present');
assert(groupIds.includes('software'), 'software group present');
assert(groupIds.includes('document'), 'document group present');
assert(groupIds.includes('comments'), 'comments group present');
// No "other" should appear in the synthetic JPG because every
// tag in the sample fits into a curated group.

// Sensitive flag.
const author = meta1.groups.find((g) => g.id === 'author');
const dates = meta1.groups.find((g) => g.id === 'dates');
assertEqual(author && author.sensitive, true, 'author is sensitive');
assertEqual(dates && dates.sensitive, false, 'dates is not sensitive');
const device = meta1.groups.find((g) => g.id === 'device');
assertEqual(device && device.sensitive, true, 'device is sensitive');

// GPS tag must be in location (matches the GPS* prefix rule).
const location = meta1.groups.find((g) => g.id === 'location');
const gpsLat = location && location.tags.find((t) => t.id === 'GPSLatitude');
assert(gpsLat, 'GPSLatitude classified into location');
assertEqual(gpsLat && gpsLat.value, '40 deg 45\' 30.00" N', 'GPSLatitude formatted as-is');

// Date format: "2024:12:15 14:32:10" → "15/12/2024 14:32".
const datesGroup = meta1.groups.find((g) => g.id === 'dates');
const dtOriginal = datesGroup && datesGroup.tags.find((t) => t.id === 'DateTimeOriginal');
assertEqual(
  dtOriginal && dtOriginal.value,
  '15/12/2024 14:32',
  'EXIF date converted to DD/MM/YYYY HH:MM'
);

// "Description" lands in document (first match in rules).
const doc = meta1.groups.find((g) => g.id === 'document');
const desc = doc && doc.tags.find((t) => t.id === 'Description');
assert(desc, 'Description lands in document');

// All tags start selected (Data Model §3.3).
assert(
  meta1.groups.every((g) => g.tags.every((t) => t.selected === true)),
  'every tag has selected=true by default'
);

// fileId round-trip.
assertEqual(meta1.fileId, 'file-1', 'fileId preserved');

// totalCount matches the number of tags that survived filtering.
const expectedCount = allTagIds.length;
assertEqual(meta1.totalCount, expectedCount, 'totalCount matches visible tags');

// ---------------------------------------------------------------------------
// Test 2 — Real ExifTool output (from verify-exiftool.mjs).
// ---------------------------------------------------------------------------

console.log('\nTest 2: real ExifTool output from the vendored bundle');

const REAL_OUTPUT = {
  SourceFile: '/tiny.jpg',
  'ExifTool:ExifToolVersion': 13.42,
  'ExifTool:Warning': '[minor] Skipped unknown 1 bytes after JPEG DQT segment',
  'System:FileName': 'tiny.jpg',
  'System:Directory': '/',
  'System:FileSize': '261 bytes',
  'System:FileModifyDate': '0000:00:00 00:00:00',
  'System:FileAccessDate': '0000:00:00 00:00:00',
  'System:FileInodeChangeDate': '0000:00:00 00:00:00',
  'System:FilePermissions': '----------',
  'File:FileType': 'JPEG',
  'File:FileTypeExtension': 'jpg',
  'File:MIMEType': 'image/jpeg',
  'File:ImageWidth': 1,
  'File:ImageHeight': 1,
  'File:EncodingProcess': 'Baseline DCT, Huffman coding',
  'File:BitsPerSample': 8,
  'File:ColorComponents': 1,
  'JFIF:JFIFVersion': 1.01,
  'JFIF:ResolutionUnit': 'None',
  'JFIF:XResolution': 1,
  'JFIF:YResolution': 1,
  'Composite:ImageSize': '1x1',
  'Composite:Megapixels': 0.000001,
};

const meta2 = parseExiftoolOutput(REAL_OUTPUT, 'file-2', { formatBinary });

// Every visible tag in real output lands in "other" (none of
// the curated groups match). totalCount should be the count
// after stripping operational tags.
const meta2TagIds = meta2.groups.flatMap((g) => g.tags.map((t) => t.id));
console.log(`  real-output visible tags: ${meta2TagIds.length}`);
console.log(`  groups: ${meta2.groups.map((g) => `${g.id}(${g.tags.length})`).join(', ')}`);
console.log(`  sample tags: ${meta2TagIds.slice(0, 8).join(', ')}`);

// All "other" group, none sensitive.
assert(meta2.groups.length === 1, 'real output collapses into one group');
assertEqual(meta2.groups[0].id, 'other', 'real output is the "other" group');
assertEqual(meta2.groups[0].sensitive, false, '"other" is not sensitive');

// No operational tag visible.
for (const op of __internals.OPERATIONAL_TAGS) {
  assert(!meta2TagIds.includes(op), `operational tag "${op}" filtered from real output`);
}

// ---------------------------------------------------------------------------
// Test 3 — Edge cases: binary, very long, mixed arrays, unicode, empty.
// ---------------------------------------------------------------------------

console.log('\nTest 3: edge cases (binary, long string, mixed array, unicode)');

const meta3 = parseExiftoolOutput(EDGE_CASE, 'file-3', { formatBinary });
const meta3Ids = meta3.groups.flatMap((g) => g.tags.map((t) => t.id));
console.log(`  visible tags: ${meta3Ids.join(', ')}`);

// ThumbnailImage (Uint8Array) → binaryValue placeholder.
const thumbnail = meta3.groups
  .flatMap((g) => g.tags)
  .find((t) => t.id === 'ThumbnailImage');
assert(thumbnail, 'binary tag survives parsing');
assert(thumbnail && /bytes/.test(thumbnail.value), 'binary tag formatted via results.binaryValue');
assertEqual(thumbnail && thumbnail.rawValue instanceof Uint8Array, true, 'rawValue preserves binary');

// Description (500 'a's) — value is preserved fully (truncation is a view concern).
const longDesc = meta3.groups
  .flatMap((g) => g.tags)
  .find((t) => t.id === 'Description');
assert(longDesc, 'long Description survives parsing');
assertEqual(longDesc && longDesc.value.length, 500, 'long Description value is full-length');

// Keywords array joined with ", ".
const kw = meta3.groups
  .flatMap((g) => g.tags)
  .find((t) => t.id === 'Keywords');
assert(kw, 'Keywords survives parsing');
assertEqual(kw && kw.value, 'foo, bar, 1, true', 'array joined with comma-space');

// Unicode round-trip.
const title = meta3.groups
  .flatMap((g) => g.tags)
  .find((t) => t.id === 'Title');
assertEqual(title && title.value, 'Mañana — résumé', 'unicode survives');

// ---------------------------------------------------------------------------
// Test 4 — Truly empty: produces zero groups (not crashing).
// ---------------------------------------------------------------------------

console.log('\nTest 4: empty / null input');
const meta4a = parseExiftoolOutput({}, 'file-4a');
assertEqual(meta4a.totalCount, 0, 'empty object → totalCount 0');
assertEqual(meta4a.groups.length, 0, 'empty object → no groups');

// null and non-object inputs should not crash.
const meta4b = parseExiftoolOutput(null, 'file-4b', { formatBinary });
assertEqual(meta4b.totalCount, 0, 'null → totalCount 0');
const meta4c = parseExiftoolOutput('not an object', 'file-4c', { formatBinary });
assertEqual(meta4c.totalCount, 0, 'string → totalCount 0');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- Summary ---`);
if (failures === 0) {
  console.log('OK — all parser checks passed');
  process.exit(0);
} else {
  console.error(`FAIL — ${failures} check(s) failed`);
  process.exit(1);
}
