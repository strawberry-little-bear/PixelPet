// Isolated HTTP/browser regression for accepting server time before the first
// display-clock interval. Only the browser wall clock is skewed; no OS/server
// clock changes, player files, existing services or automatic reward claims.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB');
const sharedPath = path => realpath(path).catch(error => { if (error.code === 'ENOENT') return resolve(path); throw error; });
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')), 'Do not run the shared binary');
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-app-clock-')), results = [], day = 86400000;
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const reply = await fetch(base + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(reply.ok, await reply.clone().text()); return reply.json();
}
async function key(page, key) { await page.keyboard.press(key); await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled); }
async function openMenu(page, index) { await key(page, 'a'); for (let i = 0; i < index; i++) await key(page, 'a'); await key(page, 'b'); }
async function layout(page, selector) {
  const problems = await page.locator(selector).evaluate(el => {
    const errors = [], bounds = document.querySelector('.lcd-content').getBoundingClientRect();
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('horizontal overflow');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) if (rect.width && rect.height && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) errors.push('outside LCD: ' + text.textContent);
    }
    return errors;
  });
  assert.deepEqual(problems, []);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const skew of [-(7 * day + 1234), 0, 7 * day + 1234]) for (const mode of [
    { label: 'desktop', width: 1280, height: 900, font: 14 }, { label: 'phone-large', width: 320, height: 568, font: 28 },
  ]) for (const profile of ['status', 'legacy', 'stars', 'daily-claimed', 'daily-open', 'arcade-quota']) {
    const at = Date.now();
    const imported = await api('import', { schema: 1, revision: 1, species: 2, name: '校时伙伴', createdAt: at - 31 * 3600000,
      hatchedAt: at - 30 * 3600000, lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    assert.equal(imported.state.growth.stage, 'growing');
    if (profile === 'daily-claimed') await api('action', { kind: 'daily', requestId: crypto.randomUUID() });
    if (profile === 'daily-open' || profile === 'arcade-quota') {
      const state = structuredClone(imported.state);
      if (profile === 'daily-open') state.economy.lastDailyAt = at - day;
      else { state.economy.lastGameAt = at; state.economy.gameCoins = 30; state.economy.coins = 30; }
      await api('import', state); // Explicit test histories, not real earned rewards.
    }
    if (profile === 'stars') { await api('action', { kind: 'play', requestId: crypto.randomUUID() }); await wait(1350); }
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ skew, font }) => {
        const nativeNow = Date.now.bind(Date); Date.now = () => nativeNow() + skew;
        // Keep rAF, input, network and timeouts real. Hold only the app's two
        // display intervals so every assertion observes pre-first-tick state.
        const nativeInterval = window.setInterval.bind(window);
        window.__heldDisplayIntervals = 0;
        window.setInterval = (handler, delay, ...args) => {
          if (delay === 100 || delay === 1000) { window.__heldDisplayIntervals++; return nativeInterval(() => {}, delay); }
          return nativeInterval(handler, delay, ...args);
        };
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; });
      }, { skew, font: mode.font });
      const page = await context.newPage(), samples = [], writes = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/visit') writes.push(request.url()); });
      await page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (profile === 'legacy' && reply.state) { reply.state.schema = 1; delete reply.state.growth; }
        if (reply.state) samples.push(reply);
        await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.waitForFunction(() => document.querySelector('.home-caption,.star-game'));
      const browserNow = await page.evaluate(() => Date.now());
      assert(Math.abs(browserNow - Date.now() - skew) < 2000);
      let selector;
      if (profile === 'status') {
        await openMenu(page, 4); selector = '.screen-status';
        const sample = samples.at(-1), expectedDay = Math.floor(Math.max(0, sample.serverTime - sample.state.hatchedAt) / day) + 1;
        assert((await page.locator('.status-name small').innerText()).replace(/\s/g, '').includes(`相识第${expectedDay}天`));
        assert.equal(await page.locator('.status-reading time').getAttribute('datetime'), new Date(sample.state.lastTick).toISOString());
      } else if (profile === 'legacy') {
        await openMenu(page, 6); selector = '.growth-panel';
        assert.equal(await page.locator('.growth-panel-title strong').innerText(), '成长期');
        assert((await page.locator('.growth-score b').innerText()).startsWith('6.0'));
        assert.equal(samples.at(-1).state.growth, undefined);
      } else if (profile === 'stars') {
        selector = '.star-game'; const sample = samples.at(-1);
        const expected = Math.floor(Math.max(0, sample.serverTime - sample.state.game.startedAt) / 900) % 3;
        assert.equal(await page.locator('.game-lane').evaluateAll(lanes => lanes.findIndex(lane => lane.querySelector('.falling-star.visible'))), expected);
        assert.equal(sample.state.game.round, 0); assert.equal(sample.state.game.score, 0);
      } else if (profile === 'arcade-quota') {
        await openMenu(page, 1); selector = '.arcade-panel';
        assert((await page.locator('.arcade-quota').innerText()).includes('剩 0 / 30 币'));
        assert((await page.locator(selector).innerText()).includes('今日不再得币，仍可陪它玩'));
      } else {
        await openMenu(page, 9); selector = '.shop-panel';
        assert.equal(await page.locator('.shop-decision').innerText(), profile === 'daily-claimed' ? '今日已领取 · 不必连续来' : 'B 收下 10 金币');
      }
      await layout(page, selector);
      assert(await page.evaluate(() => window.__heldDisplayIntervals > 0));
      if (skew > 0) await page.screenshot({ path: join(dir, `${profile}-${mode.label}.png`), fullPage: true });
      if (profile === 'daily-claimed') await key(page, 'b'); // Must not send a duplicate claim.
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ skew, mode: mode.label, profile, serverTime: samples.at(-1).serverTime, browserNow, legacyFixture: profile === 'legacy', importedHistory: ['daily-open', 'arcade-quota'].includes(profile), writes: writes.length });
      console.log('PASS', results.length, skew, mode.label, profile);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results }, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(join(dir, 'server.log'), log);
}
