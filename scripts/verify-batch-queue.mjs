import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchQueue } from '../js/batchQueue.js';

test('processes each file sequentially, continues after errors, and stores no outputs', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const updates = [];
  const files = ['first.png', 'broken.png', 'last.png'].map((name) => ({ name }));
  const queue = createBatchQueue({
    async processFile(file) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${file.name}`);
      await Promise.resolve();
      active -= 1;
      order.push(`end:${file.name}`);
      if (file.name === 'broken.png') throw new Error('synthetic failure');
      return { downloadStarted: true };
    },
    onUpdate: (snapshot) => updates.push(snapshot),
  });

  const result = await queue.start(files);
  assert.deepEqual(order, [
    'start:first.png', 'end:first.png',
    'start:broken.png', 'end:broken.png',
    'start:last.png', 'end:last.png',
  ]);
  assert.equal(maxActive, 1);
  assert.deepEqual(result.items.map(({ status }) => status), ['downloaded', 'failed', 'downloaded']);
  assert.ok(result.items.every(({ output }) => output === null));
  assert.equal(result.items[0].file, files[0]);
  assert.ok(updates.length >= files.length * 2);
});

test('reset drops stale output, blocks overlapping work, and permits a fresh batch after settlement', async () => {
  let releaseFirst;
  const started = [];
  const queue = createBatchQueue({
    processFile(file) {
      started.push(file.name);
      if (file.name === 'active.png') return new Promise((resolve) => { releaseFirst = resolve; });
      return Promise.resolve({ downloadStarted: true });
    },
  });
  const running = queue.start([{ name: 'active.png' }]);
  await Promise.resolve();
  queue.reset();
  assert.equal((await queue.start([{ name: 'overlap.png' }])).items.length, 0);
  releaseFirst({ downloadStarted: true });
  await running;
  assert.deepEqual(queue.snapshot().items, []);
  assert.deepEqual(started, ['active.png']);
  assert.equal(queue.snapshot().busy, false);
  await queue.start([{ name: 'fresh.png' }]);
  assert.deepEqual(started, ['active.png', 'fresh.png']);
});

test('retries regenerate from the original File without retaining a cleaned result', async () => {
  const source = { name: 'retry.png' };
  let attempts = 0;
  const queue = createBatchQueue({
    async processFile(file) {
      assert.equal(file, source);
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      return { downloadStarted: true, output: new ArrayBuffer(8) };
    },
  });
  await queue.start([source]);
  assert.equal(queue.snapshot().items[0].status, 'failed');
  await queue.retry(0);
  assert.equal(queue.snapshot().items[0].status, 'downloaded');
  assert.equal(queue.snapshot().items[0].output, null);
  assert.equal(attempts, 2);
});

test('active retry is serialized and reset invalidates pending download initiation', async () => {
  const source = { name: 'active.png' };
  let releaseWork;
  let activeCalls = 0;
  let initiated = 0;
  const queue = createBatchQueue({
    async processFile(file, { isCurrent }) {
      assert.equal(file, source);
      assert.equal(typeof isCurrent, 'function');
      activeCalls += 1;
      await new Promise((resolve) => { releaseWork = resolve; });
      if (isCurrent()) initiated += 1;
      return { downloadStarted: true };
    },
  });

  const running = queue.start([source]);
  await Promise.resolve();
  await queue.retry(0);
  assert.equal(activeCalls, 1);
  queue.reset();
  releaseWork();
  await running;
  assert.equal(initiated, 0);
  assert.deepEqual(queue.snapshot().items, []);
  assert.equal(queue.snapshot().busy, false);
});

test('preserves known loader error codes without retaining private diagnostics', async () => {
  for (const code of ['write_failed', 'read_failed']) {
    const queue = createBatchQueue({
      async processFile() {
        const error = new Error('private worker diagnostic and filename');
        error.code = code;
        throw error;
      },
    });
    const result = await queue.start([{ name: 'fixture.png' }]);
    assert.equal(result.items[0].status, 'failed');
    assert.equal(result.items[0].error, code);
    assert.equal(result.items[0].error.includes('private'), false);
  }

  const ordinaryQueue = createBatchQueue({
    async processFile() {
      throw new Error('private worker diagnostic and filename');
    },
  });
  const ordinaryResult = await ordinaryQueue.start([{ name: 'fixture.png' }]);
  assert.equal(ordinaryResult.items[0].error, 'processing_failed');
  assert.equal(ordinaryResult.items[0].error.includes('private'), false);
});
