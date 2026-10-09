import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') process.stderr.write(`Browser error: ${message.text()}\n`);
});
const requests = [];
page.on('request', (request) => requests.push(request.url()));

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  assert.equal(await page.locator('#emptyState').isVisible(), true);
  assert.equal(await page.locator('[data-tool]').count(), 3);
  assert.equal(await page.locator('.topbar,.tool-rail,.bottom-bar').count(), 0);

  const dataUrl = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 1080;
    image.height = 720;
    const context = image.getContext('2d');
    context.fillStyle = '#e3e9ea';
    context.fillRect(0, 0, 1080, 720);
    const gradient = context.createLinearGradient(0, 0, 1080, 0);
    gradient.addColorStop(0, '#276e81');
    gradient.addColorStop(1, '#dcb777');
    context.fillStyle = gradient;
    context.fillRect(80, 80, 920, 540);
    context.fillStyle = '#fff';
    context.fillRect(150, 130, 680, 170);
    context.fillStyle = '#303030';
    context.font = '48px Arial';
    context.fillText('ТЕСТОВЫЙ ДОКУМЕНТ', 180, 230);
    return image.toDataURL('image/png');
  });
  await page.locator('#fileInput').setInputFiles({
    name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  });
  await page.locator('#emptyState').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 120000 });
  const faceStatus = await page.locator('#faceStatus').textContent();
  assert.ok(!faceStatus.includes('недоступ'), `Offline face check failed: ${faceStatus}`);
  assert.ok(!requests.some((url) => url.includes('/api/face-check')), 'The app still calls a face server');
  assert.ok(!requests.some((url) => /^https?:/.test(url) && new URL(url).hostname !== '127.0.0.1'), 'The app requested an external asset');

  const box = await page.locator('#stage').boundingBox();
  const scale = Math.min((box.width - 64) / 1080, (box.height - 116) / 720);
  const left = box.x + (box.width - 1080 * scale) / 2;
  const top = box.y + (box.height - 720 * scale) / 2 - 14;
  const imagePoint = (x, y) => ({ x: left + x * scale, y: top + y * scale });
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  const downloadedBytes = async () => {
    const event = page.waitForEvent('download');
    await page.locator('#saveButton').click();
    const download = await event;
    return readFile(await download.path());
  };
  const downloadedSize = async () => {
    const data = await downloadedBytes();
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  };

  const beforeMosaic = await downloadedBytes();
  const brushPoint = imagePoint(250, 370);
  await page.mouse.move(brushPoint.x, brushPoint.y);
  await page.mouse.wheel(0, -100);
  assert.equal(await page.locator('#brushValue').textContent(), '48');
  await drag(brushPoint, imagePoint(500, 390));
  assert.equal((await downloadedBytes()).equals(beforeMosaic), false, 'Mosaic stroke did not change the image');
  await page.locator('#brushRange').focus();
  const russianUndo = () => page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(await russianUndo(), true);
  assert.equal((await downloadedBytes()).equals(beforeMosaic), true, 'Ctrl+Z did not undo the mosaic stroke');
  await drag(brushPoint, imagePoint(500, 390));

  await page.locator('[data-tool="marker"]').click();
  await page.mouse.move(brushPoint.x, brushPoint.y);
  await page.mouse.wheel(0, -100);
  assert.equal(await page.locator('#brushValue').textContent(), '48');
  await drag(imagePoint(180, 165), imagePoint(430, 245));
  await drag(imagePoint(290, 190), imagePoint(580, 265));
  assert.equal(await page.locator('#markerCount').textContent(), '2');
  await page.locator('[data-tool="marker"]').focus();
  assert.equal(await russianUndo(), true);
  assert.equal(await page.locator('#markerCount').textContent(), '1');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#markerCount').textContent(), '2');
  const removePoint = imagePoint(700, 450);
  await page.mouse.click(removePoint.x, removePoint.y, { button: 'right' });
  assert.equal(await page.locator('#markerCount').textContent(), '1');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markerCount').textContent(), '2');

  await page.locator('[data-tool="bubble"]').click();
  const tip = imagePoint(700, 410);
  await page.mouse.click(tip.x, tip.y);
  await page.locator('#bubbleText').fill('ПРОВЕРКА');
  assert.equal(await russianUndo(), true);
  assert.equal(await page.locator('#bubbleText').inputValue(), '', 'Ctrl+Z did not undo bubble text');
  await page.locator('#bubbleText').fill('ПРОВЕРКА');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#bubbleText').inputValue(), '', 'The next edit was not recorded after undo');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#bubbleText').inputValue(), 'ПРОВЕРКА');
  const bubblePng = await downloadedBytes();
  const bubblePadding = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows = [];
    for (let y = 305; y < 400; y++) {
      let white = 0;
      let ink = 0;
      for (let x = 740; x < 940; x++) {
        const offset = (y * canvas.width + x) * 4;
        const [r, g, b] = pixels.slice(offset, offset + 3);
        if (r > 250 && g > 250 && b > 250) white++;
        if (r < 110 && g < 110 && b < 110) ink++;
      }
      rows.push({ y, white, ink });
    }
    const body = rows.filter((row) => row.white >= 80);
    const text = rows.filter((row) => row.ink >= 2);
    return { top: text[0].y - body[0].y, bottom: body.at(-1).y - text.at(-1).y };
  }, `data:image/png;base64,${bubblePng.toString('base64')}`);
  assert.ok(Math.abs(bubblePadding.top - bubblePadding.bottom) <= 2, `Bubble padding differs: ${JSON.stringify(bubblePadding)}`);
  const bubbleBody = imagePoint(760, 330);
  await page.mouse.click(bubbleBody.x, bubbleBody.y);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#bubbleText').inputValue(), '', 'A simple bubble selection added a false undo step');
  await page.keyboard.press('Control+Shift+z');
  await drag(bubbleBody, imagePoint(800, 350));
  assert.equal((await downloadedBytes()).equals(bubblePng), false, 'Moving the bubble did not change the image');
  await page.keyboard.press('Control+z');
  assert.equal((await downloadedBytes()).equals(bubblePng), true, 'Ctrl+Z did not undo moving the bubble');
  await page.locator('#bubbleText').fill('Нечитаемый фрагмент\nпояснение редакции');
  assert.equal(await page.locator('#bubbleText').getAttribute('wrap'), 'off');
  await page.locator('#boldButton').click();
  assert.equal(await page.locator('#boldButton').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#bubbleCount').textContent(), '1');
  await page.mouse.move(tip.x, tip.y);
  await page.screenshot({ path: 'tests/bubble-hover.png', fullPage: true });

  assert.deepEqual(await downloadedSize(), [1080, 720]);
  await page.locator('#rotateRightButton').click();
  assert.deepEqual(await downloadedSize(), [720, 1080]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await downloadedSize(), [1080, 720]);

  await page.locator('#cropButton').click();
  await drag(imagePoint(0, 0), imagePoint(100, 80));
  await page.locator('[data-tool="mosaic"]').click();
  const cropped = await downloadedSize();
  assert.ok(cropped[0] < 1080 && cropped[1] < 720, 'Crop did not change exported dimensions');
  await page.locator('#resetCropButton').click();
  assert.deepEqual(await downloadedSize(), [1080, 720]);

  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'tests/editor-smoke.png', fullPage: true });
  process.stdout.write('Smoke test passed: offline face check, mosaic/marker/bubble undo, bubble ink alignment, rotation, crop, PNG export.\n');
} finally {
  await browser.close();
  await server.close();
}
