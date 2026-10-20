// Real HTTP sessions; corruption is injected into replies only, never saves.
// Own disposable database, random port and isolated builds; never player 18102.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute isolated PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute isolated PIXELPET_TEST_WEB');
const shared = path => realpath(path).catch(e => { if (e.code === 'ENOENT') return resolve(path); throw e; });
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Do not use shared binary');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Do not use shared web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-response-')), dbPath = join(dir, 'test.db'), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, currentPage, log = '';
async function api(path, body, headers = {}) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
async function start() {
  let startupError;
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: dbPath, PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Server did not start: ' + log);
}
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
const games = [
  { id: 'stars', action: 'play', selector: '.star-game' },
  { id: 'tiles', action: 'play-tiles', selector: '.tile-game' },
  { id: 'snake', action: 'play-snake', selector: '.snake-game', model: 'snake' },
  { id: 'tetris', action: 'play-tetris', selector: '.tetris-game', model: 'tetris' },
  { id: 'fishing', action: 'play-fishing', selector: '.fishing-game', model: 'fishing' },
  { id: 'walk', action: 'play-walk', selector: '.walking-game', model: 'walking' },
  { id: 'treasure', action: 'play-treasure', selector: '.treasure-game', model: 'treasure' },
];
function damage(reply, id) {
  const g = reply.state.game;
  if (id === 'stars') g.score = {};
  if (id === 'tiles') g.tiles.board = null;
  if (id === 'snake') g.snake.body = null;
  if (id === 'tetris') g.tetris.next = 99;
  if (id === 'walk') g.walking.route = null;
  return reply;
}
async function threeKeys(page) {
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
async function shown(page, game) {
  await page.locator(game.selector).waitFor({ timeout: 6000 }); await threeKeys(page);
  if (game.model && game.id !== 'fishing') {
    // Newly loaded/resolved games must not run a background timer.
    const model = (await api('state')).state.game[game.model]; assert.equal(model.paused, true);
  }
}
try {
  await start(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const viewport of [{ width: 1200, font: 14, height: 900 }, { width: 320, font: 28, height: 740 }]) {
    for (const game of games) {
      const modes = process.env.PIXELPET_GAME_RESPONSE_RED ? (game.id === 'tiles' ? ['visit'] : []) :
        ['stars', 'tiles', 'snake', 'tetris', 'walk'].includes(game.id) ? ['legal', 'visit', 'poll', 'action'] : ['legal'];
      for (const mode of modes) {
        const label = `${viewport.width}-${game.id}-${mode}`;
        await api('reset', { confirm: true }); await api('action', { kind: 'hatch', species: 2 });
        if (mode !== 'action') await api('action', { kind: game.action });
        const originalGame = (await api('state')).state.game;
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
          hasTouch: true, reducedMotion: 'reduce', ...(viewport.width === 320 ? { forcedColors: 'active' } : {}) });
        const page = await context.newPage(); currentPage = page; page.setDefaultTimeout(6500);
        if (mode === 'poll') await page.clock.install();
        const errors = [], writes = []; let injected = 0, corrupt = mode === 'visit';
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (r.method() !== 'GET' && !['/api/visit', '/api/state'].includes(new URL(r.url()).pathname)) writes.push(r.postDataJSON()?.kind ?? new URL(r.url()).pathname); });
        await page.addInitScript(font => { document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${font}px`;
        }); }, viewport.font);
        await page.route('**/api/**', async route => {
          const r = route.request(), path = new URL(r.url()).pathname;
          if (mode === 'action' && path === '/api/action') corrupt = true;
          const response = await route.fetch();
          if (corrupt && ['/api/visit', '/api/state', '/api/action'].includes(path) && response.ok()) {
            const json = await response.json();
            if (json.state?.game) { injected++; await route.fulfill({ response, json: damage(json, game.id) }); return; }
          }
          await route.fulfill({ response });
        });
        try {
          await page.goto(base);
          if (mode === 'action') {
            await page.locator('.home-caption').waitFor();
            for (const k of ['A', 'A', 'B']) await key(page, k);
            for (let i = 0; i < games.indexOf(game); i++) await key(page, 'A');
            await key(page, 'B'); await page.locator('.game-guide').waitFor();
            await key(page, 'B');
          } else if (mode === 'poll') {
            await shown(page, game); corrupt = true; await page.clock.runFor(15100);
          }
          if (mode === 'legal') {
            await shown(page, game); await page.reload(); await shown(page, game);
            assert.equal(injected, 0); assert.deepEqual(writes, []);
            assert.deepEqual((await api('state')).state.game, originalGame);
          } else {
            await page.locator('.save-recovery').waitFor({ timeout: 6000 });
            assert(injected > 0); assert.match(await page.locator('[role=alert]').innerText(), mode === 'action' ? /可能已经保存/ : /读取|连/);
            await threeKeys(page);
            if (mode === 'action') await page.screenshot({ path: join(dir, `${label}-recovery.png`), fullPage: true });
            const before = (await api('state')).state;
            assert.equal(before.game.kind ?? 'stars', game.id);
            assert.equal(before.careCount, 0); assert.equal(before.economy.coins, 0);
            const expectedWrites = mode === 'action' ? [game.action] : [];
            assert.deepEqual(writes, expectedWrites);
            await page.keyboard.press('a'); await page.keyboard.press('c'); assert.deepEqual(writes, expectedWrites);
            // A second malformed read cannot unlock a possibly-saved action.
            const count = injected; await key(page, 'B');
            await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
            assert(injected > count); assert.equal(await page.locator('.save-recovery').count(), 1);
            corrupt = false; await key(page, 'B'); await shown(page, game);
            assert.equal(await page.locator('.save-recovery').count(), 0);
            assert.deepEqual(writes, expectedWrites); assert.deepEqual(errors, []);
            const recovered = (await api('state')).state;
            assert.deepEqual(recovered.game, before.game);
            assert.equal(recovered.careCount, 0); assert.equal(recovered.economy.coins, 0);
            assert.equal(await page.locator('.game-outcome,.growth-feedback.has-feedback').count(), 0);
            if (mode === 'action') await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
            await page.reload(); await shown(page, game); assert.deepEqual(writes, expectedWrites);
          }
          assert.deepEqual(errors, []); results.push({ ...viewport, game: game.id, mode, injected, writes });
        } catch (e) {
          await page.screenshot({ path: join(dir, `failure-${label}.png`), fullPage: true });
          await writeFile(join(dir, `failure-${label}.json`), JSON.stringify({ errors, writes, injected, text: await page.locator('body').innerText() }, null, 2));
          throw e;
        } finally { await context.close(); currentPage = null; }
      }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir }));
} catch (e) { console.error('Artifacts:', dir); throw e; }
finally { if (browser) await browser.close(); await stop(); await writeFile(join(dir, 'server.log'), log); }
