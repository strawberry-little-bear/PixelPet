// Import previews are reading content inside the LCD. Keep the physical shell
// bounded for both a valid backup and a local file-read failure.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-import-preview-layout-'));
const port = await new Promise((resolvePort, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const value = socket.address().port;
    socket.close(error => error ? reject(error) : resolvePort(value));
  });
});
const base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
let server, browser, startupError, log = '';

async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}

async function shell(page) {
  return page.evaluate(() => Object.fromEntries(
    ['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content'].map(selector => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [selector, {
        height: box.height,
        cssHeight: style.height,
        overflowY: style.overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }];
    }),
  ));
}

function assertBounded(metrics, label) {
  for (const selector of ['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content']) {
    assert.notEqual(metrics[selector].cssHeight, 'auto', `${label}: ${selector} reverted to auto height`);
  }
  assert.equal(metrics['.lcd-content'].overflowY, 'auto', `${label}: LCD content is not scrollable`);
  assert(metrics['.lcd-content'].clientHeight > 0, `${label}: LCD content has no viewport`);
}

async function openPreview(page, body) {
  await page.getByRole('button', { name: '存档盒', exact: true }).click();
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'layout-check.json', mimeType: 'application/json', buffer: Buffer.from(body),
  });
  await page.locator('.import-preview').waitFor();
  await page.waitForFunction(() => document.querySelector('.import-preview')?.getAttribute('aria-busy') === 'false');
}

try {
  server = spawn(binary, [], {
    cwd: root,
    env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; });
  server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try {
      if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; }
    } catch { /* Server is still starting. */ }
    await wait(50);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });

  const now = Date.now();
  await api('import', {
    schema: 1, revision: 1, species: 2, name: '导入预览基准伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 80, energy: 90 }, careCount: 0, logs: [],
  });
  const saved = (await api('state')).state;
  const results = [];
  for (const mode of [
    { name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 700, font: 28 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: mode.width, height: mode.height }, hasTouch: mode.width < 700,
      isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.width < 700 ? 'active' : 'none',
    });
    const page = await context.newPage();
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      await page.goto(base);
      await page.locator('.home-caption').waitFor();

      await openPreview(page, JSON.stringify({ ...saved, name: '这是一个很长的备份名称，用来确认导入预览会在 LCD 内换行和滚动，而不会把整台设备撑高' }));
      const valid = await shell(page);
      assertBounded(valid, `${mode.name} valid preview`);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.getByText('尚未导入 · B 确认替换，A / C 取消', { exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.keyboard.press('c');
      await page.locator('.home-caption').waitFor();

      await openPreview(page, '{not-json');
      const invalid = await shell(page);
      assertBounded(invalid, `${mode.name} invalid preview`);
      for (const selector of ['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content']) {
        assert(Math.abs(valid[selector].height - invalid[selector].height) < 1,
          `${mode.name}: ${selector} changed between valid and invalid preview`);
      }
      assert.equal(await page.locator('.import-preview [role="alert"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      results.push({ mode: mode.name, valid, invalid });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ modes: results.length, port, artifacts: dir, results }));
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolveExit => server.once('exit', resolveExit));
    server.kill('SIGTERM');
    await closed;
  }
}
