// Selected pause operations explain their consequences before a real A/B/C action.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-tetris-operation-'));
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const hints = ['B / C 继续下落', '旋转一次后继续下落', '放到底并固定', '再次确认前不会丢掉本局', '返回后仍暂停'];
const results = [], journeys = [];
let server, browser, startupError, log = '';
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  await page.locator(`.button-${letter.toLowerCase()}:not(:disabled)`).waitFor();
  await page.keyboard.press(letter);
}
async function inspect(page, mode, choice) {
  const note = page.locator('.tetris-operation-hint'); await note.waitFor();
  assert.match(await note.textContent(), new RegExp(hints[choice]));
  assert.equal(await note.getAttribute('aria-live'), 'polite');
  const layout = await page.locator('.tetris-game').evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) clipped.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 2 || box.bottom > rect.bottom + 2)) clipped.push(node.textContent);
        }
      }
    }
    return { clipped, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(el.querySelector('.tetris-operation-hint')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow);
  assert(layout.font >= layout.rootFont * .85, 'operation hint ignores enlarged text');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const box of await page.locator('.physical-button').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect(); return { width: r.width, height: r.height };
  }))) assert(box.width >= 44 && box.height >= 44);
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${mode.name}-choice-${choice}.png`), fullPage: true });
  results.push({ mode: mode.name, choice, text: await note.textContent(), layout });
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
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28, contrast: true }]) {
    const now = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '积木伙伴', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-tetris', requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.tetris-operation-hint').waitFor();
      const before = (await api('state')).state;
      for (let choice = 0; choice < 5; choice++) { await inspect(page, mode, choice); if (choice < 4) await key(page, 'a'); }
      await wait(1200); assert.deepEqual(writes, []);
      assert.deepEqual((await api('state')).state.game, before.game);
      // Looking at both rule pages does not resume, write or award anything.
      await key(page, 'b'); await page.locator('.game-guide').waitFor(); await key(page, 'b');
      assert.match(await page.locator('.game-guide').textContent(), /2 \/ 2/);
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      assert.match(await page.locator('.tetris-operation-hint').textContent(), /返回后仍暂停/);
      assert.deepEqual(writes, []); assert.deepEqual((await api('state')).state.game, before.game);
      // Rotate really resumes; immediately pause again before the first gravity tick.
      await key(page, 'a'); await key(page, 'a'); await key(page, 'b');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      const rotated = (await api('state')).state.game.tetris;
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause']);
      assert(rotated.paused); assert.equal(rotated.active.rotation, (before.game.tetris.active.rotation + 1) % 4);
      assert.deepEqual(rotated.board, before.game.tetris.board); assert.equal(rotated.pieces, 0);
      // Drop really locks one piece and resumes, without awarding care or coins.
      await key(page, 'a'); await key(page, 'a'); await key(page, 'b');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      const dropped = (await api('state')).state;
      assert.equal(dropped.game.tetris.pieces, 1); assert.equal(dropped.game.tetris.board.filter(Boolean).length, 4);
      assert(dropped.game.tetris.paused); assert.equal(dropped.economy.coins, 0); assert.equal(dropped.careCount, 0);
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause', 'tetris-drop', 'tetris-pause']);
      // Cancel discard, refresh and C from the drop selection retain existing mappings.
      for (let i = 0; i < 3; i++) await key(page, 'a');
      await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'c');
      await page.locator('.tetris-operation-hint').waitFor(); assert.equal(writes.length, 4);
      await page.reload(); await page.locator('.tetris-operation-hint').waitFor(); await wait(1200);
      assert.deepEqual((await api('state')).state.game, dropped.game); assert.equal(writes.length, 4);
      await key(page, 'a'); await key(page, 'a'); await key(page, 'c');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      for (let i = 0; i < 3; i++) await key(page, 'a');
      await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'b');
      await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause', 'tetris-drop', 'tetris-pause', 'tetris-resume', 'tetris-pause', 'cancel-play']);
      assert.deepEqual(errors, []); journeys.push({ mode: mode.name, writes, coins: after.economy.coins, careCount: after.careCount });
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, journeys }, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited;
  }
}
