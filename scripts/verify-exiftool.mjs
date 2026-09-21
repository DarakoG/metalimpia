/*
 * Phase 3 verification script — NOT shipped with MetaLimpia.
 *
 * Loads the vendored ExifTool runtime in Node, points it at
 * a tiny synthesized JPG (so the WASM is exercised against
 * a real format), and prints the parsed metadata.
 *
 * Goal: confirm the vendored bundle is not just syntactically
 * valid but functionally correct — i.e. ExifTool actually
 * extracts tags from a file, which is the core Phase 3
 * deliverable.
 *
 * Run from C:\NodeJS\MetaLimpia:
 *   node scripts/verify-exiftool.mjs
 *
 * The script requires:
 *   - Node 18+ (fetch, Response, Blob, WebAssembly)
 *   - js/vendor/zeroperl/index.js
 *   - js/vendor/exiftool/index.js
 *   - assets/exiftool.wasm
 *
 * The script does not need to run a full Worker — it just
 * imports the vendored module directly, which is exactly
 * what the Worker does.
 */

// Some of the Node-only fallback code in the vendored zeroperl
// runtime mis-handles Windows paths. To exercise the same code
// path the Worker will use in a browser, we stub the browser
// detectors BEFORE importing the vendored bundle so its
// loadWasmSource() takes the browser branch (custom fetch).
//
// This is purely a verification convenience — production never
// runs this script. It does not change the shipped bundle in
// any way.
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || {};
// crypto is built-in to Node 19+ globals; the vendored code
// references it but we do not need to assign.

const { readFile } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
const { parseMetadata } = await import('../js/vendor/exiftool/index.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * Minimum-viable JPEG: a single 1x1 white pixel. Built with
 * plain bytes — no image library — so the script has zero
 * non-vendored dependencies beyond Node itself.
 *
 * Hex layout (hex literals converted to byte sequence):
 *   FF D8 FF E0 00 10 4A 46 49 46 00 01 01 00 00 01
 *   00 01 00 00 FF DB 00 43 00 08 06 06 07 06 05 08
 *   07 07 07 09 09 08 0A 0C 14 0D 0C 0B 0B 0C 19 12
 *   13 0F 14 1D 1A 1F 1E 1D 1A 1C 1C 20 24 2E 27 20
 *   22 2C 23 1C 1C 28 37 29 2C 30 31 34 34 34 1F 27
 *   39 3D 38 32 3C 2E 33 34 32 FF C0 00 0B 08 00 01
 *   00 01 01 01 01 11 00 FF C4 00 1F 00 00 01 05 01
 *   01 01 01 01 01 00 00 00 00 00 00 00 00 01 02 03
 *   04 05 06 07 08 09 0A 0B FF C4 00 B5 10 00 02
 *   01 03 03 02 04 03 05 05 04 04 00 00 01 7D 01
 *   02 03 00 04 11 05 12 21 31 41 06 13 51 61 07
 *   22 71 14 32 81 91 A1 08 23 42 B1 C1 15 52 D1
 *   F0 24 33 62 72 82 09 0A 16 17 18 19 1A 25 26
 *   27 28 29 2A 34 35 36 37 38 39 3A 43 44 45 46 47
 *   48 49 4A 53 54 55 56 57 58 59 5A 63 64 65 66 67
 *   68 69 6A 73 74 75 76 77 78 79 7A 83 84 85 86 87
 *   88 89 8A 92 93 94 95 96 97 98 99 9A A2 A3 A4
 * A5 A6 A7 A8 A9 AA B2 B3 B4 B5 B6 B7 B8 B9 BA
 * C2 C3 C4 C5 C6 C7 C8 C9 CA D2 D3 D4 D5 D6 D7 D8
 * D9 DA E1 E2 E3 E4 E5 E6 E7 E8 E9 EA F1 F2 F3 F4
 * F5 F6 F7 F8 F9 FA FF DA 00 08 01 01 00 00 3F 00
 * FB D0 FF D9
 */
const TINY_JPEG_HEX =
  'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D383233432E333432FFC0000B08000100010101011100FFC4001F0000010501010101010100000000000000010203040506070809' +
  '0A0BFFC400B5100002010303020403050504040000017D0102030004110512213141061351610722711432819A1082342B1C1152D1F02433627282091A162434E1F11552D1F02433627282091A162434E1F11552D1F02433627282091A162434E1F11552D1F02433627282091A162434E1F' +
  'D8DA0008010100003F00FBD0FFD9';
const TINY_JPEG = new Uint8Array(
  TINY_JPEG_HEX.match(/.{2}/g).map((h) => parseInt(h, 16))
);

async function main() {
  console.log('--- MetaLimpia Phase 3 verification ---');
  console.log('Reading WASM from assets/exiftool.wasm ...');
  const wasmBytes = await readFile(join(projectRoot, 'assets/exiftool.wasm'));
  console.log(`  size: ${wasmBytes.length} bytes`);

  // Custom fetch: ignore the URL the vendored code passes
  // (it expects "./zeroperl.wasm" — a path that does not exist
  // in our layout) and serve the vendored WASM from memory.
  const customFetch = () =>
    Promise.resolve(new Response(wasmBytes));

  console.log('Calling parseMetadata with -j -G1 -a -s ...');
  const result = await parseMetadata(
    { name: 'tiny.jpg', data: TINY_JPEG },
    {
      args: ['-j', '-G1', '-a', '-s'],
      fetch: customFetch,
      transform: (data) => JSON.parse(data),
    }
  );

  if (!result.success) {
    console.error('FAIL — parseMetadata returned failure:');
    console.error('  exitCode:', result.exitCode);
    console.error('  error:   ', result.error);
    process.exit(1);
  }

  const raw = Array.isArray(result.data) ? result.data[0] : result.data;
  console.log('SUCCESS — ExifTool returned metadata:');
  console.log(JSON.stringify(raw, null, 2));
  console.log(`  total tags: ${Object.keys(raw || {}).length}`);
  console.log('--- end ---');
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  process.exit(1);
});