// Isolated HTTP sessions with either authoritative growth or a missing-growth
// compatibility reply fixture. Skews browser Date.now only, never host time.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeJump = process.argv.includes('--jump-after-load');
assert(process.argv.slice(2).every(arg => arg === '--jump-after-load'), 'Unknown argument');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB');
const shared = path => realpath(path).catch(e => { if (e.code === 'ENOENT') return resolve(path); throw e; });
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Use an isolated binary');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-companion-clock-')), results = [], hour = 3600000;
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, currentPage, log = '', startupError;
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function shown(page, kind, stage) {
  await page.locator(`.${kind}-game`).waitFor();
  assert.equal(await page.locator(`.${kind}-pet [data-rig-stage]`).getAttribute('data-rig-stage'), stage);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
async function key(page, key) {
  await page.locator(`.button-${key}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const kind of ['snake', 'tetris']) for (const profile of [
    { stage: 'baby', age: 1 }, { stage: 'growing', age: 30 }, { stage: 'adult', age: 80 },
  ]) for (const skew of [7 * 24 * hour + 1234, -(7 * 24 * hour + 1234)]) for (const mode of [
    { label: 'desktop', width: 1280, height: 900, font: 14 }, { label: 'phone-large', width: 320, height: 568, font: 28 },
  ]) for (const growthReply of ['missing', 'provided']) {
    const at = Date.now();
    const imported = await api('import', { schema: 1, revision: 1, species: 2, name: '校时伙伴',
      createdAt: at - profile.age * hour - 1000, hatchedAt: at - profile.age * hour, lastTick: at,
      sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    assert.equal(imported.state.growth.stage, profile.stage);
    const started = await api('action', { kind: `play-${kind}`, requestId: crypto.randomUUID() });
    const gameId = started.state.game.id; assert.equal(started.state.game[kind].paused, true);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ skew, font, runtimeJump }) => {
        const nativeNow = Date.now.bind(Date); window.__browserClockSkew = runtimeJump ? 0 : skew;
        Date.now = () => nativeNow() + window.__browserClockSkew;
        const nativeInterval = window.setInterval.bind(window);
        window.__displayIntervals = 0; window.__heldDisplayIntervals = 0;
        window.setInterval = (handler, delay, ...args) => {
          if (delay === 100 || delay === 1000) {
            window.__displayIntervals++;
            if (!runtimeJump) { window.__heldDisplayIntervals++; return nativeInterval(() => {}, delay); }
          }
          return nativeInterval(handler, delay, ...args);
        };
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; });
      }, { skew, font: mode.font, runtimeJump });
      const page = await context.newPage(), writes = [], errors = [], samples = []; currentPage = page;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/visit') writes.push(request.postDataJSON());
      });
      await page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (growthReply === 'missing' && reply.state) delete reply.state.growth;
        if (reply.state) samples.push(reply);
        await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await shown(page, kind, profile.stage);
      if (runtimeJump) {
        await page.evaluate(skew => { window.__browserClockSkew = skew; }, skew);
        await page.waitForTimeout(1100); // Real display ticks, no timer/performance/server clock changes.
        await shown(page, kind, profile.stage);
      }
      const browserNow = await page.evaluate(() => Date.now());
      assert(Math.abs(browserNow - Date.now() - skew) < 2000);
      assert(await page.evaluate(() => window.__displayIntervals > 0));
      assert.equal(await page.evaluate(() => window.__heldDisplayIntervals > 0), !runtimeJump);
      assert.equal(samples.at(-1).state.growth?.stage, growthReply === 'missing' ? undefined : profile.stage);
      // Read-only refresh keeps the same board and paused session, without
      // gameplay writes. Initial mode remains skewed; runtime mode jumps again.
      await page.reload(); await shown(page, kind, profile.stage);
      if (runtimeJump) {
        await page.evaluate(skew => { window.__browserClockSkew = skew; }, skew);
        await page.waitForTimeout(1100); await shown(page, kind, profile.stage);
      }
      const current = (await api('state')).state;
      assert.equal(current.game.id, gameId); assert.equal(current.game[kind].paused, true);
      assert.equal(current.game[kind].step, 0); assert.equal(current.game.score, 0);
      assert.equal(current.growth.stage, profile.stage); // Missing only in compatibility HTTP fixture, not SQLite.
      assert.deepEqual(current.economy, started.state.economy); assert.equal(current.careCount, started.state.careCount);
      assert.deepEqual(writes, []);
      const interactive = growthReply === 'missing' && profile.stage === 'growing' && skew > 0 && mode.label === 'phone-large';
      if (interactive) {
        // One real explicit resume/step/pause per game and mode. No auto-finish.
        await key(page, 'c');
        await page.waitForFunction(({ kind }) => {
          const field = document.querySelector(`.${kind}-overlay`); return !field;
        }, { kind });
        for (let i = 0; i < 100 && !writes.some(write => write.kind === `${kind}-step`); i++) await wait(30);
        assert(writes.some(write => write.kind === `${kind}-step`), 'No real gameplay step after explicit resume');
        await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
        await key(page, 'c');
        await page.locator(`.${kind}-overlay`).waitFor(); await shown(page, kind, profile.stage);
        const stepped = (await api('state')).state;
        assert.equal(stepped.game.id, gameId); assert.equal(stepped.game[kind].paused, true);
        assert(stepped.game[kind].step > 0); assert(!stepped.game[kind].end);
        assert.deepEqual(stepped.economy, started.state.economy); assert.equal(stepped.careCount, started.state.careCount);
        assert.equal(writes[0].kind, `${kind}-resume`); assert.equal(writes.at(-1).kind, `${kind}-pause`);
        assert(writes.every(write => [`${kind}-resume`, `${kind}-step`, `${kind}-pause`].includes(write.kind)));
      }
      assert.deepEqual(errors, []);
      if (skew > 0 && growthReply === 'missing') await page.screenshot({ path: join(dir, `${kind}-${profile.stage}-${mode.label}.png`), fullPage: true });
      results.push({ kind, stage: profile.stage, skew, mode: mode.label, growthReply, runtimeJump, browserNow,
        importedSchema: 1, gameId, interactive, writes: writes.map(write => write.kind) });
      console.log('PASS', results.length, kind, profile.stage, skew, mode.label, growthReply, interactive ? '+ resume/step/pause' : 'read-only');
    } catch (error) {
      if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(dir, 'failure.png'), fullPage: true }).catch(() => {});
      throw error;
    } finally { currentPage = null; await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results }, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} catch (error) {
  console.error('FAIL artifacts', dir); throw error;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log);
}
