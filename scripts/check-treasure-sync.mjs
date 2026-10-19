// Owned temporary SQLite + real HTTP + two real Chrome pages.
// Headless Chrome keeps both pages visible: this checks ordinary 15s polling,
// not real OS background/foreground transitions. Hidden map is read for routes.
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
assert.notEqual(resolve(binary), join(root, 'bin/pixelpet'));
assert.notEqual(resolve(web), join(root, 'web/dist'));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-sync-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function seed() {
  const now = Date.now();
  return (await api('import', { schema: 1, revision: 1, species: 2, name: '同步伙伴',
    createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] })).state;
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function start(page, repeat = false) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(6).fill('A'), 'B']) await key(page, k);
  await page.locator('.game-guide').waitFor();
  assert.equal(await page.locator('.game-quick-start').count(), repeat ? 1 : 0);
  await key(page, 'B');
  await page.locator('.treasure-pause').waitFor();
}
async function discard(page) {
  for (const k of ['A', 'A', 'B']) await key(page, k);
  await page.locator('.game-abandon').waitFor();
}
async function dig(page, tile) {
  for (let i = 0; i < 9; i++) {
    if ((await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label')).startsWith(`${tile + 1}号格`)) {
      await key(page, 'B'); return;
    }
    await key(page, 'A');
  }
  assert.fail(`Could not select tile ${tile}`);
}
async function controls(page) {
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
}
async function currentRead(page) {
  const response = await page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit' && r.request().method() === 'POST', { timeout: 22000 });
  assert(response.ok()); await response.finished();
  return response.json();
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
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const scenario of ['three-found', 'six-empty', 'stale-discard']) {
      await seed();
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = font + 'px';
      }), font);
      const actor = await context.newPage(), observer = await context.newPage(), writes = [], requests = [], errors = [];
      for (const [name, page] of [['actor', actor], ['observer', observer]]) {
        page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
        page.on('request', r => requests.push({ page: name, path: new URL(r.url()).pathname, method: r.method(), at: Date.now() }));
        page.on('request', r => { if (r.method() === 'POST') writes.push({ page: name, path: new URL(r.url()).pathname,
          body: r.postDataJSON(), cancelIf: r.headers()['x-pixelpet-cancel-if'] }); });
      }
      let release, heldDone;
      try {
        await observer.goto(base); await observer.locator('.home-caption').waitFor();
        for (const k of ['A', ...Array(6).fill('A'), 'B', 'A']) await key(observer, k);
        await observer.locator('.content-growth').waitFor();
        await actor.goto(base); await start(actor);
        const session = (await api('state')).state.game;
        const read = await currentRead(observer);
        assert.equal(read.state.game.id, session.id);
        await observer.locator('.treasure-pause').waitFor();
        await controls(observer); assert.equal(writes.filter(w => w.page === 'observer' && w.path === '/api/action').length, 0);
        await wait(1100); assert.equal((await api('state')).state.game.treasure.opened.length, 0, 'Sync auto-explored');
        await discard(observer);
        if (scenario === 'stale-discard') {
          // Hold one real ordinary read BEFORE it reaches the server. After the
          // conflicting write, release it unchanged; no invented HTTP response.
          const held = deferred(), gate = deferred(), done = deferred(); release = gate.resolve;
          let first = true;
          await observer.route('**/api/visit', async route => {
            if (!first) return route.continue();
            first = false; heldDone = done.promise; held.resolve(); await gate.promise;
            try { await route.continue(); } finally { done.resolve(); }
          });
          await Promise.race([held.promise, wait(22000).then(() => assert.fail('No ordinary read to delay'))]);
        }
        await key(actor, 'C');
        const tiles = session.treasure.layout.flatMap((item, i) => (scenario === 'six-empty' ? item === 0 : item > 0) ? [i] : []);
        if (scenario !== 'stale-discard') {
          await dig(actor, tiles.shift());
          const progress = await currentRead(observer);
          assert.equal(progress.state.game.treasure.opened.length, 1);
          await observer.locator('.game-abandon').waitFor(); // Nonterminal progress keeps the deliberate choice.
        }
        for (const tile of tiles) await dig(actor, tile);
        await actor.locator('.treasure-game[data-done=true]').waitFor();
        let saved = (await api('state')).state;
        assert.equal(saved.game.id, session.id); assert.equal(saved.careCount, 0); assert.equal(saved.economy.coins, 0);
        const step = saved.game.treasure.step;
        if (scenario === 'stale-discard') {
          const rejected = observer.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'cancel-play');
          await key(observer, 'B'); const response = await rejected;
          assert.equal(response.status(), 409); assert.equal((await response.json()).code, 'game_finished');
          assert.equal(writes.find(w => w.page === 'observer' && w.body?.kind === 'cancel-play').cancelIf, 'unfinished');
          const recovery = observer.locator('.save-recovery');
          await recovery.waitFor(); assert((await recovery.textContent()).includes('本次放弃未执行'));
          assert(!(await recovery.textContent()).includes('可能已经保存'));
          const delayed = observer.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
          release(); await heldDone;
          const late = await delayed; assert(late.ok()); await late.finished();
          assert.equal((await late.json()).state.game.treasure.step, step);
          await observer.unroute('**/api/visit'); await wait(400);
          // The old read belongs to the pre-write epoch, so cannot dismiss the refusal.
          assert(await recovery.isVisible());
          assert(await observer.locator('.button-a').isDisabled());
          assert(await observer.locator('.button-c').isDisabled());
          // Do not tap disabled controls: Playwright waits until a later recovery
          // enables them and would then intentionally collect a NEW terminal UI.
          await observer.keyboard.press('a'); await observer.keyboard.press('c');
          assert(await recovery.isVisible());
          const reconcile = observer.waitForResponse(r => new URL(r.url()).pathname === '/api/state' && r.request().method() === 'GET');
          await observer.keyboard.press('b'); assert((await reconcile).ok());
          await observer.locator('.treasure-game[data-done=true]').waitFor();
          assert.equal(await recovery.count(), 0);
        } else {
          const terminal = await currentRead(observer); assert.equal(terminal.state.game.treasure.step, step);
          await observer.locator('.treasure-game[data-done=true]').waitFor();
        }
        assert.equal(await observer.locator('.game-abandon').count(), 0);
        assert.equal((await api('state')).state.careCount, 0, 'Sync auto-settled');
        await key(observer, 'A'); assert.equal((await api('state')).state.careCount, 0);
        await controls(observer); await observer.locator('.treasure-status').scrollIntoViewIfNeeded();
        await observer.screenshot({ path: join(dir, `${width}-${scenario}-terminal.png`) });
        const settled = observer.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'treasure-finish');
        await key(observer, 'B'); assert((await settled).ok());
        saved = (await api('state')).state;
        assert(!saved.game); assert.equal(saved.careCount, 1);
        assert.equal(saved.economy.coins, scenario === 'six-empty' ? 3 : 6);
        assert.equal(saved.album.entries.filter(m => m.kind === 'treasure').length, 1);
        const removed = await currentRead(actor); assert(!removed.state.game);
        await actor.locator('.home-caption').waitFor(); assert.equal(await actor.locator('.care-outcome').count(), 0);
        assert.equal(writes.filter(w => w.body?.kind === 'treasure-finish').length, 1);
        assert.equal(writes.filter(w => w.body?.kind === 'cancel-play').length, scenario === 'stale-discard' ? 1 : 0);
        // A new ID resets the observer's old discard/pause selection, not just the board.
        await key(observer, 'C'); // Skip the local settlement clip, if still present.
        await start(actor, true); const replacement = (await api('state')).state.game;
        assert.notEqual(replacement.id, session.id); await currentRead(observer);
        await observer.locator('.treasure-pause').waitFor();
        assert.equal(await observer.locator('.game-abandon').count(), 0);
        const resumed = observer.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'treasure-resume');
        await key(observer, 'B'); assert((await resumed).ok());
        saved = (await api('state')).state;
        assert.equal(saved.game.id, replacement.id); assert.equal(saved.game.treasure.opened.length, 0);
        assert.equal(saved.careCount, 1); assert.equal(saved.economy.coins, scenario === 'six-empty' ? 3 : 6);
        assert.equal(writes.filter(w => w.body?.kind === 'treasure-finish').length, 1);
        assert(writes.every(w => ['/api/action', '/api/visit'].includes(w.path)), 'UI imported/reset a save');
        assert.deepEqual(errors, []);
        console.log(`Passed ${width}px/${font}px ${scenario}`);
        results.push({ width, font, scenario, oldStep: step, coins: saved.economy.coins,
          ordinaryReads: writes.filter(w => w.path === '/api/visit').length, actions: writes.filter(w => w.path === '/api/action') });
      } catch (e) {
        for (const [name, page] of [['actor', actor], ['observer', observer]]) await page.screenshot({ path: join(dir, `failure-${name}.png`), fullPage: true });
        await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, font, scenario, writes, requests, errors, state: await api('state') }, null, 2));
        console.error('Artifacts:', dir); throw e;
      } finally {
        if (release) release();
        if (heldDone) await heldDone;
        await context.close();
      }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
