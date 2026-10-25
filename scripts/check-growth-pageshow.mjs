// Real HTTP care/persistence with constructed near-threshold history and manually
// dispatched pagehide/pageshow. This does not verify native BFCache/mobile events.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-growth-pageshow-browser-'));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function seed(stage) {
  await api('reset', { confirm: true });
  const { state } = await api('action', { kind: 'hatch', species: 2, requestId: `hatch-${Date.now()}` });
  const now = Date.now(); state.createdAt = state.hatchedAt = now - 80 * 3600000; state.lastTick = now;
  state.album.since = state.createdAt;
  state.album.entries.find(memory => memory.kind === 'hatch').at = state.hatchedAt;
  state.needs = { hunger: 20, mood: 80, clean: 20, energy: 40 };
  state.growth = { stage: 'baby', points: 23.95, form: '', trackedHours: 12, wellbeing: 10,
    growingAt: 0, adultAt: 0, care: { nutrition: 0, play: 0, clean: 3, rest: 1, lastFeed: 0, lastPlay: 0, lastClean: 0 } };
  await api('import', state);
  if (stage === 'adult') {
    await api('action', { kind: 'feed', requestId: `prepare-${Date.now()}` });
    const approaching = await api('backup'); approaching.growth.points = 71.95;
    await api('import', approaching);
  }
}
async function key(page, name) { await page.locator(`.button-${name}`).tap(); }
async function lifecycle(page, type) {
  await page.evaluate(type => { if (document.hidden) throw new Error('fixture must remain visible'); window.dispatchEvent(new PageTransitionEvent(type, { persisted: true })); }, type);
}
const celebration = page => page.locator('.content-home .pet-scene[data-motion="celebrating"]');
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
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const stage of ['growing', 'adult']) for (const interrupted of [true, false]) for (const mode of [
    { label: 'desktop', width: 1280, height: 900, font: 14 },
    { label: 'short-large', width: 320, height: 380, font: 28 },
  ]) {
    await seed(stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, isMobile: mode.width === 320 });
    let release, routeDone;
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/action') writes.push(req.postDataJSON()); });
      const kind = stage === 'adult' ? 'clean' : 'feed';
      let committed;
      const committedResult = new Promise(resolve => { committed = resolve; });
      if (!interrupted) {
        const delivery = new Promise(resolve => { release = resolve; });
        routeDone = new Promise(resolve => {
          page.route('**/api/action', async route => {
            try {
              const response = await route.fetch(); // Real commit; only delivery is delayed.
              committed(await response.json()); await delivery; await route.fulfill({ response });
            } finally { resolve(); }
          });
        });
      }
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const reply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action');
      await key(page, 'a');
      if (kind === 'clean') { await key(page, 'a'); await key(page, 'a'); }
      await key(page, 'b');
      let accepted;
      if (interrupted) {
        accepted = await (await reply).json(); await celebration(page).waitFor();
        await lifecycle(page, 'pagehide');
      } else {
        accepted = await committedResult; await lifecycle(page, 'pagehide'); release();
        await reply; await routeDone;
      }
      assert.equal(accepted.state.growth.stage, stage);
      assert.equal(accepted.careFeedback.milestone.stage, stage);
      assert.equal(accepted.state.album.entries.filter(entry => entry.kind === stage).length, 1);
      await wait(4500); assert.equal(await celebration(page).count(), 0);
      await lifecycle(page, 'pageshow'); await celebration(page).waitFor();
      assert.equal(await celebration(page).getAttribute('data-stage'), stage);
      if (stage === 'adult') assert.equal(await celebration(page).getAttribute('data-form'), 'gentle');
      await wait(1500); assert.equal(await celebration(page).count(), 1, 'interrupted clip did not restart in full');
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
      if (!interrupted) await page.screenshot({ path: join(dir, `${stage}-${mode.label}.png`), fullPage: true });
      await key(page, 'c'); assert.equal(await celebration(page).count(), 0);
      await lifecycle(page, 'pageshow'); assert.equal(await celebration(page).count(), 0, 'repeated pageshow replayed celebration');
      await page.reload(); await page.locator('.pet-scene[data-motion="idle"]').waitFor();
      assert.equal(await celebration(page).count(), 0, 'refresh replayed celebration');
      const saved = (await api('state')).state;
      assert.equal(saved.growth.stage, stage); assert.equal(saved.careCount, accepted.state.careCount);
      assert.equal(saved.album.entries.filter(entry => entry.kind === stage).length, 1);
      assert.equal(saved.growth.growingAt, accepted.state.growth.growingAt);
      assert.equal(saved.growth.adultAt, accepted.state.growth.adultAt);
      assert.deepEqual(saved.growth.formRecord, accepted.state.growth.formRecord);
      assert.equal(writes.length, 1); assert.equal(writes[0].kind, kind); assert.deepEqual(errors, []);
      results.push({ stage, interrupted, mode: mode.label, actionWrites: writes.length, careCount: saved.careCount, milestoneCount: 1 });
      console.log('PASS', stage, interrupted ? 'interrupted' : 'delayed-reply', mode.label);
    } finally { release?.(); await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} catch (error) {
  await writeFile(join(dir, 'failure.json'), JSON.stringify({ error: String(error), completed: results, serverLog: log }, null, 2));
  console.error('Failure artifacts', dir); throw error;
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
