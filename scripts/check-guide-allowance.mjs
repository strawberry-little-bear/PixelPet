// Real HTTP guide allowance/start coverage; constructed wallets, isolated DB and random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary) && resolve(binary) !== join(root, 'bin/pixelpet'), 'Set absolute PIXELPET_TEST_BINARY to an isolated binary');
assert(web && isAbsolute(web) && resolve(web) !== join(root, 'web/dist'), 'Set absolute PIXELPET_TEST_WEB to an isolated build');
const shared = async path => realpath(path).catch(() => resolve(path));
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Do not use shared binary, including symlinks');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Do not use shared web build, including symlinks');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-guide-allowance-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) { await page.locator(`.button-${k.toLowerCase()}`).tap(); }
async function visible(page, selector) {
  await wait(100);
  const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside native viewport: ${JSON.stringify(box)}`);
}
async function readable(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  const problems = await page.locator(selector).evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), problems = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) problems.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'reading text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  for (const mode of modes) for (const seen of [false, true]) for (const kind of ['normal', 'exhausted', 'partial', 'full-wallet', 'partial-wallet']) {
    const at = Date.now();
    const initial = await api('import', { schema: 1, species: 2, name: '陪玩不催币', createdAt: at - 3600000,
      hatchedAt: at - 3600000, lastTick: at, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, logs: [] });
    // Constructed UI fixtures, not naturally earned coins or a live player save.
    const fixture = initial.state, rules = initial.shop;
    fixture.economy.lastGameAt = initial.serverTime;
    fixture.economy.gameCoins = kind === 'exhausted' ? rules.gameDailyLimit : kind === 'partial' ? rules.gameDailyLimit - 1 : 0;
    fixture.economy.coins = kind === 'full-wallet' ? rules.maxCoins : kind === 'partial-wallet' ? rules.maxCoins - 1 : 12;
    await api('import', fixture);
    const before = (await api('state')).state;
    const id = seen ? 'walk' : 'fishing', index = seen ? 5 : 4;
    const expected = kind === 'exhausted' ? '当前游戏额度为 0；当前不能得币，仍可陪玩。'
      : kind === 'full-wallet' ? '钱包已满；当前不能得币，仍可陪玩。'
      : kind === 'partial-wallet' ? '钱包还能收 1 币（所有游戏共享）；实际奖励以结算时为准。'
      : `今日游戏额度剩 ${kind === 'partial' ? 1 : rules.gameDailyLimit} 币（所有游戏共享）；实际奖励以结算时为准。`;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    await context.addInitScript(({ font, seen, id }) => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
      if (seen) localStorage.setItem(`pixelpet-guide-v1-${id}`, 'seen');
    }), { font: mode.font, seen, id });
    const page = await context.newPage(), errors = [], writes = [];
    const label = `${id}-${kind}-${mode.width}-${mode.height}-${mode.font}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on('request', r => { if (r.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(r.url()).pathname)) writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const preferences = await page.evaluate(() => JSON.stringify(localStorage));
      for (const k of ['A', 'A', 'B']) await key(page, k);
      for (let i = 0; i < index; i++) await key(page, 'A');
      await key(page, 'B'); await page.locator('.game-guide').waitFor();
      if (!seen) {
        assert.equal(await page.getByLabel('当前游戏奖励额度').count(), 0);
        await key(page, 'A');
      }
      assert.equal(await page.getByLabel('当前游戏奖励额度').innerText(), expected);
      assert.match(await page.locator('.guide-reward').innerText(), /^基础规则：/);
      await readable(page, '.game-guide');
      await page.getByLabel('当前游戏奖励额度').scrollIntoViewIfNeeded(); await visible(page, '.guide-allowance');
      await page.locator('.game-guide > small').scrollIntoViewIfNeeded(); await visible(page, '.game-guide > small');
      assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      const read = (await api('state')).state;
      assert.deepEqual(read.economy, before.economy); assert.equal(read.careCount, before.careCount); assert.equal(read.game, before.game);
      if (mode.width === 320 && seen && ['exhausted', 'partial-wallet'].includes(kind)) await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      // Zero allowance/full wallet must not turn B into a disabled start key.
      await key(page, 'B'); await page.locator(seen ? '.walking-game' : '.fishing-game').waitFor();
      const after = (await api('state')).state;
      assert.equal(after.game.kind, id); assert.deepEqual(after.economy, before.economy);
      assert.equal(writes.length, 1); assert.equal(writes[0].body.kind, `play-${id}`);
      assert.deepEqual(errors, []); results.push({ id, kind, ...mode, passed: true });
      console.log('PASS', label);
    } catch (error) {
      await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
