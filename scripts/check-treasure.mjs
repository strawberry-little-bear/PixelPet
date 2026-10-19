// Real Chrome + real HTTP, ephemeral port/SQLite and isolated build only.
// Never accepts a player URL or imports into a running user service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed(quota = false) {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '寻宝测试伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  if (quota) {
    const state = (await api('state')).state;
    state.economy.gameCoins = 30; state.economy.lastGameAt = state.lastTick;
    await api('import', state);
  }
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function selectTreasure(page) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(6).fill('A')]) await key(page, k);
  assert.equal(await page.locator('.arcade-card.selected').getAttribute('data-game'), 'treasure');
  assert.equal(await page.locator('.arcade-card').count(), 7);
}
async function start(page, repeat = false) {
  await selectTreasure(page); await key(page, 'B');
  await page.locator('.game-guide').waitFor();
  if (repeat) assert.equal(await page.locator('.game-quick-start').count(), 1);
  await key(page, 'B');
  await page.locator('.treasure-pause').waitFor();
}
async function readable(page) {
  const issues = await page.locator('.treasure-game').evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (['hidden', 'clip'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(node.textContent);
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'text clipped');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
async function digIndex(page, index) {
  for (let i = 0; i < 9; i++) {
    const chosen = await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label');
    if (chosen.startsWith(`${index + 1}号格`)) { await key(page, 'B'); return; }
    await key(page, 'A');
  }
  throw new Error(`Could not select ${index}`);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const font of [14, 28]) {
    await seed();
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
      isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    const page = await ctx.newPage(), errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
    }), font);
    try {
      await page.goto(base); await start(page); await readable(page);
      // Capture actual text size, not only root-font settings.
      assert(Math.abs(await page.locator('.treasure-grid span').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)) - 12 * font / 14) < .1);
      await page.locator('.treasure-pause').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `pause-${width}-${font}.png`) });
      await key(page, 'C');
      let saved = (await api('state')).state;
      const original = structuredClone(saved.game.treasure), id = saved.game.id;
      const empty = original.layout.flatMap((v, i) => v === 0 ? [i] : []);
      await digIndex(page, empty[0]);
      const searched = structuredClone((await api('state')).state.game.treasure);
      await page.reload(); await page.locator('.treasure-pause').waitFor();
      assert.deepEqual((await api('state')).state.game.treasure, searched);
      const count = writes.length; await wait(1300); assert.equal(writes.length, count, 'automatic resume/exploration');
      // Re-read rules, return paused, no model mutation or exploration.
      await key(page, 'A'); await key(page, 'B'); await page.locator('.game-guide').waitFor();
      await key(page, 'B'); await key(page, 'C'); await page.locator('.treasure-pause').waitFor();
      assert.deepEqual((await api('state')).state.game.treasure, searched);
      await key(page, 'C'); await readable(page);
      await page.locator('.treasure-grid').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `active-${width}-${font}.png`) });
      // Deliberately explore six real empty cells; terminal reveal must not pay for unsearched objects.
      for (const i of empty.slice(1)) await digIndex(page, i);
      await page.locator('.treasure-game[data-done=true]').waitFor(); await readable(page);
      assert.equal(await page.locator('.treasure-grid').getByText('留在林间').count(), 3);
      saved = (await api('state')).state;
      assert.equal(saved.careCount, 0); assert.equal(saved.economy.coins, 0);
      const finishStep = saved.game.treasure.step;
      await key(page, 'A'); assert.equal((await api('state')).state.careCount, 0);
      await page.locator('.treasure-status').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `done-${width}-${font}.png`) });
      await key(page, 'B'); saved = (await api('state')).state;
      assert(!saved.game); assert.equal(saved.careCount, 1); assert.equal(saved.economy.coins, 3);
      assert.equal(saved.companion.recent.kind, 'treasure');
      assert.equal(saved.album.entries.filter(m => m.kind === 'treasure').length, 1);
      const duplicate = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'treasure-finish', gameId: id, step: finishStep }) });
      assert.equal(duplicate.status, 400); assert.equal((await api('state')).state.economy.coins, 3);
      // Confirm optional intro preference, and two-step abandon (C cancels).
      await page.reload(); await start(page, true); assert.equal(await page.locator('.game-guide').count(), 0);
      for (const k of ['A', 'A', 'B', 'C']) await key(page, k);
      assert((await api('state')).state.game);
      for (const k of ['A', 'A', 'B', 'B']) await key(page, k);
      assert(!(await api('state')).state.game); assert.equal((await api('state')).state.careCount, 1);
      assert.deepEqual(errors, []); results.push({ width, font, groups: 'start/reload/rules/six-real-digs/explicit-finish/replay/repeat/abandon', writes: writes.map(a => a.kind) });
    } catch (e) {
      await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
      await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, font, writes, errors, state: await api('state') }, null, 2));
      console.error('Artifacts:', dir); throw e;
    } finally { await ctx.close(); }
  }
  // Shared daily cap: all three found still count companionship, but cannot mint coins.
  await seed(true); await api('action', { kind: 'play-treasure' });
  let r = await api('state'), g = r.state.game;
  await api('action', { kind: 'treasure-resume', gameId: g.id, step: 0 });
  for (const tile of g.treasure.layout.flatMap((v, i) => v > 0 ? [i] : [])) {
    r = await api('state'); await api('action', { kind: 'treasure-dig', gameId: g.id, step: r.state.game.treasure.step, tile });
  }
  r = await api('state'); assert.equal(r.state.game.treasure.opened.length, 3);
  r = await api('action', { kind: 'treasure-finish', gameId: g.id, step: r.state.game.treasure.step });
  assert.equal(r.state.careCount, 1); assert.equal(r.state.economy.coins, 0); assert.equal(r.state.economy.gameCoins, 30);
  results.push({ quotaExhausted: true, earlyAllThree: true, coins: 0, careCount: 1 });
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
