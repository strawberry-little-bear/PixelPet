// Real HTTP + physical A/B/C, own SQLite/port/build only. A rare paused bite is
// explicitly constructed in the temporary DB; this is not an RNG frequency test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web) && resolve(web) !== join(root, 'web/dist'), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rain-fish-')), dbPath = join(dir, 'test.db'), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Server did not start: ' + log);
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function actionKey(page, name, kind) {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON().kind === kind);
  await key(page, name); const r = await pending; assert(r.ok(), await r.text());
  return { result: await r.json(), body: r.request().postDataJSON(), headers: await r.request().allHeaders() };
}
async function readable(page) {
  const failures = await page.locator('.fish-album').evaluate(el => {
    const bounds = document.querySelector('.lcd-content').getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const failures = [], header = el.querySelector('header').getBoundingClientRect(), grid = el.querySelector('.fish-album-grid').getBoundingClientRect();
    for (const child of el.querySelectorAll('header > *')) {
      const r = child.getBoundingClientRect();
      if (r.top < header.top - 1 || r.bottom > header.bottom + 1 || r.bottom > grid.top + 1) failures.push('header overlaps fish grid: ' + child.textContent);
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.top < bounds.top - 1 || box.bottom > Math.min(bounds.bottom, footer.top) + 1 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), b = p.getBoundingClientRect();
          if ((/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < b.top - 1 || box.bottom > b.bottom + 1)) ||
              (/hidden|clip|auto|scroll/.test(css.overflowX) && (box.left < b.left - 1 || box.right > b.right + 1))) failures.push('clipped: ' + node.textContent);
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal overflow');
    return failures;
  });
  assert.deepEqual(failures, [], 'fish album text clipped');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
}
async function album(page, atHome = false) {
  if (atHome) { await key(page, 'A'); for (let i = 0; i < 10; i++) await key(page, 'A'); }
  else await key(page, 'A');
  await key(page, 'B'); await page.locator('.fish-album').waitFor();
  for (let i = 0; i < 7; i++) { await readable(page); if (i < 6) await key(page, i % 2 ? 'A' : 'B'); }
  assert.equal(await page.locator('.fish-album-grid > div').count(), 7);
  assert.equal(await page.locator('.fish-album-grid > div:last-child').getAttribute('aria-current'), 'true');
}
try {
  await start(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const font of [14, 28]) {
    const label = `${width}-${font}`;
    await api('reset', { confirm: true }); await api('action', { kind: 'hatch', species: 2 });
    const seed = (await api('action', { kind: 'play-fishing' })).state;
    // Only the owned temporary DB is edited, while its server is stopped.
    await stop(); const now = Date.now();
    seed.lastTick = now; seed.game.id = '00000200000000000000000000000000';
    Object.assign(seed.game.fishing, { casts: 1, candidate: 'rain-koi', phase: 'bite', paused: true, waitMs: 32000,
      elapsedMs: 0, lastPulseAt: now, step: 1, spot: results.length % 3 });
    const db = new DatabaseSync(dbPath);
    try { db.prepare('UPDATE saves SET body=? WHERE id=1').run(JSON.stringify(seed)); } finally { db.close(); }
    await start();
    const context = await browser.newContext({ viewport: { width, height: 700 }, isMobile: width === 320,
      hasTouch: true, reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
    const page = currentPage = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON().kind); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
    try {
      await page.goto(base); await page.locator('.fishing-pause').waitFor();
      const before = (await api('state')).state;
      await album(page); assert.match(await page.locator('.fish-album').innerText(), /还未遇见的小鱼/);
      assert.doesNotMatch(await page.locator('.fish-album').innerText(), /雨珠小鲤/);
      assert.match(await page.locator('.fish-album').innerText(), /每竿 1\/8/);
      await page.screenshot({ path: join(dir, `hidden-${label}.png`), fullPage: true });
      await key(page, 'B'); assert.equal(await page.locator('.fish-album-grid > div:first-child').getAttribute('aria-current'), 'true');
      await key(page, 'C'); await page.reload(); await page.locator('.fishing-pause').waitFor();
      assert.deepEqual((await api('state')).state.game, before.game); assert.deepEqual(writes, []);
      await actionKey(page, 'C', 'fish-resume'); await page.locator('.fishing-bite').waitFor();
      assert.doesNotMatch(await page.locator('.fishing-game').innerText(), /雨珠小鲤/);
      const reel = await actionKey(page, 'B', 'fish-reel'), caught = reel.result.state;
      assert.equal(caught.game.fishing.lastFish, 'rain-koi'); assert.equal(caught.pond.fish[0].count, 1);
      assert.equal(caught.economy.coins, 0); assert.equal(caught.careCount, 0);
      assert.match(await page.locator('.fishing-status').innerText(), /雨珠小鲤.*初次发现/);
      const replay = await api('action', reel.body, { 'X-PixelPet-Generation': reel.headers['x-pixelpet-generation'] });
      assert.equal(replay.state.revision, caught.revision); assert.deepEqual(replay.state.pond, caught.pond);
      // Real random casts still work; early reels consume a chance but no new fish.
      for (let i = 0; i < 2; i++) { await actionKey(page, 'B', 'fish-cast'); await actionKey(page, 'B', 'fish-reel'); }
      const finished = (await actionKey(page, 'B', 'fish-finish')).result.state;
      assert.equal(finished.economy.coins, 3); assert.equal(finished.careCount, 1); assert.deepEqual(finished.pond, caught.pond);
      await page.locator('.home-caption').waitFor(); await album(page, true);
      assert.match(await page.locator('.fish-album').innerText(), /雨珠小鲤/);
      assert.match(await page.locator('.fish-album').innerText(), /共遇见 1 次/);
      assert.equal(await page.locator('.fish-album-grid text').count(), 6);
      await page.screenshot({ path: join(dir, `discovered-${label}.png`), fullPage: true });
      const backup = await api('backup'), restored = await api('import', backup);
      assert.deepEqual(restored.state.pond, caught.pond); assert.equal(restored.state.economy.coins, 3);
      await page.reload(); await page.locator('.home-caption').waitFor(); await album(page, true);
      assert.match(await page.locator('.fish-album').innerText(), /雨珠小鲤/);
      assert.deepEqual(writes, ['fish-resume', 'fish-reel', 'fish-cast', 'fish-reel', 'fish-cast', 'fish-reel', 'fish-finish']);
      assert.deepEqual(errors, []); results.push({ width, font, spot: seed.game.fishing.spot, constructedRareBite: true, writes });
    } catch (e) {
      await page.screenshot({ path: join(dir, `failure-${label}.png`), fullPage: true });
      await writeFile(join(dir, `failure-${label}.json`), JSON.stringify({ errors, writes, state: await api("state"), text: await page.locator(".device").innerText() }, null, 2));
      throw e;
    } finally { await context.close(); currentPage = null; }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir }));
} catch (e) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
  console.error('Artifacts:', dir); throw e;
} finally {
  if (browser) await browser.close(); await stop(); await writeFile(join(dir, 'server.log'), log);
}
