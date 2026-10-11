import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const work = await mkdtemp(join(tmpdir(), 'mozaic-update-check-'));
const executable = join(work, 'Mozaic.exe');
await copyFile(resolve('src-tauri/target/release/mozaic.exe'), executable);
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const child = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(work, 'profile') },
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  assert.ok(browser, 'Could not connect to the packaged updater');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => document.getElementById('editorCanvas').width > 300);
  const update = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:updater|check', { timeout: 20000 }));
  assert.equal(update, null, 'The published release should match the installed version');
  assert.equal(await page.locator('#updateNotice').isVisible(), false);
  process.stdout.write('Native updater passed: actual GitHub release, HTTPS endpoint, permissions, current version comparison.\n');
} finally {
  if (browser) await browser.close();
  child.kill();
}
