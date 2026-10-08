import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PNG_FIXTURE = new URL('./fixtures/sample-with-author.png', import.meta.url);
const PNG_CANARY = 'MetaLimpiaTestAuthor';

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

async function pngWithCanary() {
  const source = await readFile(PNG_FIXTURE);
  const chunks = [source.subarray(0, 8)];
  for (let offset = 8; offset < source.length;) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === 'tEXt') {
      chunks.push(makePngChunk('tEXt', Buffer.concat([
        Buffer.from('Author\0', 'latin1'), Buffer.from(PNG_CANARY, 'latin1'),
      ])));
    } else {
      chunks.push(source.subarray(offset, offset + length + 12));
    }
    offset += length + 12;
  }
  return Buffer.concat(chunks);
}

async function pdfWithCanaries() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 200]);
  page.drawText('BATCH_PDF_VISIBLE_TEXT', { x: 30, y: 90, size: 14, font, color: rgb(0, 0, 0) });
  document.setTitle('BATCH_PDF_PRIVATE_TITLE');
  document.setAuthor('BATCH_PDF_PRIVATE_AUTHOR');
  return Buffer.from(await document.save());
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function expectPdfContentPreserved(bytes) {
  const cleaned = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(cleaned.getPageCount()).toBe(1);
  expect(cleaned.getTitle()).toBeUndefined();
  expect(cleaned.getAuthor()).toBeUndefined();
  const page = cleaned.getPage(0);
  expect(page.getWidth()).toBe(400);
  expect(page.getHeight()).toBe(200);
  const contents = page.node.get(cleaned.context.obj('Contents'));
  let inflated = '';
  if (contents) {
    for (let index = 0; index < contents.size(); index += 1) {
      const stream = cleaned.context.lookup(contents.get(index));
      inflated += inflateSync(Buffer.from(stream.contents)).toString('latin1');
    }
  }
  expect(inflated).toContain('42415443485F5044465F56495349424C455F54455854');
}

test('landing offers automatic multi-file input and an accessible manual review route', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#file-input')).toHaveAttribute('multiple', '');
  await expect(page.getByRole('button', { name: /revisar metadatos/i })).toBeVisible();
  await expect(page.locator('#manual-file-input')).toBeAttached();
  await expect(page.locator('#pdf-scope-caution')).toBeVisible();
  await expect(page.locator('#pdf-scope-caution')).toContainText(/firmas digitales.*invalidan/i);
  await expect(page.locator('#pdf-scope-caution')).toContainText(/anotaciones por página/i);
  await expect(page.locator('#pdf-scope-caution')).toContainText(/datos personales visibles/i);
  await expect(page.locator('.upload-size-guidance')).toContainText(/200 MiB por archivo/i);
});

test('reports ordered download initiation and continues after invalid input', async ({ page }) => {
  await page.addInitScript(() => {
    window.__writes = [];
    window.Worker = class MockWorker {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }
      removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
      }
      postMessage(message) {
        if (message.op === 'init') {
          queueMicrotask(() => this.emit('message', { data: { op: 'init', ok: true } }));
          return;
        }
        window.__writes.push(message.fileName);
        const cleaned = message.buffer.slice(0);
        queueMicrotask(() => this.emit('message', {
          data: { op: 'write', id: message.id, ok: true, cleaned },
        }));
      }
      emit(type, event) {
        for (const handler of this.listeners.get(type) || []) handler(event);
      }
      terminate() {}
    };
  });
  await page.goto('/');
  await page.setInputFiles('#file-input', [
    { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('first') },
    { name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') },
    { name: 'last.png', mimeType: 'image/png', buffer: Buffer.from('last') },
  ]);

  await expect(page.locator('.batch-item--downloaded')).toHaveCount(2);
  await expect(page.locator('.batch-item--failed')).toHaveCount(1);
  await expect(page.locator('.batch-item--downloaded')).toHaveCount(2);
  expect(await page.evaluate(() => window.__writes)).toEqual(['first.png', 'last.png']);
  await expect(page.locator('.batch-download-notice')).toContainText(/no podemos confirmar/i);

  await page.locator('.batch-item--downloaded .batch-retry').first().click();
  await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(3);
  await expect(page.locator('.batch-item--downloaded')).toHaveCount(2);
  expect(await page.evaluate(() => window.__writes)).toEqual(['first.png', 'last.png', 'first.png']);
});

test('single-file default uses the real ExifTool worker and retry regenerates a clean download', async ({ page }) => {
  await page.addInitScript(() => {
    window.__downloadUrls = [];
    window.__revokedDownloadUrls = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === 'image/png') window.__downloadUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (window.__downloadUrls.includes(url)) window.__revokedDownloadUrls.push(url);
      return revoke(url);
    };
  });
  const original = await pngWithCanary();
  const originalSnapshot = Buffer.from(original);
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.goto('/');
  await page.setInputFiles('#file-input', {
    name: 'single.png', mimeType: 'image/png', buffer: original,
  });

  await expect(page.locator('.batch-item--downloaded')).toHaveCount(1, { timeout: 90_000 });
  expect(downloads).toHaveLength(1);
  expect(downloads[0].suggestedFilename()).toBe('single-limpio.png');
  const cleanedOnce = await readDownload(downloads[0]);
  expect(cleanedOnce.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(cleanedOnce.includes(Buffer.from(PNG_CANARY))).toBe(false);
  expect(original).toEqual(originalSnapshot);

  await page.locator('.batch-item--downloaded .batch-retry').click();
  await expect.poll(() => downloads.length, { timeout: 90_000 }).toBe(2);
  const cleanedAgain = await readDownload(downloads[1]);
  expect(cleanedAgain).toEqual(cleanedOnce);
  expect(original).toEqual(originalSnapshot);
  await expect.poll(() => page.evaluate(() => window.__revokedDownloadUrls.length)).toBe(2);
  expect(await page.evaluate(() => window.__revokedDownloadUrls)).toEqual(
    await page.evaluate(() => window.__downloadUrls)
  );
});

