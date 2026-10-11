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
  assert.equal(await page.locator('[title]').count(), 0, 'Native tooltips remain');
  let fileChooserCount = 0;
  page.on('filechooser', () => { fileChooserCount++; });
  await page.locator('#creditsButton').hover();
  assert.equal(await page.locator('#creditsButton').evaluate((element) => element.tagName), 'SPAN');
  assert.equal(await page.locator('#customTooltip').getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('#customTooltip').textContent(), 'Юрий Орлов и Филипп Сапегин, специально для Shkulev Media');
  const questionBounds = await page.locator('#creditsButton').boundingBox();
  const creditsBounds = await page.locator('#customTooltip').boundingBox();
  assert.ok(Math.abs(creditsBounds.x - questionBounds.x) < 30 && questionBounds.y - creditsBounds.y < 70, 'Credits are not beside the hovered question mark');
  await page.locator('#creditsButton').click();
  assert.equal(fileChooserCount, 0, 'Clicking the credits opened the file chooser');
  assert.equal(await page.locator('#creditsPopover').count(), 0);
  assert.equal(await page.locator('#customTooltip').getAttribute('aria-hidden'), 'false');
  for (const [tool, name] of [['mosaic', 'Мозаика'], ['marker', 'Маркер'], ['bubble', 'Баббл']]) {
    await page.locator(`[data-tool="${tool}"]`).hover();
    assert.equal(await page.locator('#customTooltip').textContent(), name);
    assert.equal(await page.locator('#customTooltip').evaluate((element) => getComputedStyle(element).opacity), '1', 'Tooltip appearance is delayed');
  }
  await page.mouse.move(700, 100);
  await page.waitForTimeout(55);
  const fadingOpacity = await page.locator('#customTooltip').evaluate((element) => Number(getComputedStyle(element).opacity));
  assert.ok(fadingOpacity > 0 && fadingOpacity < 1, 'Tooltip does not fade on pointer leave');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('customTooltip')).opacity === '0');

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
  const drag = async (a, b, button = 'left') => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button });
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up({ button });
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
  const pixelsAt = (bytes, points) => page.evaluate(async ({ url, points }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
  }, { url: `data:image/png;base64,${bytes.toString('base64')}`, points });

  const beforeMosaic = await downloadedBytes();
  const brushPoint = imagePoint(250, 370);
  await page.mouse.move(brushPoint.x, brushPoint.y);
  await page.mouse.wheel(0, -100);
  assert.equal(await page.locator('#brushValue').inputValue(), '48');
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
  assert.equal(await page.locator('#brushValue').inputValue(), '48');
  const beforeMarker = await downloadedBytes();
  const baselinePixels = await pixelsAt(beforeMarker, [[300, 655], [300, 674], [750, 684], [620, 680], [500, 650]]);
  await drag(imagePoint(180, 655), imagePoint(430, 655));
  assert.equal(await page.locator('#markerCount').textContent(), '1');
  assert.equal(await page.locator('#markerList .list-row>span').first().textContent(), 'Линия 1');
  const thinLine = await downloadedBytes();
  const thinPixels = await pixelsAt(thinLine, [[300, 655], [300, 674]]);
  assert.notDeepEqual(thinPixels[0], baselinePixels[0], 'A horizontal line was not painted');
  assert.deepEqual(thinPixels[1], baselinePixels[1], 'The initial line is too thick');
  const linePoint = imagePoint(300, 655);
  await page.mouse.move(linePoint.x, linePoint.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => document.getElementById('markerWidthValue').value === '40');
  const thickLine = await downloadedBytes();
  assert.notDeepEqual((await pixelsAt(thickLine, [[300, 674]]))[0], baselinePixels[1], 'Wheel did not thicken the hovered line');
  await page.keyboard.press('Control+z');
  assert.equal((await downloadedBytes()).equals(thinLine), true, 'Undo did not restore the whole wheel edit');
  assert.equal(await page.locator('#markerWidthValue').inputValue(), '32');
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await downloadedBytes()).equals(thickLine), true, 'Redo did not restore the line thickness');
  await drag(imagePoint(600, 640), imagePoint(900, 690));
  const nextLinePixels = await pixelsAt(await downloadedBytes(), [[750, 684], [620, 680]]);
  assert.notDeepEqual(nextLinePixels[0], baselinePixels[2], 'The next line did not inherit the changed thickness');
  assert.deepEqual(nextLinePixels[1], baselinePixels[3], 'A diagonal line filled its bounding rectangle');
  const beforeRectangle = await downloadedBytes();
  await drag(imagePoint(290, 640), imagePoint(580, 690), 'right');
  assert.equal(await page.locator('#markerCount').textContent(), '3');
  assert.equal(await page.locator('#markerList .list-row>span').last().textContent(), 'Прямоугольник 3');
  const rectanglePixels = await pixelsAt(await downloadedBytes(), [[300, 655], [500, 650]]);
  assert.deepEqual(rectanglePixels[0], (await pixelsAt(beforeRectangle, [[300, 655]]))[0], 'An intersection doubled the marker color');
  assert.notDeepEqual(rectanglePixels[1], baselinePixels[4], 'RMB did not paint a rectangle');
  await page.locator('[data-tool="marker"]').focus();
  assert.equal(await russianUndo(), true);
  assert.equal(await page.locator('#markerCount').textContent(), '2');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#markerCount').textContent(), '3');
  const removePoint = imagePoint(700, 450);
  await page.mouse.click(removePoint.x, removePoint.y, { button: 'right' });
  assert.equal(await page.locator('#markerCount').textContent(), '3', 'A right click deleted an existing highlight');
  await page.locator('#markerList .list-row button').last().click();
  assert.equal(await page.locator('#markerCount').textContent(), '2');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markerCount').textContent(), '3');
  await page.locator('#markerWidthValue').fill('52');
  await page.locator('#markerWidthValue').press('Enter');
  assert.equal(await page.locator('#markerWidthRange').inputValue(), '52');

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
  const beforeRotationPixels = await pixelsAt(await downloadedBytes(), [[300, 655], [750, 684], [620, 680]]);
  await page.locator('#rotateRightButton').click();
  assert.deepEqual(await downloadedSize(), [720, 1080]);
  assert.deepEqual(await pixelsAt(await downloadedBytes(), [[64, 300], [35, 750], [39, 620]]), beforeRotationPixels, 'Rotation changed line positions or pixel thickness');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await downloadedSize(), [1080, 720]);

  await page.locator('#cropButton').click();
  await drag(imagePoint(0, 0), imagePoint(100, 80));
  await page.locator('[data-tool="mosaic"]').click();
  const cropped = await downloadedSize();
  assert.ok(cropped[0] < 1080 && cropped[1] < 720, 'Crop did not change exported dimensions');
  await page.locator('#resetCropButton').click();
  assert.deepEqual(await downloadedSize(), [1080, 720]);

  await page.locator('[data-tool="bubble"]').click();
  await page.locator('#fontValue').fill('34');
  await page.locator('#fontValue').press('Enter');
  assert.equal(await page.locator('#fontRange').inputValue(), '34');
  await page.locator('[data-tool="mosaic"]').click();
  await page.locator('#grainValue').fill('21');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#grainValue').inputValue(), '32', 'Undo did not restore the numeric setting');
  await page.locator('#grainValue').fill('24');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#grainValue').inputValue(), '32', 'A fresh numeric edit was lost after undo');
  await page.locator('#grainValue').fill('999');
  await page.locator('#grainValue').press('Enter');
  assert.equal(await page.locator('#grainValue').inputValue(), '80', 'Numeric input is outside slider bounds');
  await page.locator('#grainValue').fill('21');
  await page.locator('#grainValue').press('Enter');
  await page.locator('#brushValue').fill('76');
  await page.locator('#brushValue').press('Enter');
  await page.locator('#brushRange').focus();
  await page.locator('#brushRange').press('ArrowRight');
  assert.equal(await page.locator('#brushValue').inputValue(), '77', 'Slider did not update its numeric field');
  await page.mouse.move(brushPoint.x, brushPoint.y);
  await page.mouse.wheel(0, -100);
  assert.equal(await page.locator('#brushValue').inputValue(), '81', 'Wheel did not update the numeric field');
  for (const name of ['next-document.png', 'third-document.png']) {
    await page.locator('#fileInput').setInputFiles({
      name, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
    });
    await page.waitForFunction(() => document.getElementById('bubbleCount').textContent === '0');
    await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 120000 });
    assert.deepEqual(await page.locator('.range-value').evaluateAll((inputs) => inputs.map((input) => input.value)), ['21', '81', '52', '34'], 'Settings reset on the next image');
    if (name === 'next-document.png') {
      await page.locator('[data-tool="bubble"]').click();
      await page.mouse.click(tip.x, tip.y);
      assert.equal(await page.locator('#fontValue').inputValue(), '34', 'The next bubble did not inherit the text size');
      await page.locator('[data-tool="mosaic"]').click();
    }
  }
  await page.keyboard.press('Control+z');
  assert.deepEqual(await page.locator('.range-value').evaluateAll((inputs) => inputs.map((input) => input.value)), ['21', '81', '52', '34'], 'Undo on a fresh image changed its settings');
  await page.locator('[data-tool="marker"]').click();
  await page.locator('#fileInput').setInputFiles({
    name: 'marker-document.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  });
  await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 120000 });
  assert.equal(await page.locator('[data-tool="marker"]').getAttribute('aria-pressed'), 'true', 'Loading an image changed the selected tool');
  assert.equal(await page.locator('#markerWidthValue').inputValue(), '52');
  await drag(imagePoint(180, 655), imagePoint(430, 655));
  assert.notDeepEqual((await pixelsAt(await downloadedBytes(), [[300, 679]]))[0], baselinePixels[0], 'The new image did not inherit the marker thickness');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markerCount').textContent(), '0');
  assert.equal(await page.locator('#markerWidthValue').inputValue(), '52');

  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'tests/editor-smoke.png', fullPage: true });
  process.stdout.write('Smoke test passed: hover credits, instant/fading tooltips, straight marker lines, wheel thickness and inheritance, RMB rectangles, union mask, numeric controls, settings across three images, offline faces, undo, bubble ink alignment, rotation, crop, PNG export.\n');
} finally {
  await browser.close();
  await server.close();
}
