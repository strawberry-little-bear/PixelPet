// Repeat play through physical A/B/C; private build, random port and temporary save.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-arcade-selection-'));
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
const results = [], games = ['stars', 'tiles', 'snake', 'tetris', 'fishing', 'walk', 'treasure'];
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  const button = page.locator(`.button-${letter}:not(:disabled)`); await button.waitFor();
  if (page.viewportSize().width < 700) await button.tap(); else await page.keyboard.press(letter);
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function directory(page) { for (const k of ['a', 'a', 'b']) await key(page, k); }
async function selected(page, expected) {
  const card = page.locator('.arcade-card[aria-current=true]');
  assert.equal(await card.getAttribute('data-game'), expected);
  const box = await card.boundingBox(); assert(box && box.y >= -1 && box.y < page.viewportSize().height, 'retained selection not located');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28 }]) {
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '再玩一次',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.home-caption').waitFor(); await directory(page);
      for (const game of games) {
        await selected(page, game); await key(page, 'c'); await directory(page); await selected(page, game);
        await key(page, 'b'); assert.equal(await page.locator('.game-guide').getAttribute('data-guide'), game);
        await key(page, 'c'); await selected(page, game); await key(page, 'a');
      }
      await selected(page, 'stars'); assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('pixelpet-guide-v1-')).length), 0);
      for (let i = 0; i < 6; i++) await key(page, 'a');
      await key(page, 'c'); await directory(page); await selected(page, 'treasure');
      await page.screenshot({ path: join(dir, `${mode.name}-retained.png`), fullPage: true });
      await key(page, 'b'); assert.deepEqual(writes, []); await key(page, 'b');
      await page.locator('.treasure-pause').waitFor(); assert.equal(writes.length, 1); assert.equal(writes[0].kind, 'play-treasure');
      await key(page, 'c');
      for (let i = 0; i < 6; i++) {
        await key(page, 'b'); const hunt = (await api('state')).state.game.treasure;
        // Observe completion only; never use the hidden map to choose a cell.
        if (hunt.opened.length >= 6 || hunt.opened.filter(i => hunt.layout[i]).length === 3) break;
      }
      await page.locator('.treasure-game[data-done=true]').waitFor(); await key(page, 'b');
      await page.locator('.game-outcome').waitFor(); const earned = (await api('state')).state;
      assert(!earned.game); assert.equal(earned.careCount, 1); assert(earned.economy.coins >= 3 && earned.economy.coins <= 6);
      await key(page, 'c'); await directory(page); await selected(page, 'treasure');
      const before = writes.length;
      await key(page, 'b'); await page.locator('.game-quick-start').waitFor(); await key(page, 'c');
      await key(page, 'c'); await directory(page); await selected(page, 'treasure');
      assert.equal(writes.length, before); const after = (await api('state')).state;
      assert.equal(after.economy.coins, earned.economy.coins); assert.equal(after.careCount, 1); assert(!after.game);
      await page.reload(); await page.locator('.home-caption').waitFor(); await directory(page); await selected(page, 'stars');
      assert.equal(writes.filter(w => w.kind === 'play-treasure').length, 1);
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 1);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      assert.deepEqual(errors, []); results.push({ mode: mode.name, writes, coins: after.economy.coins, careCount: after.careCount });
    } catch (error) {
      await page.screenshot({ path: join(dir, `${mode.name}-failure.png`), fullPage: true }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exit = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exit;
  }
}
