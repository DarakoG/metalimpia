/*
 * MetaLimpia — Phase 8 test fixture generator.
 *
 * Generates tests/fixtures/sample-with-author.png: a minimal but
 * fully-valid 1×1 RGB PNG file with a tEXt chunk carrying
 *   Author = "Linus Torvalds"
 *
 * ExifTool reads PNG tEXt chunks and emits them as
 *   "PNG:Author" : "Linus Torvalds"
 * The metadata parser strips the "PNG:" prefix and classifies
 * "Author" into the "author" group, so the full-flow test can
 * assert the tag appears in the results view.
 *
 * Why PNG and not JPG (parent task brief mentioned JPG):
 *   Phase 9's earlier discovery (memory note) flagged that
 *   ExifTool's vendored WASM runtime cannot round-trip a
 *   minimal 1×1 JPEG (it can READ it but the WRITER returns
 *   an error). The full-flow test needs to click "Borrar todo"
 *   and reach the Done view, so the fixture has to be a format
 *   the writer handles cleanly. PNG with tEXt chunks is the
 *   smallest such fixture: it parses in milliseconds, has
 *   well-defined metadata, and ExifTool rewrites it without
 *   hitting any of the JPEG round-trip limitations.
 *
 * Output: tests/fixtures/sample-with-author.png
 *
 * License: MIT (this script + the generated binary).
 *
 * Run from the project root:
 *   node scripts/generate-test-fixture.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

// -- CRC-32 (standard PNG chunk checksum) ---------------------------

let crcTable = null;
function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}
function crc32(buf) {
  if (!crcTable) crcTable = buildCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// -- PNG chunk helper ------------------------------------------------
// PNG chunk: 4-byte big-endian length + 4-byte type + data + 4-byte CRC.
// (CRC covers the type + data, not the length.)
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// -- Build the PNG ---------------------------------------------------

// PNG signature: the four-byte opening sequence that distinguishes
// a real PNG from random bytes.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// IHDR: width, height, bit depth, color type, compression, filter, interlace.
//   1×1, 8-bit RGB (color type 2), deflate, adaptive filter, no interlace.
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0); // width
ihdr.writeUInt32BE(1, 4); // height
ihdr.writeUInt8(8, 8); // bit depth
ihdr.writeUInt8(2, 9); // color type 2 = RGB (no alpha)
ihdr.writeUInt8(0, 10); // compression method (0 = deflate, the only one)
ihdr.writeUInt8(0, 11); // filter method (0 = adaptive)
ihdr.writeUInt8(0, 12); // interlace (0 = none)

// tEXt chunk: keyword + null separator + text value. Latin-1 per
// the PNG spec — ASCII subset is fine for our value.
const tEXtData = Buffer.concat([
  Buffer.from('Author', 'latin1'),
  Buffer.from([0]),
  Buffer.from('Linus Torvalds', 'latin1'),
]);

// IDAT: deflate-compressed scanlines. Each scanline is one filter
// byte (0 = none) followed by the row's pixel data. For a 1×1 RGB
// image, that's 1 filter byte + 3 pixel bytes = 4 bytes raw.
const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]); // filter=None, R=255, G=0, B=0
const compressed = deflateSync(rawScanline);

// IEND: marks the end of the PNG; data is empty.
const iend = Buffer.alloc(0);

// Assemble the PNG: signature + IHDR + tEXt + IDAT + IEND.
const png = Buffer.concat([
  SIGNATURE,
  makeChunk('IHDR', ihdr),
  makeChunk('tEXt', tEXtData),
  makeChunk('IDAT', compressed),
  makeChunk('IEND', iend),
]);

const outPath = resolve(process.cwd(), 'tests/fixtures/sample-with-author.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
