/*
 * MetaLimpia — ExifTool Web Worker
 *
 * Spawned on demand by js/exiftoolLoader.js. Runs the ExifTool
 * Perl interpreter inside a WASI sandbox and serves three
 * operations to the main thread:
 *
 *   { op: 'init' }
 *       Fetches assets/exiftool.wasm (relative to the Worker's
 *       module URL), instantiates the vendored zeroperl-ts
 *       runtime, loads the vendored exiftool.pl Perl script,
 *       and primes the cached Perl interpreter. Replies with
 *       { ok: true, op: 'init' } on success or
 *       { ok: false, op: 'init', error: 'wasm_load_failed' }
 *       on failure.
 *
 *   { op: 'read', id, buffer, fileName }
 *       Adds `buffer` to the virtual filesystem at
 *       `/<fileName>`, runs `/exiftool -j -G1 -a -s <path>`,
 *       parses stdout as JSON, and replies with
 *       { ok: true, op: 'read', id, raw }. }
 *       On failure the `error` field is one of:
 *       'corrupted' (ExifTool could not parse the file) or
 *       'crashed' (Perl interpreter died or returned non-zero).
 *
 *   { op: 'write', id, buffer, fileName, tagsToRemove, removeAll }
 *       Writes a cleaned copy of `buffer` into
 *       `/<tmpFile>` by running either
 *         /exiftool -unsafe -All= -o <tmpPath> <inputPath>
 *       (when removeAll is true) or
 *         /exiftool -Tag1= -Tag2= ... -o <tmpPath> <inputPath>
 *       (for selective removal — empty tags set the tag to the
 *       empty string per ExifTool semantics, equivalent to deleting
 *       it from most formats). The `-unsafe` flag for removeAll
 *       unlocks the small set of tags ExifTool normally preserves
 *       as "unsafe to remove"; per Design Spec §2, MetaLimpia's
 *       explicit privacy stance is that the user wants the file
 *       aggressively clean. The cleaned bytes are read back from
 *       the virtual FS and posted with
 *       { ok: true, op: 'write', id, cleaned }. }
 *       On failure the `error` field is 'write_failed' or 'crashed'.
 *
 * Validation: every inbound message is shape-checked before
 * being acted on (see `validateMessage`). Malformed messages
 * do not crash the Worker — they log and are ignored.
 *
 * Vendored dependencies:
 *   - ../vendor/exiftool/index.js (parseMetadata / writeMetadata)
 *   - ../vendor/zeroperl/index.js (ZeroPerl / MemoryFileSystem)
 * Both are Apache-2.0; see LICENSE files under js/vendor.
 */

import { parseMetadata, writeMetadata } from '../vendor/exiftool/index.js';

// Workaround for a vendored-runtime detection bug. The minified
// `isBrowser()` helper inside js/vendor/zeroperl compares
//
//   typeof window < 'u' && typeof document < 'u'
//
// as STRING LESS-THAN. In a real Web Worker, `typeof window` is
// the literal string 'undefined' which is NOT lexically less
// than 'u' (their first characters are equal), so the helper
// returns false and the runtime picks the Node.js branch — which
// does not exist in a browser Worker — throwing
// `TypeError: n is not a function` at WASM init.
//
// Aliasing `window` and `document` to `self` in the Worker scope
// makes `typeof window` evaluate to 'object' (same as the main
// thread), flipping the helper back to the browser branch.
// Playwright's full-flow test previously worked around the same
// bug with a runtime patch (see `patchWorkerBundle` in tests/);
// this global alias fixes it in production where Playwright
// is not running.
self.window = self;
self.document = self;

// Path to the ExifTool WASM, resolved relative to this Worker's
// module URL. Same-origin fetch — satisfies strict CSP
// (connect-src 'self'; worker-src 'self' blob:).
const WASM_URL = new URL('../../assets/exiftool.wasm', import.meta.url).href;

/**
 * Shared module-level state. Only one Worker, so a single
 * exiftool handle is enough. `null` until `init` completes;
 * subsequent operations check before sending.
 */
let exiftoolReady = false;

