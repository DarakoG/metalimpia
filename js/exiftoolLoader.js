/*
 * MetaLimpia — ExifTool loader (main-thread facade)
 *
 * Lazy + cached facade over js/workers/exiftool.worker.js. The
 * Worker is spawned once on first use; subsequent calls share
 * the same instance until the page unloads. The main thread
 * never touches the WASM directly — all Perl/WASI work lives
 * inside the Worker.
 *
 * Public API (mirrors Data Model §3.5 Worker protocol):
 *
 *   const { worker } = await loadExiftool();
 *     Lazy-spawns the Worker, waits for the init handshake,
 *     and resolves to an object that holds the live Worker
 *     reference. Subsequent calls return the same Promise
 *     (no second spawn, no second WASM download).
 *
 *   await readMetadata(buffer, fileName)
 *     Sends `{ op: 'read', buffer, fileName }` to the Worker
 *     and resolves to the raw ExifTool JSON object.
 *
 *   await writeMetadata(buffer, fileName, { tagsToRemove, removeAll })
 *     Sends `{ op: 'write', buffer, fileName, tagsToRemove, removeAll }`
 *     and resolves to the cleaned ArrayBuffer.
 *
 * Errors:
 *   - WASM load / Worker init failure → rejects with an Error
 *     whose `.code` is 'wasm_load_failed'. The orchestrator
 *     maps that to the `errors.wasmLoadFailed` i18n key.
 *   - Read failure → rejects with an Error whose `.code` is
 *     'corrupted' or 'unsupported' (depending on stderr shape).
 *   - Write failure → rejects with an Error whose `.code` is
 *     'write_failed'.
 *   - Worker crash → rejects with an Error whose `.code` is
 *     'worker_crashed' (mapped to errors.workerCrashed).
 */

import ExiftoolWorker from './workers/exiftool.worker.js?worker';

/**
 * Single Worker instance shared across the session.
 * `null` until loadExiftool() is first called.
 */
let cachedWorker = null;

/**
 * Pending in-flight requests keyed by an incrementing request id.
 * Each entry is `{ resolve, reject }`. Cleared after each response
 * or on worker crash.
 */
const pending = new Map();

/**
 * Shared init Promise so concurrent callers of loadExiftool()
 * receive the same Worker instead of spawning multiple.
 */
let initPromise = null;

/**
 * Worker bootstrap counter. Every request message carries an `id`;
 * every response message echoes it back. This is how the
 * promise-based public API multiplexes over the single Worker.
 */
let nextRequestId = 1;

/**
 * Lazy-spawn the ExifTool Worker and wait for the init handshake.
 *
 * @returns {Promise<{ worker: Worker }>}
 *
 * Resolves once the Worker posts `{ ok: true, op: 'init' }`.
 * Rejects with `Error { code: 'wasm_load_failed' }` if the
 * Worker fails to instantiate the WASM or init Perl.
 *
 * Subsequent calls return the same Promise (memoised).
 */
export function loadExiftool() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    let worker;
    try {
      // Vite recognises the `?worker` suffix on a module import
      // and resolves it to a Worker constructor at build time.
      // The Worker module URL stays same-origin so the strict
      // CSP (worker-src 'self' blob:) allows it.
      worker = new ExiftoolWorker();
    } catch (err) {
      initPromise = null;
      const error = new Error(
        `No se pudo crear el worker: ${err && err.message ? err.message : err}`
      );
      error.code = 'wasm_load_failed';
      reject(error);
      return;
    }

    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.op === 'init') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (msg.ok) {
          cachedWorker = worker;
          // Start listening for read/write responses from here on.
          worker.addEventListener('message', handleResponse);
          worker.addEventListener('error', handleCrash);
          resolve({ worker });
        } else {
          worker.terminate();
          initPromise = null;
          const error = new Error(
            `El worker reportó fallo de inicialización: ${msg.error || 'wasm_load_failed'}`
          );
          error.code = 'wasm_load_failed';
          reject(error);
        }
        return;
      }

      // A stray response (should not happen during init) — drop.
    };

    const onError = (event) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      // eslint-disable-next-line no-console
      console.error('MetaLimpia: worker error during init', event);
      const error = new Error(
        `El worker crasheó durante la inicialización: ${event.message || 'sin detalle'}`
      );
      error.code = 'wasm_load_failed';
      initPromise = null;
      reject(error);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    // Kick off the init handshake. The Worker fetches the WASM,
    // instantiates zeroperl, loads the vendored exiftool.pl, and
    // posts back when ready (or when it fails).
    try {
      worker.postMessage({ op: 'init' });
    } catch (err) {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      initPromise = null;
      const error = new Error(
        `No se pudo enviar el mensaje de inicialización: ${err && err.message ? err.message : err}`
      );
      error.code = 'wasm_load_failed';
      reject(error);
    }
  });

  return initPromise;
}

