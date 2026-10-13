import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const samplePath = process.argv[2];
if (!samplePath) throw new Error('Pass the path to the MediaPipe test portrait.');
const work = await mkdtemp(join(tmpdir(), 'mozaic-desktop-test-'));
const inputPath = join(work, 'Мозаика проверка.jpg');
await copyFile(resolve(samplePath), inputPath);
const executable = join(work, 'Mozaic.exe');
await copyFile(resolve('src-tauri/target/release/mozaic.exe'), executable);
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const child = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(work, 'WebViewProfile') },
  stdio: 'ignore',
});
const exec = promisify(execFile);
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!browser) throw new Error('Could not attach to the packaged application.');
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => { errors.push(error.message); process.stderr.write(`${error.message}\n`); });
  page.on('console', (message) => {
    if ((message.type() === 'error' && !message.text().startsWith('INFO:')) || message.text().startsWith('Offline face check')) {
      process.stderr.write(`Desktop console: ${message.text().replace(/data:[^'"\s]+/g, '[embedded asset]')}\n`);
    }
  });
  page.context().on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['tauri.localhost', 'ipc.localhost'].includes(url.hostname)) {
      external.push(url.href);
    }
  });
  await page.locator('#emptyUploadButton').waitFor();
  await page.waitForFunction(() => document.getElementById('editorCanvas').width > 300);
  assert.equal(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)), true);
  assert.equal(await page.evaluate(() => Boolean(window.isTauri)), true);
  await page.locator('#creditsButton').hover();
  assert.equal(await page.locator('#customTooltip').textContent(), 'Юрий Орлов и Филипп Сапегин, специально для Shkulev Media');
  assert.equal(await page.locator('#creditsButton').evaluate((element) => element.tagName), 'SPAN');
  const selectDialog = (title, path) => exec('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/native-dialog.ps1'),
    '-WindowTitle', title, '-AppProcessId', String(child.pid), ...(path ? ['-FilePath', path] : ['-ConfirmOnly']),
  ], { windowsHide: true });

  await page.waitForFunction(() => ['400', '700'].every((weight) => [...document.fonts]
    .some((face) => face.weight === weight && face.status === 'loaded' && face.unicodeRange.includes('400-45F'))));
  const cyrillicFonts = await page.evaluate(() => [...document.fonts]
    .filter((face) => face.family.replace(/["']/g, '') === 'Roboto Condensed' && face.unicodeRange.includes('400-45F'))
    .map((face) => ({ weight: face.weight, status: face.status })));
  for (const weight of ['400', '700']) {
    assert.ok(cyrillicFonts.some((face) => face.weight === weight && face.status === 'loaded'),
      `Packaged Cyrillic ${weight} was not loaded before editing`);
  }
  await page.locator('#emptyUploadButton').evaluate((button) => button.click());
  await selectDialog('Открыть изображение', inputPath);
  await page.locator('#emptyState').waitFor({ state: 'hidden' });
  process.stdout.write('Native Open passed; checking embedded face models.\n');
  await page.waitForFunction(() => !document.getElementById('faceStatus').textContent.includes('Ищем'), null, { timeout: 150000 });
  assert.equal(await page.locator('#faceCount').textContent(), '1');
  assert.ok(!(await page.locator('#faceStatus').textContent()).includes('недоступ'), 'Packaged face detection failed');
  await page.locator('.face-row input').evaluate((input) => input.click());
  assert.equal(await page.locator('.face-row input').isChecked(), false);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.face-row input').isChecked(), true, 'Desktop Ctrl+Z did not restore the mask');
  await page.locator('[data-tool="marker"]').click();
  const box = await page.locator('#stage').boundingBox();
  const scale = Math.min((box.width - 64) / 820, (box.height - 116) / 1024);
  const imagePoint = (x, y) => ({
    x: box.x + (box.width - 820 * scale) / 2 + x * scale,
    y: box.y + (box.height - 1024 * scale) / 2 - 14 + y * scale,
  });
  const drag = async (a, b, button = 'left') => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button });
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up({ button });
  };
  await drag(imagePoint(120, 875), imagePoint(540, 875));
  assert.equal(await page.locator('#markerCount').textContent(), '1');
  const linePoint = imagePoint(330, 875);
  await page.mouse.move(linePoint.x, linePoint.y);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => document.getElementById('markerWidthValue').value === '36');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markerWidthValue').inputValue(), '32');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#markerWidthValue').inputValue(), '36');
  await drag(imagePoint(120, 945), imagePoint(540, 945));
  await drag(imagePoint(180, 860), imagePoint(360, 900), 'right');
  assert.equal(await page.locator('#markerCount').textContent(), '3');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markerCount').textContent(), '2');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#markerCount').textContent(), '3');
  await page.locator('[data-tool="mosaic"]').click();
  await page.locator('.face-row').evaluate((row) => row.click());
  await page.screenshot({ path: 'tests/desktop-preview.png' });
  const outputPath = join(work, 'Мозаика проверка-mozaic.png');
  await page.locator('#saveButton').evaluate((button) => button.click());
  await selectDialog('Сохранить PNG');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Сохранено'));
  const output = await readFile(outputPath);
  assert.deepEqual([output.readUInt32BE(16), output.readUInt32BE(20)], [820, 1024]);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  process.stdout.write(`Desktop test passed: hover credits, marker lines, wheel thickness, RMB rectangles, undo/redo, embedded assets, offline face detection, native Open/Save, Unicode path, PNG export. ${outputPath}\n`);
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page && !page.isClosed()) process.stdout.write(`Final UI: ${JSON.stringify(await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, status: document.getElementById('faceStatus').textContent })).catch(() => ({})))}\n`);
  }
  if (browser) await browser.close();
  child.kill();
}
