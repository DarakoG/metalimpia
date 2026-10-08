const EMPTY_OUTPUT = null;
const SAFE_FAILURE_CODES = new Set([
  'empty',
  'too_large',
  'unsupported_format',
  'corrupted',
  'unsupported',
  'read_failed',
  'write_failed',
  'pdf_encrypted',
  'crashed',
  'worker_crashed',
  'wasm_load_failed',
]);

/**
 * Create a serial batch processor whose snapshots retain source Files but never outputs.
 * @param {{processFile: (file: File) => Promise<{downloadStarted: boolean}>, onUpdate?: (snapshot: object) => void}} options
 */
export function createBatchQueue({ processFile, onUpdate = () => {} }) {
  if (typeof processFile !== 'function') throw new TypeError('processFile is required');

  let items = [];
  let busy = false;
  let activeRun = false;
  let generation = 0;

  const snapshot = () => ({
    busy,
    items: items.map((item) => ({ ...item })),
  });

  function publish() {
    onUpdate(snapshot());
  }

  async function processItem(index, token) {
    const item = items[index];
    if (!item || token !== generation) return;
    item.status = 'processing';
    item.error = '';
    publish();
    try {
      const result = await processFile(item.file, {
        isCurrent: () => token === generation,
      });
      if (token !== generation) return;
      if (!result || result.downloadStarted !== true) {
        throw new Error('download_not_started');
      }
      item.status = 'downloaded';
    } catch (error) {
      if (token !== generation) return;
      item.status = 'failed';
      item.error = SAFE_FAILURE_CODES.has(error && error.code)
        ? error.code
        : 'processing_failed';
    }
    item.output = EMPTY_OUTPUT;
    publish();
  }

  async function run(indexes, token) {
    activeRun = true;
    busy = true;
    publish();
    try {
      for (const index of indexes) {
        if (token !== generation) break;
        await processItem(index, token);
      }
    } finally {
      activeRun = false;
      busy = false;
      publish();
    }
    return snapshot();
  }

  return {
    snapshot,
    start(files) {
      if (busy || activeRun || !Array.from(files || []).length) return Promise.resolve(snapshot());
      items = Array.from(files, (file) => ({
        file,
        name: file.name,
        status: 'queued',
        error: '',
        output: EMPTY_OUTPUT,
      }));
      generation += 1;
      return run(items.map((_, index) => index), generation);
    },
    async retry(index) {
      if (busy || activeRun || !items[index] || items[index].status === 'queued' || items[index].status === 'processing') {
        return snapshot();
      }
      generation += 1;
      items[index].status = 'queued';
      return run([index], generation);
    },
    reset() {
      generation += 1;
      items = [];
      busy = activeRun;
      publish();
    },
  };
}
