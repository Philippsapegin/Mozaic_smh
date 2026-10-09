import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const samplePath = process.argv[2];
if (!samplePath) throw new Error('Pass the path to a photograph with one face.');
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('#fileInput').setInputFiles(samplePath);
  await page.locator('#emptyState').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 120000 });
  assert.ok(!(await page.locator('#faceStatus').textContent()).includes('недоступ'), 'Offline face detector failed');
  assert.equal(await page.locator('#faceCount').textContent(), '1');
  assert.deepEqual(errors, []);

  const downloadPng = async () => {
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#saveButton').click();
    const download = await downloadEvent;
    return readFile(await download.path());
  };
  const original = await readFile(samplePath);
  const yoloFaces = await page.evaluate(async (source) => {
    const { detectFacesOffline } = await import('/src/offline-faces.js');
    const image = new Image();
    image.src = source;
    await image.decode();
    return detectFacesOffline(image);
  }, `data:image/jpeg;base64,${original.toString('base64')}`);
  assert.equal(yoloFaces.length, 1, 'Bundled YOLO did not find the portrait face');
  assert.ok(yoloFaces[0].x < 400 && yoloFaces[0].x + yoloFaces[0].w > 400
    && yoloFaces[0].y < 200 && yoloFaces[0].y + yoloFaces[0].h > 200, 'YOLO coordinates were decoded incorrectly');
  const output = await downloadPng();
  const shape = await page.evaluate(async ([beforeUrl, afterUrl]) => {
    const decode = async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const before = await decode(beforeUrl);
    const after = await decode(afterUrl);
    const rows = [];
    for (let y = 0; y < before.height; y++) {
      let changed = 0;
      for (let x = 0; x < before.width; x++) {
        const offset = (y * before.width + x) * 4;
        const difference = Math.abs(before.data[offset] - after.data[offset])
          + Math.abs(before.data[offset + 1] - after.data[offset + 1])
          + Math.abs(before.data[offset + 2] - after.data[offset + 2]);
        if (difference > 35) changed++;
      }
      rows.push(changed);
    }
    const active = rows.map((width, y) => ({ width, y })).filter(({ width }) => width > 10);
    const inset = Math.max(1, Math.floor(active.length * 0.1));
    return {
      top: active[inset].width,
      middle: Math.max(...active.map(({ width }) => width)),
      bottom: active[active.length - inset - 1].width,
      height: active.length,
    };
  }, [`data:image/jpeg;base64,${original.toString('base64')}`, `data:image/png;base64,${output.toString('base64')}`]);
  assert.ok(shape.height > 50, `Face was not masked: ${JSON.stringify(shape)}`);
  assert.ok(shape.middle > shape.top * 1.35 && shape.middle > shape.bottom * 1.35,
    `Face mask still looks rectangular: ${JSON.stringify(shape)}`);
  await page.locator('.face-row input').uncheck();
  assert.equal((await downloadPng()).equals(output), false, 'Face switch did not change the mask');
  await page.keyboard.press('Control+z');
  assert.equal((await downloadPng()).equals(output), true, 'Ctrl+Z did not restore the face mask');
  await page.locator('.face-row').click();
  await page.screenshot({ path: 'tests/face-contour-preview.png', fullPage: true });
  await page.locator('#rotateRightButton').click();
  const rotated = await downloadPng();
  assert.deepEqual([rotated.readUInt32BE(16), rotated.readUInt32BE(20)], [1024, 820]);
  assert.equal(await page.locator('#faceCount').textContent(), '1');
  process.stdout.write(`Face contour test passed: ${JSON.stringify(shape)}\n`);
} finally {
  await browser.close();
  await server.close();
}
