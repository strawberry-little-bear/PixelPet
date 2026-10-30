// Cross-page shell contract regression. The test uses only a temporary save
// and the real A/B/C path, then checks that reading content scrolls in the LCD
// instead of changing the physical device geometry.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { assertBoundedReadingShell, assertSameReadingShell, readReadingShell } from './reading-shell-geometry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-shell-contract-'));
const port = await new Promise((resolvePort, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(error => error ? reject(error) : resolvePort(value));
  });
});
const base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
let server, browser, startupError, log = '';

async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}

async function key(page, value) {
  const button = page.locator(`.button-${value.toLowerCase()}:not(:disabled)`);
  await button.waitFor();
  await button.tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}

async function assertReading(page, label, baseline) {
  const classes = await page.locator('.device-stage').getAttribute('class');
  assert.match(classes, /reading-mode/, `${label}: did not enter reading mode`);
  assert.match(classes, /bounded-reading-mode/, `${label}: missing bounded reading mode`);
  assert.doesNotMatch(classes, /recovery-mode/, `${label}: recovery page was included in bounded contract`);
  const shell = await readReadingShell(page);
  assertBoundedReadingShell(shell, label);
  if (baseline) {
    assertSameReadingShell(shell, baseline, label);
  }
  assert.equal(await page.locator('.physical-button').count(), 3, `${label}: physical key count changed`);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0,
    `${label}: LCD gained a clickable gameplay control`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
    `${label}: page has horizontal overflow`);
  const scroll = await page.locator('.lcd-content').evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.equal(scroll.overflowY, 'auto', `${label}: LCD is not a scrollport`);
  assert(scroll.clientHeight > 0, `${label}: LCD viewport has no height`);
  return shell;
}

async function openMenuPage(page, index, selector, label, baseline) {
  await key(page, 'a');
  await page.locator('.care-menu-reading').waitFor();
  for (let i = 0; i < index; i++) await key(page, 'a');
  await key(page, 'b');
  if (selector) await page.locator(selector).waitFor();
  const shell = await assertReading(page, label, baseline);
  await key(page, 'c');
  await page.locator('.home-caption').waitFor();
  return shell;
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
  await api('import', {
    schema: 1,
    revision: 1,
    species: 2,
    name: '壳体契约小伙伴',
    createdAt: Date.now() - 48 * 3600000,
    hatchedAt: Date.now() - 48 * 3600000,
    lastTick: Date.now(),
    sleeping: false,
    needs: { hunger: 80, mood: 80, energy: 80, clean: 80 },
    careCount: 0,
    logs: [],
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [
    { label: 'desktop', width: 1200, height: 900, font: 14 },
    { label: 'phone-large', width: 320, height: 480, font: 28 },
  ];
  const results = [];
  for (const mode of modes) {
    const context = await browser.newContext({
      viewport: { width: mode.width, height: mode.height },
      hasTouch: true,
      isMobile: mode.width < 700,
      forcedColors: mode.font > 14 ? 'active' : 'none',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
    }), mode.font);
    try {
      await page.goto(base);
      await page.locator('.home-caption').waitFor();
      const baseline = await assertReading(page, `${mode.label}/home`);
      await key(page, 'a');
      await page.locator('.care-menu-reading').waitFor();
      await assertReading(page, `${mode.label}/menu`, baseline);
      await key(page, 'c');
      await page.locator('.home-caption').waitFor();
      const checks = [
        ['status', '.screen-status', 4],
        ['journal', '.screen-journal', 5],
        ['growth', '.growth-panel', 6],
        ['album', '.album-panel', 8],
        ['shop', '.shop-panel', 9],
        ['fish-album', '.fish-album', 10],
        ['park-album', '.park-album', 11],
        ['moment', '.quiet-moment-reading', 12],
      ];
      for (const [name, selector, index] of checks) {
        const shell = await openMenuPage(page, index, selector, `${mode.label}/${name}`, baseline);
        assertSameReadingShell(shell, baseline, `${mode.label}/${name}/baseline`);
      }

      // Enter the first game through the same directory and guide that a player
      // uses, then pause it. This covers a bounded game-reading shell too.
      await key(page, 'a');
      await page.locator('.care-menu-reading').waitFor();
      await key(page, 'a');
      await key(page, 'b');
      await page.locator('.arcade-panel').waitFor();
      await key(page, 'a');
      await key(page, 'a');
      await key(page, 'b');
      await page.locator('.game-guide').waitFor();
      await key(page, 'b');
      await page.locator('.snake-game').waitFor();
      await page.locator('.snake-overlay').waitFor();
      const paused = await assertReading(page, `${mode.label}/snake-pause`, baseline);
      assertSameReadingShell(paused, baseline, `${mode.label}/snake-pause/baseline`);
      await key(page, 'b');
      await page.locator('.game-abandon').waitFor();
      await key(page, 'b');
      await page.locator('.home-caption').waitFor();
      assert.deepEqual(errors, [], `${mode.label}: browser runtime errors`);
      results.push({ mode, views: checks.length + 2, baseline });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ modes: results.length, views: results.reduce((sum, item) => sum + item.views, 0), port, results }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolveExit => server.once('exit', resolveExit));
  }
  if (log) console.error(log);
}
