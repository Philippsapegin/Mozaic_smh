import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const load = async (scenario) => {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => document.getElementById('editorCanvas').width > 300);
  await page.evaluate(async (scenario) => {
    const { bindUpdates } = await import('/src/updates.js');
    window.updateLog = { check: 0, download: 0, install: 0, restart: 0, close: 0, save: 0 };
    const candidate = {
      version: '1.0.4',
      close: async () => { window.updateLog.close++; },
      download: async (onEvent) => {
        window.updateLog.download++;
        if (scenario === 'retry' && window.updateLog.download === 1) throw new Error('Offline');
        onEvent({ event: 'Started', data: { contentLength: 200 } });
        onEvent({ event: 'Progress', data: { chunkLength: 100 } });
        await new Promise((resolve) => { window.completeDownload = resolve; });
        onEvent({ event: 'Progress', data: { chunkLength: 100 } });
        onEvent({ event: 'Finished' });
      },
      install: async () => { window.updateLog.install++; },
    };
    const save = document.getElementById('saveButton');
    save.disabled = false;
    save.addEventListener('click', () => { window.updateLog.save++; });
    window.updateController = bindUpdates({
      enabled: true, hasImage: () => scenario === 'image',
      checkUpdate: async () => {
        window.updateLog.check++;
        if (scenario === 'offline') throw new Error('Offline');
        return scenario === 'current' ? null : candidate;
      },
      restart: async () => { window.updateLog.restart++; },
    });
    await window.updateController.refresh();
  }, scenario);
};

try {
  for (const scenario of ['current', 'offline']) {
    await load(scenario);
    assert.equal(await page.locator('#updateNotice').isVisible(), false);
    assert.equal(await page.locator('#emptyState').isVisible(), true);
  }
  await load('image');
  assert.equal(await page.locator('#updateNotice').isVisible(), true);
  assert.ok((await page.locator('#updateTitle').textContent()).includes('1.0.4'));
  await page.locator('#updateButton').click();
  assert.equal(await page.evaluate(() => window.updateLog.download), 0, 'The update started before the save reminder');
  assert.equal(await page.locator('#updateSaveButton').isVisible(), true);
  await page.locator('#updateSaveButton').click();
  assert.equal(await page.evaluate(() => window.updateLog.save), 1);
  await page.locator('#updateButton').click();
  await page.waitForFunction(() => document.getElementById('updateProgress').value === 100);
  assert.ok((await page.locator('#updateMessage').textContent()).includes('50%'));
  assert.equal(await page.locator('#updateButton').isDisabled(), true);
  assert.equal(await page.locator('#updateDismiss').isDisabled(), true);
  await page.screenshot({ path: 'tests/update-notice.png' });
  await page.evaluate(() => window.completeDownload());
  await page.waitForFunction(() => window.updateLog.restart === 1);
  assert.equal(await page.evaluate(() => window.updateLog.install), 1);

  await load('available');
  await page.locator('#updateDismiss').click();
  assert.equal(await page.locator('#updateNotice').isVisible(), false);
  await page.evaluate(() => window.updateController.refresh());
  assert.equal(await page.locator('#updateNotice').isVisible(), false, 'The dismissed release immediately reappeared');
  assert.equal(await page.evaluate(() => window.updateLog.close), 2);

  await load('retry');
  await page.locator('#updateButton').click();
  await page.waitForFunction(() => document.getElementById('updateButton').textContent === 'Повторить');
  assert.equal(await page.locator('#updateButton').isDisabled(), false);
  assert.equal(await page.evaluate(() => window.updateLog.install), 0);
  await page.locator('#updateButton').click();
  await page.waitForFunction(() => typeof window.completeDownload === 'function');
  await page.evaluate(() => window.completeDownload());
  await page.waitForFunction(() => window.updateLog.restart === 1);
  assert.equal(await page.evaluate(() => window.updateLog.download), 2);
  assert.deepEqual(errors, []);
  process.stdout.write('Update UI passed: no update, offline, save reminder, progress, install/restart, dismissal, retry.\n');
} finally {
  await browser.close();
  await server.close();
}