/**
 * Multiplexed response handler for read/write replies. Routes
 * each response to the Promise that issued the matching request.
 */
function handleResponse(event) {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  // Skip the init reply — handled by the init-specific listener.
  if (msg.op === 'init') return;

  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);

  if (msg.ok) {
    entry.resolve(msg);
  } else {
    const error = new Error(
      `El worker reportó error en ${msg.op}: ${msg.error || 'sin detalle'}`
    );
    error.code = msg.error || 'worker_crashed';
    entry.reject(error);
  }
}

/**
 * Worker `error` handler for non-init failures (read/write crash).
 * Any pending request is rejected with a worker_crashed error.
 */
function handleCrash(event) {
  // eslint-disable-next-line no-console
  console.error('MetaLimpia: worker crashed during operation', event);
  const error = new Error(
    `El worker crasheó durante el procesamiento: ${event.message || 'sin detalle'}`
  );
  error.code = 'worker_crashed';
  for (const [, entry] of pending) {
    entry.reject(error);
  }
  pending.clear();
}

/**
 * Send a request to the live Worker and return a Promise that
 * resolves with the response message (or rejects with an Error).
 *
 * @param {object} message — payload sent to the Worker. Must
 *   already include the `op` field; this helper adds `id`.
 */
function sendRequest(message) {
  if (!cachedWorker) {
    return Promise.reject(
      Object.assign(new Error('Worker no inicializado'), {
        code: 'wasm_load_failed',
      })
    );
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      cachedWorker.postMessage({ ...message, id });
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}

/**
 * Read metadata from a file buffer via ExifTool.
 *
 * Worker runs exiftool with `-j -G1 -a -s` (grouped JSON,
 * show duplicate tags, very-short format). The resulting
 * JSON object is returned as-is (parsed on the Worker side).
 *
 * @param {ArrayBuffer} buffer — raw file bytes. Transferred
 *   to the Worker to avoid a copy.
 * @param {string} fileName — original filename. Used by
 *   ExifTool as the synthetic path inside the virtual FS
 *   so its `$filename` machinery can guess the file type.
 * @returns {Promise<object>} — raw ExifTool JSON object.
 */
export async function readMetadata(buffer, fileName) {
  await loadExiftool();
  const response = await sendRequest({
    op: 'read',
    buffer,
    fileName,
  });
  return response.raw;
}

/**
 * Write metadata to a file buffer via ExifTool. Either remove
 * everything (`removeAll: true`) or selectively remove the
 * given tag IDs (`tagsToRemove: ['Author', 'GPSLatitude', ...]`).
 *
 * Worker builds the exiftool arg list:
 *   - removeAll:   ['-all=', '-o', tmpPath, inputPath]
 *   - selective:   tag args, then ['-o', tmpPath, inputPath]
 *
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @param {{ tagsToRemove?: string[], removeAll?: boolean }} [options]
 * @returns {Promise<ArrayBuffer>} — cleaned bytes, ready to be
 *   wrapped in a Blob for download.
 */
export async function writeMetadata(buffer, fileName, options = {}) {
  await loadExiftool();
  const response = await sendRequest({
    op: 'write',
    buffer,
    fileName,
    tagsToRemove: options.tagsToRemove || [],
    removeAll: Boolean(options.removeAll),
  });
  return response.cleaned;
}