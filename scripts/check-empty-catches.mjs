// Own disposable DB/port/isolated builds only. Legal empty fishing sessions are
// explicit persisted fixtures, not claims about naturally generated new games.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute isolated PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute isolated PIXELPET_TEST_WEB');
const shared = path => realpath(path).catch(e => { if (e.code === 'ENOENT') return resolve(path); throw e; });
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Do not use shared binary');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Do not use shared web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-empty-catches-')), dbPath = join(dir, 'test.db'), results = [];
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
async function actionKey(page, k, kind) {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON().kind === kind);
  await key(page, k); const r = await pending; assert(r.ok(), await r.text());
  return { result: await r.json(), body: r.request().postDataJSON(), headers: await r.request().allHeaders() };
}
async function paused(page) {
  await page.locator('.fishing-pause').waitFor({ timeout: 6000 });
  assert.match(await page.locator('.fishing-game header').innerText(), /0 鱼/);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
try {
  await start(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const viewport of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const phase of ['ready', 'wait', 'bite', 'result', 'done']) {
      for (const representation of ['nil', 'omitted', 'array']) {
        const label = `${viewport.width}-${phase}-${representation}`;
        await api('reset', { confirm: true }); await api('action', { kind: 'hatch', species: 2 });
        const seed = (await api('action', { kind: 'play-fishing' })).state;
        await stop(); const now = Date.now(); seed.lastTick = now;
        Object.assign(seed.game.fishing, { phase, paused: true, lastPulseAt: now,
          casts: phase === 'ready' ? 0 : phase === 'done' ? 3 : 1,
          step: phase === 'ready' ? 0 : phase === 'done' ? 6 : phase === 'result' ? 2 : 1,
          waitMs: phase === 'ready' ? 0 : 32000, elapsedMs: 0, candidate: phase === 'ready' ? '' : 'reed-minnow' });
        if (phase === 'result' || phase === 'done') seed.game.fishing.outcome = 'early';
        if (representation === 'omitted') delete seed.game.fishing.catches;
        else seed.game.fishing.catches = representation === 'nil' ? null : [];
        const db = new DatabaseSync(dbPath);
        try { db.prepare('UPDATE saves SET body=? WHERE id=1').run(JSON.stringify(seed)); } finally { db.close(); }
        await start();
        const context = await browser.newContext({ viewport: { width: viewport.width, height: 700 }, hasTouch: true,
          isMobile: viewport.width === 320, reducedMotion: 'reduce', forcedColors: viewport.width === 320 ? 'active' : 'none' });
        const page = currentPage = await context.newPage(), errors = [], writes = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON().kind); });
        await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), viewport.font);
        try {
          await page.goto(base); await page.locator('.fishing-game').waitFor({ timeout: 6000 });
          const before = (await api('state')).state;
          assert.deepEqual(before.game.fishing.catches, representation === 'array' ? [] : null);
          assert.equal(before.careCount, 0); assert.equal(before.economy.coins, 0); assert.equal(before.pond.fish.length, 0);
          if (phase !== 'done') {
            await paused(page); await wait(1100);
            // Pure pause/album navigation and refresh must not run a pulse,
            // invent a catch, or normalize/mutate the legal null slice.
            await key(page, 'A'); await key(page, 'B'); await page.locator('.fish-album').waitFor();
            assert.match(await page.locator('.fish-album').innerText(), /已发现 0 \/ 7/);
            await key(page, 'C'); await paused(page); await page.reload(); await paused(page);
          } else {
            assert.match(await page.locator('.fishing-status').innerText(), /三竿完成 · 发现 0 条鱼/);
            assert.match(await page.locator('.fishing-rule').innerText(), /至少钓到一条/);
            await page.reload(); await page.locator('.fishing-game').waitFor();
          }
          assert.deepEqual((await api('state')).state.game, before.game); assert.deepEqual(writes, []);
          if (representation !== 'array' && (phase === 'bite' || phase === 'done')) await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
          if (phase === 'done') {
            await actionKey(page, 'B', 'fish-finish'); await page.locator('.home-caption').waitFor();
            assert.deepEqual(writes, ['fish-finish']);
          } else {
            await actionKey(page, 'C', 'fish-resume');
            if (phase === 'ready' || phase === 'result') {
              await actionKey(page, 'A', 'fish-spot'); await actionKey(page, 'B', 'fish-cast');
            }
            const reel = await actionKey(page, 'B', 'fish-reel');
            const caught = phase === 'bite';
            assert.equal(reel.result.state.game.fishing.catches?.length ?? 0, caught ? 1 : 0);
            assert.equal(reel.result.state.pond.fish.length, caught ? 1 : 0);
            assert.equal(reel.result.state.careCount, 0); assert.equal(reel.result.state.economy.coins, 0);
            const retry = await api('action', reel.body, { 'X-PixelPet-Generation': reel.headers['x-pixelpet-generation'] });
            assert.deepEqual(retry.state, reel.result.state);
            if (caught) {
              assert.equal(reel.result.state.pond.fish[0].count, 1);
              assert.match(await page.locator('.fishing-status').innerText(), /初次发现/);
              // A real catch enables exactly the original three-coin finish;
              // the remaining two early reels must not add discoveries.
              for (let i = 0; i < 2; i++) { await actionKey(page, 'B', 'fish-cast'); await actionKey(page, 'B', 'fish-reel'); }
              await actionKey(page, 'B', 'fish-finish'); await page.locator('.home-caption').waitFor();
              assert.deepEqual(writes, ['fish-resume', 'fish-reel', 'fish-cast', 'fish-reel', 'fish-cast', 'fish-reel', 'fish-finish']);
            } else {
              assert.match(await page.locator('.fishing-status').innerText(), /提前提竿，这一竿已用掉/);
              await actionKey(page, 'C', 'fish-pause'); await paused(page); await page.reload(); await paused(page);
              const expected = ['fish-resume', ...(['ready', 'result'].includes(phase) ? ['fish-spot', 'fish-cast'] : []), 'fish-reel', 'fish-pause'];
              assert.deepEqual(writes, expected);
              const persisted = (await api('state')).state;
              assert.equal(persisted.game.fishing.catches?.length ?? 0, 0);
              assert.equal(persisted.game.fishing.paused, true);
            }
          }
          const after = (await api('state')).state;
          assert.equal(after.careCount, phase === 'bite' ? 1 : 0); assert.equal(after.economy.coins, phase === 'bite' ? 3 : 0);
          assert.equal(after.pond.fish.length, phase === 'bite' ? 1 : 0);
          assert.deepEqual(errors, []); results.push({ ...viewport, phase, representation, writes });
        } catch (e) {
          await page.screenshot({ path: join(dir, `failure-${label}.png`), fullPage: true });
          await writeFile(join(dir, `failure-${label}.json`), JSON.stringify({ errors, writes, state: await api('state'), text: await page.locator('body').innerText() }, null, 2));
          throw e;
        } finally { await context.close(); currentPage = null; }
      }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir }));
} catch (e) { console.error('Artifacts:', dir); throw e; }
finally { if (browser) await browser.close(); await stop(); await writeFile(join(dir, 'server.log'), log); }