/**
 * Cached WASM bytes — fetched once per Worker lifetime, then
 * served to the vendored zeroperl runtime via a custom fetch
 * (see `customFetchForZeroperl` below). Keeps the Worker from
 * hitting the network twice and lets us ignore the hardcoded
 * './zeroperl.wasm' URL in the vendored code.
 */
let wasmBytes = null;

/**
 * Custom fetch handed to the vendored zeroperl runtime. It
 * ignores the URL argument and returns the cached WASM bytes
 * as a Response. The vendored code expects a URL parameter but
 * never validates it — passing the same buffer for any URL
 * satisfies the contract.
 */
function customFetchForZeroperl() {
  if (!wasmBytes) {
    return Promise.reject(
      new Error('WASM bytes unavailable — call initWasm() first')
    );
  }
  return Promise.resolve(new Response(wasmBytes));
}

/**
 * Fetch the ExifTool WASM once per Worker lifetime.
 * Same-origin; the strict CSP allows this.
 */
async function loadWasmBytes() {
  if (wasmBytes) return wasmBytes;
  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(
      `WASM fetch failed: ${response.status} ${response.statusText}`
    );
  }
  const buffer = await response.arrayBuffer();
  wasmBytes = buffer;
  return buffer;
}

/**
 * Validation helpers. Each returns `null` on success or an
 * Error describing the first failed check. Used to fail safe
 * rather than crash on bad input from the main thread.
 */

