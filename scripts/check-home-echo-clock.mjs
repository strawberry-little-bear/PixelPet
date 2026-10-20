// Real Chrome, real 12-second timers and real settlements in an owned temporary server.
// Browser Date.now changes only: never OS/server time, performance.now or timers.
// Constructed three-stage fixtures, not natural multi-day play.
// Route choice reads the server's hidden map; this is not blind human play.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const sharedPath = path => realpath(path).catch(error => { if (error.code === 'ENOENT') return resolve(path); throw error; });
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')), 'Do not run the shared binary');
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-home-echo-clock-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function seed(stage) {
  const now = Date.now(), age = (stage === 'adult' ? 80 : stage === 'growing' ? 25 : 1) * 3600000;
  const { state } = await api('import', { schema: 1, revision: 1, species: 2, name: '成长回执伙伴',
    createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 70, clean: 50, energy: 80 }, careCount: 0, logs: [] });
  assert.equal(state.growth.stage, stage);
  return state;
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function play(page) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(6).fill('A'), 'B']) await key(page, k);
  await page.locator('.game-guide').waitFor(); await key(page, 'B');
  await page.locator('.treasure-pause').waitFor(); await key(page, 'C');
  const game = (await api('state')).state.game;
  for (const tile of game.treasure.layout.flatMap((item, i) => item > 0 ? [i] : [])) {
    let selected = false;
    for (let i = 0; i < 9; i++) {
      if ((await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label')).startsWith(`${tile + 1}号格`)) {
        await key(page, 'B'); selected = true; break;
      }
      await key(page, 'A');
    }
    assert(selected, `Could not select ${tile}`);
  }
  await page.locator('.treasure-game[data-done=true]').waitFor();
  assert.equal(await page.locator('.care-outcome').count(), 0, 'Unsettled game invented a receipt');
  const finish = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' &&
    r.request().postDataJSON()?.kind === 'treasure-finish');
  // Do not wait for B to re-enable: the celebration disables it for 1.5s.
  await page.locator('.button-b').tap(); const response = await finish;
  assert(response.ok());
  await page.locator('.pet-scene[data-motion="celebrating"]').waitFor();
  return response.json();
}
async function changeDate(page, days) {
  await page.evaluate(days => { window.__echoDateOffset = days * 86400000; }, days);
}
async function hasEcho(page) {
  return page.locator('[data-echo="treasure"] .home-game-token').count();
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
  for (const width of [1200, 320]) for (const stage of ['baby', 'growing', 'adult']) {
    for (const duringCelebration of [false, true]) {
      await seed(stage);
      const font = width === 320 ? 28 : 14;
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST') writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
      await page.addInitScript(font => {
        const originalNow = Date.now.bind(Date);
        window.__echoDateOffset = 0;
        Date.now = () => originalNow() + window.__echoDateOffset;
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; });
      }, font);
      try {
        await page.goto(base); const reply = await play(page);
        const acceptedAt = await page.evaluate(() => performance.now());
        const recent = reply.state.companion.recent;
        assert.equal(recent.kind, 'treasure'); assert.equal(reply.state.careCount, 1);
        if (duringCelebration) {
          assert.equal(await page.locator('.pet-scene[data-motion="celebrating"]').count(), 1);
          await changeDate(page, 7);
        }
        await page.waitForFunction(() => document.querySelector('.pet-scene')?.dataset.motion !== 'celebrating');
        // Wait one actual display interval as a Date.now jump is not itself a React render.
        await wait(1100);
        assert.equal(await hasEcho(page), 1, 'Date jump during celebration hid the real home echo');
        for (const days of duringCelebration ? [-7, 0] : [7, -7, 0]) {
          await changeDate(page, days); await wait(1100);
          assert.equal(await hasEcho(page), 1, `Date jump ${days} days hid the real home echo`);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
        await page.locator('[data-echo="treasure"]').scrollIntoViewIfNeeded();
        if (!duringCelebration) await page.screenshot({ path: join(dir, `${width}-${stage}.png`) });
        // An unchanged performance timeline must still be before the original deadline.
        const beforeDeadline = acceptedAt + 11300;
        const remaining = await page.evaluate(deadline => deadline - performance.now(), beforeDeadline);
        assert(remaining > 0, 'Test setup exceeded the pre-expiry checkpoint');
        await wait(remaining);
        assert.equal(await hasEcho(page), 1, 'Echo expired early');
        await page.waitForFunction(() => !document.querySelector('.home-game-token'), null, { timeout: 3000 });
        const expiredAfter = await page.evaluate(start => performance.now() - start, acceptedAt);
        assert(expiredAfter >= 11500 && expiredAfter <= 12800, `Unexpected expiration ${expiredAfter}ms`);
        for (const days of [-7, 7, 0]) {
          await changeDate(page, days); await wait(350);
          assert.equal(await hasEcho(page), 0, 'Changing the date replayed an expired echo');
        }
        const after = (await api('state')).state;
        assert.deepEqual(after.companion.recent, recent, 'Visual clock change rewrote saved history');
        assert.equal(after.careCount, 1);
        assert.equal(writes.filter(w => w.path === '/api/action' && w.body.kind === 'treasure-finish').length, 1);
        assert(writes.every(w => w.path === '/api/visit' || (w.path === '/api/action' &&
          ['play-treasure', 'treasure-resume', 'treasure-dig', 'treasure-finish'].includes(w.body.kind))), 'Unexpected UI mutation');
        const actionsBeforeReload = writes.filter(w => w.path === '/api/action').length;
        await page.reload(); await page.locator('.home-caption').waitFor(); await wait(1100);
        assert.equal(await hasEcho(page), 0, 'Refresh replayed saved history');
        assert.equal(writes.filter(w => w.path === '/api/action').length, actionsBeforeReload);
        assert.deepEqual(errors, []);
        results.push({ width, font, stage, duringCelebration, expiredAfter });
      } catch (e) {
        await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
        await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, stage, duringCelebration, writes, errors }, null, 2));
        console.error('Artifacts:', dir); throw e;
      } finally { await context.close(); }
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
