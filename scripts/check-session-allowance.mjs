// Real HTTP paused-session allowance coverage; constructed wallets, isolated DB and random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-session-allowance-')), results = [];
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
// A sticky treasure key dock can overlap a tall paragraph at one position.
// Verify every text line is reachable by native page scroll above that dock.
async function reachableLines(page) {
  await page.locator('.session-allowance').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({ top: r.top + scrollY, left: r.left, width: r.width, height: r.height }));
      for (const line of lines) {
        window.scrollTo({ top: line.top - 12, behavior: 'instant' });
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit)) throw new Error('Allowance line not reachable above overlays: ' + text.textContent);
      }
    }
  });
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
  const games = [{ id: 'snake', index: 2 }, { id: 'tetris', index: 3 }, { id: 'fishing', index: 4 }, { id: 'walk', index: 5 }, { id: 'treasure', index: 6 }];
  for (const mode of modes) for (const game of games) for (const kind of ['exhausted', 'full-wallet']) {
    const at = Date.now();
    const initial = await api('import', { schema: 1, species: 2, name: '不为金币赶路', createdAt: at - 3600000,
      hatchedAt: at - 3600000, lastTick: at, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, logs: [] });
    const fixture = initial.state, rules = initial.shop;
    fixture.economy.lastGameAt = initial.serverTime;
    fixture.economy.gameCoins = kind === 'exhausted' ? rules.gameDailyLimit : 0;
    fixture.economy.coins = kind === 'full-wallet' ? rules.maxCoins : 12;
    await api('import', fixture);
    const before = (await api('state')).state;
    const expected = kind === 'exhausted' ? '当前游戏额度为 0；当前不能得币，仍可陪玩。' : '钱包已满；当前不能得币，仍可陪玩。';
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    await context.addInitScript(({ font, id }) => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
      localStorage.setItem(`pixelpet-guide-v1-${id}`, 'seen');
    }), { font: mode.font, id: game.id });
    const page = await context.newPage(), errors = [], writes = [];
    const label = `${game.id}-${kind}-${mode.width}-${mode.height}-${mode.font}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on('request', r => { if (r.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(r.url()).pathname)) writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      for (const k of ['A', 'A', 'B']) await key(page, k);
      for (let i = 0; i < game.index; i++) await key(page, 'A');
      await key(page, 'B'); await page.locator('.game-guide').waitFor(); await key(page, 'B');
      await page.locator(`.${game.id === 'walk' ? 'walking' : game.id}-game`).waitFor();
      if (game.id === 'fishing') { await key(page, 'B'); await key(page, 'C'); }
      const panel = page.getByLabel('本局奖励提示'); await panel.waitFor();
      assert.equal(await page.getByLabel('当前游戏奖励额度').innerText(), expected);
      assert.match(await panel.innerText(), /基础规则不代表本局一定得币/);
      const toast = page.getByRole('button', { name: '关闭提示' });
      if (await toast.isVisible()) await toast.click();
      await readable(page, '.session-allowance');
      await panel.scrollIntoViewIfNeeded(); await visible(page, '.session-allowance');
      await reachableLines(page);
      const count = writes.length, preferences = await page.evaluate(() => JSON.stringify(localStorage));
      const paused = (await api('state')).state;
      await wait(350);
      assert.equal(writes.length, count, 'reading must not write');
      assert.deepEqual((await api('state')).state.game, paused.game, 'reading must not advance the game');
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      assert.deepEqual(paused.economy, before.economy);
      if (mode.width === 320 && mode.height === 380 && kind === 'exhausted') await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      // Resume is still deliberate and available even with zero payout capacity.
      await key(page, 'C'); await panel.waitFor({ state: 'detached' });
      const resume = writes.find(w => w.body.kind === `${game.id === 'fishing' ? 'fish' : game.id}-resume`);
      assert(resume, 'manual resume should not be blocked by allowance');
      assert.deepEqual((await api('state')).state.economy, before.economy);
      await key(page, 'C'); await panel.waitFor();
      assert.equal(await page.getByLabel('当前游戏奖励额度').innerText(), expected);
      if (game.id === 'treasure') {
        // A genuine untimed terminal/collect flow, no injected board or rewards.
        await key(page, 'C'); await panel.waitFor({ state: 'detached' });
        for (let i = 0; i < 6; i++) {
          await key(page, 'B');
          const hunt = (await api('state')).state.game.treasure;
          if (hunt.opened.length >= 6 || hunt.opened.filter(tile => hunt.layout[tile] > 0).length === 3) break;
        }
        await page.locator('.treasure-game[data-done="true"]').waitFor(); await panel.waitFor();
        assert.equal(await page.getByLabel('当前游戏奖励额度').innerText(), expected);
        await readable(page, '.session-allowance');
        await key(page, 'B'); await page.locator('.home-caption').waitFor();
        const finished = (await api('state')).state;
        assert(!finished.game); assert.equal(finished.economy.coins, before.economy.coins);
        assert(writes.some(w => w.body.kind === 'treasure-finish'));
        assert.equal(await panel.count(), 0);
      }
      assert.deepEqual(errors, []); results.push({ game: game.id, kind, ...mode, passed: true });
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