function isPlainObject(value) {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateInitMessage(msg) {
  if (!isPlainObject(msg)) return new Error('init message must be an object');
  if (msg.op !== 'init') return new Error(`unexpected op: ${msg.op}`);
  return null;
}

function validateReadMessage(msg) {
  if (!isPlainObject(msg)) return new Error('read message must be an object');
  if (msg.op !== 'read') return new Error(`unexpected op: ${msg.op}`);
  if (!(msg.buffer instanceof ArrayBuffer)) {
    return new Error('read message must carry an ArrayBuffer in `buffer`');
  }
  if (!isNonEmptyString(msg.fileName)) {
    return new Error('read message must carry a non-empty `fileName`');
  }
  if (msg.id === undefined || msg.id === null) {
    return new Error('read message must carry a request `id`');
  }
  return null;
}

function validateWriteMessage(msg) {
  if (!isPlainObject(msg)) return new Error('write message must be an object');
  if (msg.op !== 'write') return new Error(`unexpected op: ${msg.op}`);
  if (!(msg.buffer instanceof ArrayBuffer)) {
    return new Error('write message must carry an ArrayBuffer in `buffer`');
  }
  if (!isNonEmptyString(msg.fileName)) {
    return new Error('write message must carry a non-empty `fileName`');
  }
  if (msg.id === undefined || msg.id === null) {
    return new Error('write message must carry a request `id`');
  }
  if (!Array.isArray(msg.tagsToRemove)) {
    return new Error('write message must carry `tagsToRemove` as an array');
  }
  for (const tag of msg.tagsToRemove) {
    if (!isNonEmptyString(tag)) {
      return new Error('each entry in `tagsToRemove` must be a non-empty string');
    }
  }
  if (typeof msg.removeAll !== 'boolean') {
    return new Error('write message must carry `removeAll` as a boolean');
  }
  if (msg.removeAll === false && msg.tagsToRemove.length === 0) {
    return new Error(
      'write message needs at least one of: removeAll=true or a non-empty tagsToRemove'
    );
  }
  return null;
}

/**
 * Worker entrypoint. Listens for the main-thread handshake,
 * routes each message to its handler, validates shape, and
 * posts the result.
 */
self.addEventListener('message', async (event) => {
  const msg = event.data;

  // Generic shape sanity. Any non-object or `op`-less message
  // is logged and ignored — the main thread always sets op.
  if (!isPlainObject(msg) || typeof msg.op !== 'string') {
    // eslint-disable-next-line no-console
    console.warn('MetaLimpia worker: ignoring malformed message', msg);
    return;
  }

  try {
    switch (msg.op) {
      case 'init':
        await handleInit();
        return;
      case 'read':
        await handleRead(msg);
        return;
      case 'write':
        await handleWrite(msg);
        return;
      default:
        // eslint-disable-next-line no-console
        console.warn(`MetaLimpia worker: unknown op "${msg.op}"`);
    }
  } catch (err) {
    // Catch-all so an unexpected throw never crashes the Worker
    // silently. Surface as a generic worker_crashed to the main
    // thread for the matching request (if any), or as init
    // failure for the init path.
    // eslint-disable-next-line no-console
    console.error('MetaLimpia worker: uncaught error', err);
    if (msg.op === 'init') {
      post({
        ok: false,
        op: 'init',
        error: 'wasm_load_failed',
        detail: err && err.message ? err.message : String(err),
      });
    } else if (msg.id !== undefined) {
      post({
        ok: false,
        op: msg.op,
        id: msg.id,
        error: 'crashed',
        detail: err && err.message ? err.message : String(err),
      });
    }
  }
});

/**
 * Handle the init handshake. Idempotent: re-running init on
 * a warm Worker is a no-op.
 *
 * Strategy: the vendored exiftool wrapper caches its ZeroPerl
 * instance in module-level WeakRefs. Once any call hits
 * getZeroPerl(), the runtime is alive for the Worker's
 * lifetime. We trigger it with a no-op invocation:
 *   - 1-byte synthetic file so the wrapper has something to
 *     addFile() against the virtual filesystem.
 *   - args ['-ver'] so ExifTool just prints the version and
 *     `next`s — it does NOT process the file.
 *   - The wrapper cleans up the synthetic file in its `finally`
 *     block, so no residue leaks to subsequent calls.
 *
 * The result of this call is irrelevant — even a success:false
 * return means the runtime is alive and ready.
 */
async function handleInit() {
  if (exiftoolReady) {
    post({ ok: true, op: 'init' });
    return;
  }

  try {
    await loadWasmBytes();

    // The vendored wrapper caches ZeroPerl in module-level
    // WeakRefs. This call triggers ZeroPerl.create() (which
    // instantiates the WASM, runs zeroperl_init, and loads
    // /exiftool). After this resolves, subsequent parseMetadata
    // and writeMetadata calls reuse the cached instance.
    await parseMetadata(
      {
        name: '_init_probe.txt',
        data: new Uint8Array([0]),
      },
      {
        fetch: customFetchForZeroperl,
        args: ['-ver'],
      }
    );

    exiftoolReady = true;
    post({ ok: true, op: 'init' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia worker: init failed', err);
    post({
      ok: false,
      op: 'init',
      error: 'wasm_load_failed',
      detail: err && err.message ? err.message : String(err),
    });
  }
}

/**
 * Handle a read request. Runs exiftool with the JSON output
 * flags and returns the parsed metadata object.
 */
async function handleRead(msg) {
  const validationError = validateReadMessage(msg);
  if (validationError) {
    post({
      ok: false,
      op: 'read',
      id: msg.id,
      error: 'crashed',
      detail: validationError.message,
    });
    return;
  }

  if (!exiftoolReady) {
    post({
      ok: false,
      op: 'read',
      id: msg.id,
      error: 'crashed',
      detail: 'worker not initialised — send { op: "init" } first',
    });
    return;
  }

  try {
    // The vendored API accepts a File-shaped object: { name, data }
    // where data is a Uint8Array | Blob. Pass a Uint8Array view
    // over the buffer that arrived via postMessage.
    const fileLike = {
      name: msg.fileName,
      data: new Uint8Array(msg.buffer),
    };

    const result = await parseMetadata(fileLike, {
      fetch: customFetchForZeroperl,
      args: ['-j', '-G1', '-a', '-s'],
      transform: (data) => {
        try {
          return JSON.parse(data);
        } catch (err) {
          // Should not happen — exiftool -j emits strict JSON —
          // but if it does we surface as corrupted.
          throw new Error(`ExifTool did not return valid JSON: ${err.message}`);
        }
      },
    });

    if (!result.success) {
      // ExifTool returned a non-zero exit code or wrote to
      // stderr. The vendored wrapper puts the Perl error or
      // stderr text in result.error. We map to 'corrupted'
      // unless it smells like a runtime issue.
      const detail = String(result.error || 'unknown');
      const errorCode = detail.toLowerCase().includes('crash')
        ? 'crashed'
        : 'corrupted';
      post({
        ok: false,
        op: 'read',
        id: msg.id,
        error: errorCode,
        detail,
      });
      return;
    }

    // result.data is already parsed JSON (transform above).
    // ExifTool emits a JSON ARRAY (one entry per input file);
    // we only ever pass one, so unwrap the first entry.
    const raw = Array.isArray(result.data) ? result.data[0] : result.data;

    post({
      ok: true,
      op: 'read',
      id: msg.id,
      raw: raw || {},
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia worker: read failed', err);
    post({
      ok: false,
      op: 'read',
      id: msg.id,
      error: 'crashed',
      detail: err && err.message ? err.message : String(err),
    });
  }
}

/**
 * Handle a write request. Builds the exiftool arg list from
 * the operation mode (removeAll vs selective), runs the
 * write, and returns the cleaned bytes.
 */
async function handleWrite(msg) {
  const validationError = validateWriteMessage(msg);
  if (validationError) {
    post({
      ok: false,
      op: 'write',
      id: msg.id,
      error: 'crashed',
      detail: validationError.message,
    });
    return;
  }

  if (!exiftoolReady) {
    post({
      ok: false,
      op: 'write',
      id: msg.id,
      error: 'crashed',
      detail: 'worker not initialised — send { op: "init" } first',
    });
    return;
  }

  try {
    // Build the per-tag args. The vendored writeMetadata API
    // accepts a tags object that becomes `-Tag=value` style
    // arguments. To DELETE a tag (the privacy goal) we set
    // its value to an empty string, which ExifTool treats as
    // a clear across all writable formats.
    let tagsObj;
    const writeOpts = {
      fetch: customFetchForZeroperl,
    };
    if (msg.removeAll) {
      // `-All=` removes every writable tag. We also pass
      // `-unsafe` to unlock the small set of tags ExifTool
      // normally preserves as "unsafe to remove" — MetaLimpia's
      // explicit privacy stance (Design Spec §2) is that the
      // user wants the file aggressively clean, and the
      // conservative ExifTool default would defeat the tool's
      // purpose. The vendored wrapper maps `{All:''}` to the
      // `-All=` CLI flag, which is the canonical way to clear
      // all writable metadata in ExifTool. `args: ['-unsafe']`
      // is prepended so the effective command becomes
      // `/exiftool -unsafe -All= -o <tmp> <input>`.
      tagsObj = { All: '' };
      writeOpts.args = ['-unsafe'];
    } else {
      tagsObj = {};
      for (const tag of msg.tagsToRemove) {
        tagsObj[tag] = '';
      }
    }

    const fileLike = {
      name: msg.fileName,
      data: new Uint8Array(msg.buffer),
    };

    const result = await writeMetadata(fileLike, tagsObj, writeOpts);

    if (!result.success) {
      const detail = String(result.error || 'unknown');
      const errorCode = detail.toLowerCase().includes('crash')
        ? 'crashed'
        : 'write_failed';
      post({
        ok: false,
        op: 'write',
        id: msg.id,
        error: errorCode,
        detail,
      });
      return;
    }

    // result.data is an ArrayBuffer of the cleaned file.
    // Transfer it back to the main thread for zero-copy hand-off.
    post(
      {
        ok: true,
        op: 'write',
        id: msg.id,
        cleaned: result.data,
      },
      [result.data]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MetaLimpia worker: write failed', err);
    post({
      ok: false,
      op: 'write',
      id: msg.id,
      error: 'crashed',
      detail: err && err.message ? err.message : String(err),
    });
  }
}

/**
 * postMessage wrapper that takes an optional transfer list.
 * The 2nd argument is forwarded as-is when present.
 */
function post(message, transfer) {
  if (transfer && transfer.length > 0) {
    self.postMessage(message, transfer);
  } else {
    self.postMessage(message);
  }
}