// Real three-key pause-guide journeys + visible-viewport and layout fixtures.
// Only an isolated binary/build and a disposable DB; never uses player data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-pause-guide-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(error => error ? reject(error) : resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = kind => kind === 'tetris' ? '.tetris-overlay' : kind === 'fishing' ? '.fishing-pause' : '.walk-pause';
const field = kind => kind === 'walk' ? 'walking' : kind;
const prefix = kind => kind === 'fishing' ? 'fish' : kind;
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function visibleAnchor(page, selector) {
  const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside visible viewport: ${JSON.stringify(box)}`);
}
async function open(page) {
  for (const k of ['A', 'A', 'A', 'A', 'B']) await key(page, k);
  await page.locator('.game-guide').waitFor();
  assert.match(await page.locator('.game-guide').innerText(), /本局玩法[\s\S]*1 \/ 2/);
  assert.match(await page.locator('.lcd-bottom').innerText(), /A \/ B 翻页.*C 返回暂停/);
  await visibleAnchor(page, '.game-guide > header');
}
async function readable(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page horizontal overflow');
  const errors = await page.locator(selector).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('clipped: ' + text.textContent);
        }
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], 'text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0, 'LCD gameplay controls');
  assert.equal(await page.locator('.physical-button').count(), 3);
  for (const button of await page.locator('.physical-button').all()) {
    const box = await button.boundingBox(); assert(box.width >= 44 && box.height >= 44, 'small key');
  }
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const fixtures = {}, kinds = ['tetris', 'fishing', 'walk'];
  for (const kind of kinds) for (const localOnly of [false, true]) {
    const at = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '暂停翻规则', createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    let state = await api('action', { kind: `play-${kind}` });
    const action = async actionKind => {
      const game = (await api('state')).state.game;
      return api('action', { kind: actionKind, gameId: game.id, step: game[field(kind)].step });
    };
    if (kind === 'fishing') {
      await action('fish-cast');
      if (!localOnly) state = await action('fish-pause');
    } else if (localOnly) state = await action(`${prefix(kind)}-resume`);
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST' && !['/api/state', '/api/visit'].includes(new URL(request.url()).pathname)) writes.push(request.postDataJSON());
    });
    try {
      await page.goto(base); await page.locator(pause(kind)).waitFor();
      const before = await api('state');
      assert.equal(before.state.game[field(kind)].paused, !localOnly);
      if (!localOnly) fixtures[kind] = structuredClone(before);
      await readable(page, pause(kind));
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      await open(page); await readable(page, '.game-guide');
      assert.equal(await page.locator('.game-guide').getAttribute('data-guide'), kind);
      await key(page, 'B'); assert.match(await page.locator('.game-guide').innerText(), /2 \/ 2/); await readable(page, '.game-guide');
      await key(page, 'A'); assert.match(await page.locator('.game-guide').innerText(), /1 \/ 2/);
      await key(page, 'A'); assert.match(await page.locator('.game-guide').innerText(), /2 \/ 2/);
      await visibleAnchor(page, '.game-guide > header');
      await wait(localOnly ? 3800 : 1300); await key(page, 'C'); await page.locator(pause(kind)).waitFor();
      await visibleAnchor(page, `${pause(kind)} > strong`);
      // Returning retains menu selection; B reopens first page, not a new game.
      await key(page, 'B'); await page.locator('.game-guide').waitFor();
      assert.match(await page.locator('.game-guide').innerText(), /1 \/ 2/);
      await page.reload(); await page.locator(pause(kind)).waitFor(); await wait(1300);
      assert.equal(writes.length, 0, 'reader or reload wrote a game action');
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference, 'reader changed tutorial preferences');
      const after = await api('state'), expected = structuredClone(before.state.game);
      // Existing server inactivity expiry may persist exactly one pause/step.
      // It is not a reader action and must never advance the board/catch/walk.
      if (localOnly) { expected[field(kind)].paused = true; expected[field(kind)].step++; }
      assert.deepEqual(after.state.game, expected, 'reader advanced or replaced session');
      for (const key of ['economy', 'careCount', 'album', 'pond', 'park']) assert.deepEqual(after.state[key], before.state[key]);
      await open(page); await key(page, 'C'); await page.locator(pause(kind)).waitFor();
      assert.equal(writes.length, 0);
      // Only deliberate C on the pause screen grants run permission.
      await key(page, 'C');
      assert.equal(writes[0]?.kind, `${prefix(kind)}-resume`);
      assert.equal(writes[0]?.gameId, before.state.game.id);
      assert.equal(writes[0]?.step, after.state.game[field(kind)].step);
      assert.deepEqual(errors, []);
      results.push({ type: 'real-read-wrap-return-reload-explicit-resume', kind, localOnly });
    } catch (error) {
      await page.screenshot({ path: join(dir, `failure-real-${kind}-${localOnly}.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  // Response fixtures isolate layout; these are not natural long-play results.
  for (const kind of kinds) for (const width of [1200, 320]) for (const scale of [1, 2]) for (const height of [700, 380]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width === 320, hasTouch: true, reducedMotion: 'reduce', forcedColors: scale === 2 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [];
    let reads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(scale => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `.reading-mode .lcd-content{font-size:${12 * scale}px!important}.reading-mode .lcd-content :is(p,small,strong,b,span,li,time,header,h3){font-size:${12 * scale}px!important;line-height:1.6!important}.lcd-bottom{font-size:${9 * scale}px!important}`;
      document.head.append(style);
    }), scale);
    const fixture = structuredClone(fixtures[kind]);
    await page.route('**/api/**', async route => {
      assert(['/api/state', '/api/visit'].includes(new URL(route.request().url()).pathname), 'read-only layout fixture attempted write');
      reads++; fixture.serverTime = Date.now();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    try {
      await page.goto(base); await page.locator(pause(kind)).waitFor(); await readable(page, pause(kind));
      assert.match(await page.locator(pause(kind)).innerText(), /玩法说明/);
      await page.screenshot({ path: join(dir, `pause-${kind}-${width}-${height}-${scale}.png`), fullPage: true });
      await open(page);
      for (let n = 1; n <= 2; n++) {
        await readable(page, '.game-guide');
        assert.equal(await page.locator('.game-guide > strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 12 * scale);
        assert.match(await page.locator('.game-guide').innerText(), /只读本局规则/);
        await wait(150); // Observe the settled native viewport, not a capture-time resize.
        await visibleAnchor(page, '.game-guide > header');
        await page.screenshot({ path: join(dir, `visible-guide-${kind}-${width}-${height}-${scale}-${n}.png`) });
        await visibleAnchor(page, ".game-guide > header");
        // Manual reading position must survive a same-session authoritative read.
        await page.evaluate(() => window.scrollBy({ top: 90, behavior: 'instant' }));
        const position = await page.evaluate(() => scrollY), beforeReads = reads;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        for (let i = 0; reads === beforeReads && i < 100; i++) await wait(20);
        assert(reads > beforeReads, 'same-session read not exercised');
        await wait(100); assert.equal(await page.evaluate(() => scrollY), position, 'heartbeat jumped the reader');
        // Chrome full-page capture can alter scrollY while restoring a mobile
        // viewport (observed +41px). Keep that diagnostic capture AFTER the
        // native viewport/poll assertions and BEFORE the next explicit key.
        await page.screenshot({ path: join(dir, `guide-${kind}-${width}-${height}-${scale}-${n}.png`), fullPage: true });
        await key(page, 'B'); await visibleAnchor(page, '.game-guide > header');
      }
      // Native activation remains on B despite viewport movement (no focus steal).
      assert(await page.locator('.button-b').evaluate(el => el === document.activeElement));
      await page.keyboard.press('Enter'); assert.match(await page.locator('.game-guide').innerText(), /2 \/ 2/);
      await visibleAnchor(page, '.game-guide > header');
      await page.keyboard.press('Space'); assert.match(await page.locator('.game-guide').innerText(), /1 \/ 2/);
      await visibleAnchor(page, '.game-guide > header');
      assert(await page.locator('.button-b').evaluate(el => el === document.activeElement));
      await key(page, 'C'); await page.locator(pause(kind)).waitFor(); await readable(page, pause(kind));
      await visibleAnchor(page, `${pause(kind)} > strong`);
      await page.screenshot({ path: join(dir, `visible-return-${kind}-${width}-${height}-${scale}.png`) });
      assert.deepEqual(errors, []); results.push({ type: 'read-only-visible-viewport-layout-fixture', kind, width, height, scale });
    } catch (error) {
      await page.screenshot({ path: join(dir, `failure-layout-${kind}-${width}-${height}-${scale}.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
