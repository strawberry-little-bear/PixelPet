// Own server/save/build only. Real natural bites plus explicitly labelled UI
// response fixtures; WebAudio instrumentation observes real nodes, not fake sound.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-fishing-cue-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(response.ok, await response.clone().text()); return response.json();
}
function observeAudio() {
  const Original = window.AudioContext;
  window.__biteAudio = { contexts: [], notes: [], resumes: 0 };
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args); window.__biteAudio.contexts.push(this);
      const resume = this.resume.bind(this);
      this.resume = (...args) => { window.__biteAudio.resumes++; return resume(...args); };
      const create = this.createOscillator.bind(this);
      this.createOscillator = (...args) => {
        const oscillator = create(...args), note = { frequency: 0, starts: [], stops: [] };
        window.__biteAudio.notes.push(note);
        const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
        oscillator.start = (...args) => { note.frequency = oscillator.frequency.value; note.starts.push({ now: this.currentTime, args }); return start(...args); };
        oscillator.stop = (...args) => { note.stops.push({ now: this.currentTime, args }); return stop(...args); };
        return oscillator;
      };
    }
  };
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
const cueCount = page => page.evaluate(() => window.__biteAudio.notes.filter(n => n.frequency === 1040).length);
async function naturalBite(page, resumptions) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await page.locator('.fishing-bite').isVisible()) return;
    if (await page.locator('.fishing-pause').isVisible()) {
      assert(resumptions.length < 6, 'host repeatedly suspended'); resumptions.push(Date.now()); await key(page, 'C');
    }
    await wait(100);
  }
  throw Error('no natural bite before deadline');
}
async function geometry(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
  assert.match(await page.locator('.fishing-bite').innerText(), /B 提竿/);
  assert.equal(await page.locator('#sound-description').count(), 1);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; }); server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '听听鱼漂', createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  await api('action', { kind: 'play-fishing' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(observeAudio); const page = await context.newPage(), errors = [], resumptions = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base); await page.locator('.fishing-game').waitFor(); await key(page, 'B');
    await naturalBite(page, resumptions); await geometry(page);
    assert.equal(await page.evaluate(() => window.__biteAudio.contexts.length), 0);
    await page.screenshot({ path: join(dir, 'natural-default-silent-bite.png'), fullPage: true });
    await key(page, 'C'); await page.getByRole('button', { name: '打开声音', exact: true }).tap(); await key(page, 'C');
    await wait(1200); assert.equal(await cueCount(page), 0, 'resuming an existing bite replayed it');
    await key(page, 'B'); assert.equal((await api('state')).state.game.fishing.catches.length, 1);
    results.push({ type: 'natural-default-silent-bite-visual-resume-no-replay' });
    await page.setViewportSize({ width: 320, height: 700 }); await key(page, 'B'); await naturalBite(page, resumptions);
    assert.equal(await cueCount(page), 1, 'new live bite did not make exactly one cue'); await geometry(page);
    const notes = await page.evaluate(() => window.__biteAudio.notes.filter(n => n.frequency === 1040));
    assert.equal(notes[0].starts.length, 1); assert(Math.abs(notes[0].stops[0].args[0] - notes[0].starts[0].now - .14) < .01);
    await key(page, 'C'); await page.screenshot({ path: join(dir, 'natural-sounded-bite-paused-320.png'), fullPage: true });
    await key(page, 'C'); await wait(1200); assert.equal(await cueCount(page), 1, 'same bite repeated after resume');
    await key(page, 'B'); const state = (await api('state')).state;
    assert.equal(state.game.fishing.catches.length, 2); assert.equal(state.careCount, 0); assert.equal(state.economy.coins, 0);
    results.push({ type: 'natural-enabled-live-bite-once-pause-resume-catch', resumptions }); assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: join(dir, 'natural-failure.png'), fullPage: true }); console.error('Artifacts:', dir); throw error; }
  finally { await context.close(); }

  // Isolated response fixtures test timing and interruption boundaries without
  // pretending to be natural fish catches. No fixture action reaches the DB.
  const template = await api('state');
  for (const mode of ['live', 'saved-bite', 'late', 'help', 'blur', 'mute', 'suspended', 'closed', 'server-paused']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(observeAudio); await context.addInitScript(() => localStorage.setItem('pixelpet-sound', 'on'));
    const page = await context.newPage(), fixture = structuredClone(template), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    Object.assign(fixture.state.game.fishing, { casts: 1, catches: [], phase: mode === 'saved-bite' ? 'bite' : 'wait', step: 1, elapsedMs: 32000, waitMs: 32000, paused: true });
    let started = false, release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/api/action') {
        const action = request.postDataJSON(); assert(['fish-resume', 'fish-step'].includes(action.kind), 'unexpected fixture action');
        const n = fixture.state.game.fishing; fixture.state.revision++; n.step++;
        if (action.kind === 'fish-resume') n.paused = false;
        else if (!started) {
          started = true; await held; n.phase = 'bite'; n.paused = mode === 'server-paused';
        }
        n.lastPulseAt = Date.now();
      } else assert(['/api/state', '/api/visit'].includes(path), 'unexpected fixture endpoint');
      fixture.serverTime = Date.now();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    try {
      await page.goto(base); await page.locator('.fishing-pause').waitFor(); assert.equal(await cueCount(page), 0);
      await key(page, 'C');
      if (mode === 'suspended' || mode === 'closed') await page.evaluate(async mode => { await window.__biteAudio.contexts[0][mode === 'closed' ? 'close' : 'suspend'](); }, mode);
      const deadline = Date.now() + 5000; while (!started && Date.now() < deadline) await wait(20); assert(started, 'no pulse request');
      if (mode === 'late') await wait(1650);
      if (mode === 'help') await page.getByRole('button', { name: '玩法说明', exact: true }).tap();
      if (mode === 'blur') await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
      if (mode === 'mute') await page.getByRole('button', { name: '关闭声音', exact: true }).tap();
      const resumes = await page.evaluate(() => window.__biteAudio.resumes);
      release(); await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
      await wait(1200); assert.equal(await cueCount(page), mode === 'live' ? 1 : 0, mode);
      assert.equal(await page.evaluate(() => window.__biteAudio.resumes), resumes, 'automatic cue requested audio permission');
      assert.deepEqual(errors, []); results.push({ type: 'intercepted-response-boundary', mode });
    } catch (error) { await page.screenshot({ path: join(dir, 'fixture-failure-' + mode + '.png'), fullPage: true }); console.error('Artifacts:', dir); throw error; }
    finally { release(); await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
}