for (const { code, copy } of [
  { code: 'write_failed', copy: /no pudimos limpiar el archivo/i },
  { code: 'read_failed', copy: /no pudimos leer este archivo/i },
]) {
  test(`shows an actionable ${code} message without worker diagnostics`, async ({ page }) => {
    await page.addInitScript((failureCode) => {
      window.Worker = class FailingWorker {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, handler) {
          const handlers = this.listeners.get(type) || [];
          handlers.push(handler);
          this.listeners.set(type, handlers);
        }
        removeEventListener(type, handler) {
          this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
        }
        postMessage(message) {
          const response = message.op === 'init'
            ? { op: 'init', ok: true }
            : {
                op: message.op,
                id: message.id,
                ok: false,
                error: failureCode,
                detail: 'PRIVATE_WORKER_DIAGNOSTIC fixture-private-name.png',
              };
          queueMicrotask(() => this.emit('message', { data: response }));
        }
        emit(type, event) {
          for (const handler of this.listeners.get(type) || []) handler(event);
        }
        terminate() {}
      };
    }, code);
    await page.goto('/');
    await page.setInputFiles('#file-input', {
      name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('synthetic bytes'),
    });
    const error = page.locator('.batch-item-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(copy);
    await expect(error).not.toContainText(/PRIVATE_WORKER_DIAGNOSTIC|fixture-private-name/i);
    await expect(error).not.toContainText(/error inesperado/i);
  });
}

test('real PNG and PDF batch preserves order, removes canaries, and continues after invalid input', async ({ page }) => {
  const originalPng = await pngWithCanary();
  const pngSnapshot = Buffer.from(originalPng);
  const originalPdf = await pdfWithCanaries();
  const pdfSnapshot = Buffer.from(originalPdf);
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.goto('/');
  await page.setInputFiles('#file-input', [
    { name: 'first.png', mimeType: 'image/png', buffer: originalPng },
    { name: 'document.pdf', mimeType: 'application/pdf', buffer: originalPdf },
    { name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid input') },
    { name: 'last.png', mimeType: 'image/png', buffer: originalPng },
  ]);

  await expect(page.locator('.batch-item--downloaded')).toHaveCount(3, { timeout: 90_000 });
  await expect(page.locator('.batch-item--failed')).toHaveCount(1);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual([
    'first-limpio.png', 'document-limpio.pdf', 'last-limpio.png',
  ]);
  const pngOutput = await readDownload(downloads[0]);
  const pdfOutput = await readDownload(downloads[1]);
  const lastPngOutput = await readDownload(downloads[2]);
  expect(pngOutput.includes(Buffer.from(PNG_CANARY))).toBe(false);
  expect(lastPngOutput.includes(Buffer.from(PNG_CANARY))).toBe(false);
  await expectPdfContentPreserved(pdfOutput);
  expect(originalPng).toEqual(pngSnapshot);
  expect(originalPdf).toEqual(pdfSnapshot);
  expect(await page.evaluate(() => document.querySelectorAll('.batch-item').length)).toBe(4);
});

test('reset during an active write suppresses stale downloads and confirms input transfer', async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class DelayedWorker {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }
      removeEventListener(type, handler) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
      }
      postMessage(message, transfer = []) {
        if (message.op === 'init') {
          queueMicrotask(() => this.emit('message', { data: { op: 'init', ok: true } }));
          return;
        }
        window.__writeHadTransfer = transfer.includes(message.buffer);
        window.__finishWrite = () => this.emit('message', {
          data: { op: 'write', id: message.id, ok: true, cleaned: message.buffer.slice(0) },
        });
      }
      emit(type, event) {
        for (const handler of this.listeners.get(type) || []) handler(event);
      }
      terminate() {}
    };
  });
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.goto('/');
  await page.setInputFiles('#file-input', {
    name: 'cancelled.png', mimeType: 'image/png', buffer: Buffer.from('synthetic input'),
  });
  await expect(page.locator('.batch-item--processing')).toBeVisible();
  expect(await page.evaluate(() => window.__writeHadTransfer)).toBe(true);

  await page.evaluate(() => {
    history.pushState({}, '', location.href);
    history.back();
  });
  await expect(page.locator('#dropzone')).toBeVisible();
  await page.evaluate(() => window.__finishWrite());
  await expect.poll(() => page.locator('.batch-card').count()).toBe(0);
  expect(downloads).toHaveLength(0);
});
