// Real HTTP/Chrome and three-key play on private builds and a temporary SQLite.
// No player URL, clock changes, mocked game responses or map-guided choices.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-pause-hints-'));
const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const hints = ['不会自动探索', '不消耗探索次数', '先打开放弃确认'];
const layouts = [], journeys = [];
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result;
}
async function key(page, letter) {
  const button = page.locator(`.button-${letter}:not(:disabled)`); await button.waitFor();
  if (page.viewportSize().width < 700) await button.tap(); else await page.keyboard.press(letter);
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function choose(page, choice) {
  await page.locator('.treasure-pause-hint').waitFor();
  const current = await page.locator('.treasure-pause li').evaluateAll(els => els.findIndex(el => el.getAttribute('aria-current') === 'true'));
  assert(current >= 0);
  for (let i = 0; i < (choice - current + 3) % 3; i++) await key(page, 'a');
  assert.match(await page.locator('.treasure-pause-hint').textContent(), new RegExp(hints[choice]));
}
async function inspect(page, name, choice) {
  const hint = page.locator('.treasure-pause-hint');
  assert.match(await hint.textContent(), new RegExp(hints[choice]));
  assert.equal(await hint.getAttribute('aria-live'), 'polite');
  assert.equal(await hint.getAttribute('aria-atomic'), 'true');
  const result = await page.locator('.treasure-game').evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > footer.top + 1) clipped.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), bounds = p.getBoundingClientRect();
          if (/hidden|clip/.test(style.overflowY) && (box.top < bounds.top - 2 || box.bottom > bounds.bottom + 2)) clipped.push(node.textContent);
        }
      }
    }
    return { clipped, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(el.querySelector('.treasure-pause-hint')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  assert.deepEqual(result.clipped, []); assert(!result.overflow); assert(result.font >= result.rootFont * .85);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const button of await page.locator('.physical-button').all()) {
    await button.scrollIntoViewIfNeeded();
    assert(await button.evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width >= 44 && r.height >= 44 && hit !== null && el.contains(hit); }));
  }
  // A sticky key dock can cover part of a long reading panel at a given
  // scroll offset. Prove each line can be read above it, not just that the
  // document has no clipping. Do not demand a whole large-text panel at once.
  const reachableLines = await hint.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const count = range.getClientRects().length, issues = [];
    for (let i = 0; i < count; i++) {
      let box = range.getClientRects()[i];
      window.scrollBy({ top: box.top - 12, behavior: 'instant' });
      box = range.getClientRects()[i];
      const dock = document.querySelector('.device-buttons').getBoundingClientRect();
      if (box.top < 8 || box.bottom > Math.min(innerHeight, dock.top) - 8) issues.push(i);
    }
    return { count, issues };
  });
  assert(reachableLines.count > 0); assert.deepEqual(reachableLines.issues, []);
  await page.screenshot({ path: join(dir, `${name}-${choice}-reading.png`) });
  await page.screenshot({ path: join(dir, `${name}-${choice}.png`), fullPage: true });
  layouts.push({ name, choice, ...result, reachableLines });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 380, font: 28 }]) {
    const now = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '慢慢寻宝', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-treasure' });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.width < 700 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.treasure-pause-hint').waitFor();
      const initial = (await api('state')).state;
      assert.match(await page.locator('.treasure-pause-hint').textContent(), /仍选中 1 号未探索格/);
      for (let choice = 0; choice < 3; choice++) { await choose(page, choice); await inspect(page, mode.name, choice); }
      await choose(page, 1); await key(page, 'b'); await page.locator('.game-guide').waitFor();
      await key(page, 'b'); assert.match(await page.locator('.game-guide').textContent(), /2 \/ 2/);
      await key(page, 'c'); await choose(page, 2); await wait(1100);
      assert.deepEqual(writes, []); assert.deepEqual((await api('state')).state.game, initial.game);
      // C continues on the discard selection; no exploration follows without B.
      await key(page, 'c'); await page.locator('.treasure-pause-hint').waitFor({ state: 'detached' });
      await wait(1100); assert.deepEqual(writes.map(w => w.kind), ['treasure-resume']);
      assert.deepEqual((await api('state')).state.game.treasure.opened, []);
      await key(page, 'b'); await key(page, 'c'); await page.locator('.treasure-pause-hint').waitFor();
      const paused = (await api('state')).state, count = writes.length;
      assert.deepEqual(paused.game.treasure.opened, [0]);
      assert.match(await page.locator('.treasure-pause-hint').textContent(), /仍选中 2 号未探索格/);
      await inspect(page, `${mode.name}-after-dig`, 0);
      for (const cancel of ['a', 'c']) {
        await choose(page, 2); await key(page, 'b'); await page.locator('.game-abandon').waitFor();
        await key(page, cancel); await page.locator('.treasure-pause-hint').waitFor();
      }
      await page.reload(); await page.locator('.treasure-pause-hint').waitFor(); await wait(1100);
      assert.equal(writes.length, count); assert.deepEqual((await api('state')).state.game, paused.game);
      assert.match(await page.locator('.treasure-pause-hint').textContent(), /仍选中 2 号未探索格/);
      assert.equal(paused.economy.coins, 0); assert.equal(paused.careCount, 0);
      // Plain next-cell play, without inspecting the map to choose a location.
      await key(page, 'c');
      for (let i = 0; i < 5; i++) {
        await key(page, 'b');
        if (await page.locator('.treasure-game[data-done=true]').count()) break;
      }
      await page.locator('.treasure-game[data-done=true]').waitFor();
      assert.equal(await page.locator('.treasure-pause-hint').count(), 0);
      const finished = (await api('state')).state, n = finished.game.treasure;
      const found = n.opened.filter(at => n.layout[at] > 0).length;
      assert(n.opened.length === 6 || found === 3); assert.equal(finished.economy.coins, 0); assert.equal(finished.careCount, 0);
      assert.match(await page.locator('.treasure-status').textContent(), /B \/ C 收好/);
      await key(page, 'b'); await page.locator('.content-home').waitFor();
      const collected = (await api('state')).state;
      assert(!collected.game); assert.equal(collected.economy.coins, 3 + found); assert.equal(collected.careCount, 1);
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 1);
      await page.reload(); await page.locator('.content-home').waitFor(); await wait(1100);
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 1);
      // A new private session checks explicit discard instead of collection.
      await api('action', { kind: 'play-treasure' }); await page.reload(); await page.locator('.treasure-pause-hint').waitFor();
      const discardedId = (await api('state')).state.game.id;
      await choose(page, 2); await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'b');
      await page.locator('.content-home').waitFor(); const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, collected.economy.coins); assert.equal(after.careCount, 1);
      const cancels = writes.filter(w => w.kind === 'cancel-play'); assert.equal(cancels.length, 1); assert.equal(cancels[0].gameId, discardedId);
      assert.deepEqual(errors, []); journeys.push({ mode: mode.name, opened: n.opened, found, coins: collected.economy.coins, writes });
    } catch (error) { await page.screenshot({ path: join(dir, `${mode.name}-failure.png`), fullPage: true }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ layouts, journeys }, null, 2));
  console.log(JSON.stringify({ passed: layouts.length, journeys: journeys.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited; }
}
