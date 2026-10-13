import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import './mosaic.mjs';

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') process.stderr.write(`Browser error: ${message.text()}\n`);
});
let releaseFonts;
const delayedFonts = new Promise((resolve) => { releaseFonts = resolve; });
const fontRequests = [];
await page.route('**/roboto-condensed-*-700-normal.woff2', async (route) => {
  fontRequests.push(route.request().url());
  await delayedFonts;
  await route.continue();
});
await page.addInitScript(() => {
  window.bubbleDraws = [];
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
    if (['ПРОВЕРКА', 'ВТОРОЙ', 'ТРЕТИЙ', 'ЧЕТВЁРТЫЙ'].includes(text)) {
      window.bubbleDraws.push({ text, font: this.font, ready: document.fonts.check(this.font, text), width: this.measureText(text).width });
    }
    return fillText.call(this, text, ...args);
  };
});

try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil: 'domcontentloaded' });
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(132, 136, 24, 16);
    // A mostly monochrome document with balanced colored antialiasing fringes.
    ctx.fillStyle = 'rgb(180, 0, 0)';
    ctx.fillRect(143, 136, 1, 16);
    ctx.fillStyle = 'rgb(0, 180, 180)';
    ctx.fillRect(145, 136, 1, 16);
    ctx.fillStyle = 'rgb(210, 170, 120)';
    ctx.fillRect(320, 128, 32, 32);
    const source = ctx.getImageData(128, 128, 32, 32).data;
    const mean = [0, 0, 0];
    for (let i = 0; i < source.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += source[i + c] / 1024;
    const old = document.createElement('canvas');
    old.width = Math.ceil(1080 / 32);
    old.height = Math.ceil(720 / 32);
    const oldCtx = old.getContext('2d');
    oldCtx.drawImage(canvas, 0, 0, old.width, old.height);
    return { url: canvas.toDataURL(), expected: mean.map(Math.round), oldPixel: [...oldCtx.getImageData(4, 4, 1, 1).data] };
  });
  assert.ok(Math.max(...fixture.oldPixel.slice(0, 3)) - Math.min(...fixture.oldPixel.slice(0, 3)) > 30,
    'The fixture does not reproduce the old document color artifact');
  await page.locator('#fileInput').setInputFiles({ name: 'fringed-document.png', mimeType: 'image/png', buffer: Buffer.from(fixture.url.split(',')[1], 'base64') });
  assert.ok(fontRequests.some((url) => url.includes('cyrillic-700')), 'Bold Cyrillic was not requested before the first bubble');
  assert.equal(await page.locator('#emptyState').isVisible(), true, 'The editor became usable while its first bold font was unavailable');
  releaseFonts();
  await page.locator('#emptyState').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 120000 });
  process.stdout.write('Delayed bold fonts ready; document open.\n');
  const bounds = await page.locator('#stage').boundingBox();
  const scale = Math.min((bounds.width - 64) / 1080, (bounds.height - 116) / 720);
  const point = (x, y) => ({ x: bounds.x + (bounds.width - 1080 * scale) / 2 + x * scale, y: bounds.y + (bounds.height - 720 * scale) / 2 - 14 + y * scale });
  const click = async (x, y) => { const p = point(x, y); await page.mouse.click(p.x, p.y); };
  const exportPng = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveButton').click()]);
    return readFile(await download.path());
  };
  await click(144, 144);
  await click(336, 144);
  const colors = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return [144, 336].map((x) => [...ctx.getImageData(x, 144, 1, 1).data]);
  }, `data:image/png;base64,${(await exportPng()).toString('base64')}`);
  assert.deepEqual(colors[0], [...fixture.expected, 255], 'The exported document mosaic amplified colored fringes');
  assert.deepEqual(colors[1], [210, 170, 120, 255], 'The exported mosaic lost the original photo colors');

  await page.locator('[data-tool="bubble"]').click();
  await click(650, 290);
  await page.locator('#bubbleText').fill('ПРОВЕРКА');
  await page.locator('#boldButton').click();
  await page.waitForFunction(() => window.bubbleDraws.some((draw) => /^(bold|700) /.test(draw.font)));
  const firstBold = await page.evaluate(() => window.bubbleDraws.find((draw) => /^(bold|700) /.test(draw.font)));
  const expectedWidth = await page.evaluate(async () => {
    const face = new FontFace('Reference Bold', 'url(/node_modules/@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-700-normal.woff2)', { weight: '700' });
    document.fonts.add(await face.load());
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '700 26px "Reference Bold"';
    return ctx.measureText('ПРОВЕРКА').width;
  });
  assert.equal(firstBold.ready, true, 'The first bold draw used an unloaded font');
  assert.ok(Math.abs(firstBold.width - expectedWidth) < 0.01, 'The first bold draw used fallback glyphs');

  for (const [x, y, text] of [[170, 500, 'ВТОРОЙ'], [650, 570, 'ТРЕТИЙ']]) {
    await click(x, y);
    await page.locator('#bubbleText').fill(text);
  }
  const allSizes = async (size, texts = ['ПРОВЕРКА', 'ВТОРОЙ', 'ТРЕТИЙ']) => {
    await page.waitForFunction(({ size, texts }) => texts.every((text) => {
      const last = window.bubbleDraws.filter((draw) => draw.text === text).at(-1);
      return last?.font.includes(`${size}px`) && last.ready;
    }), { size, texts });
  };
  await page.evaluate(() => { window.bubbleDraws = []; });
  await page.locator('#fontValue').fill('34');
  await page.locator('#fontValue').press('Enter');
  await allSizes(34);
  for (let i = 0; i < 3; i++) {
    await page.locator('#bubbleList .list-row>span').nth(i).click();
    assert.equal(await page.locator('#fontValue').inputValue(), '34', 'Selecting a bubble restored an individual text size');
  }
  await page.evaluate(() => { window.bubbleDraws = []; });
  await exportPng();
  await allSizes(34);
  await page.keyboard.press('Control+z');
  await allSizes(26);
  assert.equal(await page.locator('#fontValue').inputValue(), '26');
  await page.keyboard.press('Control+Shift+z');
  await allSizes(34);
  await click(390, 350);
  await page.locator('#bubbleText').fill('ЧЕТВЁРТЫЙ');
  await allSizes(34, ['ПРОВЕРКА', 'ВТОРОЙ', 'ТРЕТИЙ', 'ЧЕТВЁРТЫЙ']);
  await page.locator('[data-tool="mosaic"]').click();
  for (const [input, expected] of [['1', '2'], ['999', '32']]) {
    await page.locator('#grainValue').fill(input);
    await page.locator('#grainValue').press('Enter');
    assert.equal(await page.locator('#grainValue').inputValue(), expected);
    assert.equal(await page.locator('#grainRange').inputValue(), expected);
  }
  assert.deepEqual(errors, []);
  process.stdout.write('Regressions passed: cold first Bold with real Cyrillic glyphs, neutral document mosaic, retained photo colors, shared text size, undo/redo, new bubble inheritance, grain 2–32.\n');
} catch (error) {
  process.stderr.write(`Regression UI: ${JSON.stringify(await page.evaluate(() => ({
    empty: !document.getElementById('emptyState').classList.contains('hidden'),
    saveDisabled: document.getElementById('saveButton').disabled,
    status: document.getElementById('faceStatus').textContent,
    toast: document.getElementById('toast').textContent,
    draws: window.bubbleDraws?.slice(-4),
  })).catch(() => ({})))}; errors: ${JSON.stringify(errors)}\n`);
  throw error;
} finally {
  releaseFonts();
  await browser.close();
  await server.close();
}
