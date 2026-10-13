import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const server = await preview({ preview: { host: '127.0.0.1', port: 0, headers: {
  'Content-Security-Policy': config.app.security.csp,
} } });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage();
const violations = [];
await page.addInitScript(() => {
  window.fontViolations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.violatedDirective.startsWith('font-src')) window.fontViolations.push(event.blockedURI);
  });
});
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('#emptyUploadButton').waitFor();
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 26px "Roboto Condensed"', 'Баббл Ёё № ABC'),
      document.fonts.load('700 26px "Roboto Condensed"', 'Баббл Ёё № ABC'),
    ]);
    return [...document.fonts].map((face) => ({ family: face.family, weight: face.weight, status: face.status, range: face.unicodeRange }));
  });
  violations.push(...await page.evaluate(() => window.fontViolations));
  assert.deepEqual(violations, [], 'Packaged fonts were blocked by the desktop security policy');
  for (const weight of ['400', '700']) {
    assert.ok(fonts.some((face) => face.weight === weight && face.status === 'loaded' && face.range.includes('400-45F')),
      `Bundled Cyrillic ${weight} is unavailable`);
  }
  process.stdout.write('Production fonts passed: actual desktop CSP, normal and bold Cyrillic, local font files.\n');
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
