// Constructed near-threshold history + real elapsed time, HTTP, and Chrome.
// No care action awards the threshold points; sleeping cases wake only after
// a visit has saved the new stage. This is not natural multi-day raising.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-passive-growth-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, { signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function key(page, name) {
  await page.locator(`.button-${name}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function wake(page) {
  // Home → fourth menu entry → explicit wake. No hidden API wake or auto-resume.
  for (const name of ['a', 'a', 'a', 'a']) await key(page, name);
  assert.match(await page.getByLabel('所选菜单说明').innerText(), /按 B 轻轻叫醒/);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
  // Do not use key(): its B-enabled wait intentionally waits out clips.
  // Observe and skip the short wake clip while it is actually on screen.
  await page.locator('.button-b:not(:disabled)').tap();
  await page.locator('.pet-scene[data-motion=waking]').waitFor();
  const reply = await response; assert(reply.ok());
  const result = await reply.json(), f = result.careFeedback;
  assert.equal(result.state.sleeping, false); assert.equal(result.state.sleepSession, undefined);
  assert.equal(f.reason, 'awake'); assert.equal(f.points, 0); assert.equal(f.habitGain, 0);
  assert.equal(f.milestone, undefined); assert.deepEqual(f.effect.before, f.effect.after);
  assert(f.sleepSummary?.energyRecovered > 0); assert(f.sleepSummary.restGain > 0);
  assert(f.sleepSummary.growthPoints > 0);
  // The wake animation precedes growth; C skips only that animation.
  await page.locator('.button-c:not(:disabled)').tap();
  return result;
}
const activeCare = state => {
  const { rest, ...active } = state.growth.care;
  return { active, careCount: state.careCount, coins: state.economy.coins };
};
async function layout(page, selector) {
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const clipped = await page.locator(selector).evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), problems = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        const element = text.parentElement;
        if (element?.matches('[data-care-reading-start]') && getComputedStyle(element).clipPath !== 'none') continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) problems.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1)) problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return [...new Set(problems)];
  });
  assert.deepEqual(clipped, [], 'growth text clipped or overlaps LCD footer');
}
async function history(page, state, target, label) {
  await key(page, 'b'); for (let i = 0; i < 6; i++) await key(page, 'a'); await key(page, 'b');
  for (let i = 0; i < 5; i++) await key(page, 'b');
  await page.locator('.growth-look-guide').waitFor();
  assert.equal(await page.locator('[data-look-stage][aria-current=step]').getAttribute('data-look-stage'), target);
  for (const [stage, at] of [['baby', state.hatchedAt], ['growing', state.growth.growingAt], ['adult', state.growth.adultAt]]) {
    const item = page.locator(`[data-look-stage=${stage}]`), date = item.locator('time');
    if (at) {
      assert.equal(await date.getAttribute('datetime'), new Date(at).toISOString());
      assert.match(await item.textContent(), /成长经历记录/);
    } else {
      assert.equal(await date.count(), 0); assert.match(await item.textContent(), /尚未成年定型/);
    }
  }
  await layout(page, '.content-growth');
  const end = page.locator('.growth-look-guide > small'); await end.scrollIntoViewIfNeeded();
  const box = await end.boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, 'stage guide end unreachable');
  await page.screenshot({ path: join(artifacts, `${label}-history.png`), fullPage: true });
}
const immutable = state => ({ stage: state.growth.stage, form: state.growth.form, growingAt: state.growth.growingAt,
  adultAt: state.growth.adultAt, record: state.growth.formRecord, memories: state.album.entries.filter(m => ['growing', 'adult'].includes(m.kind)) });
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { /* Startup only. */ }
    await wait(50);
  }
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [{ name: 'desktop', width: 1200, height: 900, font: 14 },
    { name: 'phone-large-contrast', width: 320, height: 480, font: 28 }]) for (const target of ['growing', 'adult']) for (const sleeping of [false, true]) {
    const label = `${mode.name}-${target}-${sleeping ? 'sleeping' : 'awake'}`;
    if (process.env.PIXELPET_TEST_CASE && process.env.PIXELPET_TEST_CASE !== label) continue;
    await api('reset', { confirm: true });
    const state = (await api('action', { kind: 'hatch', species: 2, requestId: `hatch-${target}-${Date.now()}` })).state;
    const now = Date.now(), prior = target === 'adult' ? 'growing' : 'baby', threshold = target === 'adult' ? 72 : 24;
    state.createdAt = state.hatchedAt = now - 80 * 3600000; state.lastTick = now;
    state.album.since = state.createdAt; state.album.entries.find(m => m.kind === 'hatch').at = state.hatchedAt;
    state.needs = { hunger: 80, mood: 80, clean: 80, energy: 80 };
    state.growth = { stage: prior, points: threshold - .003, form: '', trackedHours: 12, wellbeing: 10,
      growingAt: target === 'adult' ? now - 1000 : 0, adultAt: 0,
      care: { nutrition: 0, play: 0, clean: 0, rest: 0, lastFeed: 0, lastPlay: 0, lastClean: 0 } };
    // Synthetic history still follows current-format album provenance rules.
    if (target === 'adult') state.album.entries.push({ kind: 'growing', at: state.growth.growingAt, source: 'shared' });
    await api('import', state);
    // The service creates the real session; do not fabricate accumulated rest.
    const initial = sleeping ? (await api('action', { kind: 'sleep', requestId: `sleep-${target}-${Date.now()}` })).state
      : (await api('state')).state;
    assert.equal(initial.growth.stage, prior);
    if (sleeping) assert(initial.sleepSession);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: mode.width === 320,
      hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.width === 320 ? 'active' : 'none' });
    const writes = [], errors = [], reads = [];
    try {
      const page = await context.newPage();
      console.log('START', label);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (['/api/visit', '/api/state'].includes(new URL(response.url()).pathname)) reads.push({ path: new URL(response.url()).pathname, status: response.status(), at: Date.now() }); });
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/visit') writes.push({ path: new URL(request.url()).pathname, kind: request.postDataJSON()?.kind }); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = font + 'px'; window.sawGrowthCelebration = false;
        window.lifecycle = []; window.pollTimers = [];
        // Observe the native 15s timer without changing its delay or callbacks.
        const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
        const pollIDs = new Set();
        window.setInterval = (callback, delay, ...args) => {
          if (delay !== 15000 || typeof callback !== 'function') return nativeInterval(callback, delay, ...args);
          const id = nativeInterval((...values) => {
            window.pollTimers.push({ type: 'fire', at: Date.now(), monotonic: performance.now(), focused: document.hasFocus(), hidden: document.hidden });
            callback(...values);
          }, delay, ...args);
          pollIDs.add(id); window.pollTimers.push({ type: 'start', id, at: Date.now(), monotonic: performance.now() }); return id;
        };
        window.clearInterval = id => {
          if (pollIDs.delete(id)) window.pollTimers.push({ type: 'clear', id, at: Date.now(), monotonic: performance.now() });
          nativeClear(id);
        };
        for (const type of ['focus', 'blur', 'pagehide', 'pageshow', 'visibilitychange'])
          window.addEventListener(type, () => window.lifecycle.push({ type, at: Date.now(), monotonic: performance.now(), focused: document.hasFocus(), hidden: document.hidden }));
        const check = () => { if (document.querySelector('[data-motion=celebrating]')) window.sawGrowthCelebration = true; };
        new MutationObserver(check).observe(document.body, { attributes: true, childList: true, subtree: true }); check();
      }), mode.font);
      await page.bringToFront(); await page.goto(base); await page.locator(`.pet-scene[data-stage=${prior}][data-motion=${sleeping ? 'sleeping' : 'idle'}]`).waitFor();
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-before.png`), fullPage: true });
      let wakeResult = null, duringSleep = null;
      if (sleeping) {
        await page.locator(`.pet-scene[data-stage=${target}][data-motion=sleeping]`).waitFor({ timeout: 90000 });
        duringSleep = (await api('state')).state;
        assert.equal(duringSleep.sleeping, true); assert(duringSleep.sleepSession.energyRecovered > 0);
        assert(duringSleep.growth.care.rest > initial.growth.care.rest);
        assert.deepEqual(activeCare(duringSleep), activeCare(initial));
        assert.equal(await page.evaluate(() => window.sawGrowthCelebration), false, 'do not celebrate over sleeping');
        assert.equal(await page.locator('.care-outcome,.care-milestone').count(), 0);
        assert.deepEqual(writes, [], 'stage transition must not automatically wake');
        await layout(page, '.content-home');
        await page.screenshot({ path: join(artifacts, `${label}-saved-asleep.png`), fullPage: true });
        wakeResult = await wake(page);
        assert.deepEqual(immutable(wakeResult.state), immutable(duringSleep), 'waking cannot reassign the saved stage or form');
      }
      await page.locator(`.pet-scene[data-stage=${target}][data-motion=celebrating]`).waitFor({ timeout: 90000 });
      // Confirmed care feedback keeps its own home card; the queued stage
      // announcement is the separate live toast, not that historical card.
      const celebration = await page.locator('.toast').innerText();
      assert.match(celebration, target === 'adult' ? /长大啦！成为了均衡型/ : /进入成长期/);
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-during.png`), fullPage: true });
      await page.locator(`.pet-scene[data-stage=${target}][data-motion=idle]`).waitFor();
      await page.locator('.toast').waitFor({ state: 'hidden' });
      const grown = (await api('state')).state, at = target === 'adult' ? grown.growth.adultAt : grown.growth.growingAt;
      assert.equal(grown.growth.stage, target); assert.deepEqual(activeCare(grown), activeCare(initial));
      assert.deepEqual(grown.growth.care, (wakeResult?.state ?? state).growth.care);
      assert(at > now && at <= grown.lastTick, 'milestone must come from elapsed settlement, not the fixture timestamp');
      const memories = grown.album.entries.filter(m => m.kind === target);
      assert.deepEqual(memories, [{ kind: target, at, source: 'shared', ...(target === 'adult' ? { form: 'balanced' } : {}) }]);
      if (target === 'adult') {
        assert.equal(await page.locator('.pet-scene').getAttribute('data-form'), 'balanced');
        assert.equal(grown.growth.points, 72); assert(grown.growth.formRecord); assert(grown.growth.formRecord.trackedHours > 12);
      } else { assert(grown.growth.points >= 24); assert.equal(grown.growth.form, ''); }
      if (sleeping) {
        const outcome = await page.locator('.care-outcome').innerText();
        assert.match(outcome, /本页上次已确认 · 起床/);
        assert.match(outcome, /本次没有新增成长点/);
        assert.match(outcome, /包含期间自然成长，不是起床奖励/);
        assert.equal(await page.locator('.care-milestone').count(), 0, 'wake must not claim the earlier transition');
        const summary = wakeResult.careFeedback.sleepSummary;
        for (const field of ['settledHours', 'energyRecovered', 'restGain', 'growthPoints'])
          assert(summary[field] >= duringSleep.sleepSession[field], `wake summary lost saved ${field}`);
        await page.locator('.sleep-summary > small').scrollIntoViewIfNeeded();
        const end = await page.locator('.sleep-summary > small').boundingBox();
        assert(end && end.y >= -1 && end.y + end.height <= mode.height + 1, 'sleep summary end unreachable');
        await page.screenshot({ path: join(artifacts, `${label}-wake-summary.png`), fullPage: true });
      } else assert.equal(await page.locator('.care-outcome,.care-milestone').count(), 0, 'passive growth must not invent a care receipt');
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-after.png`), fullPage: true });
      await history(page, grown, target, label);
      assert.equal(await page.evaluate(() => window.sawGrowthCelebration), true, 'observer must see the actual first celebration');
      const timerObservations = [await page.evaluate(() => ({ phase: 'before-reload', at: Date.now(), monotonic: performance.now(), timers: window.pollTimers, lifecycle: window.lifecycle }))];
      await page.reload(); await page.bringToFront(); await page.locator(`.pet-scene[data-stage=${target}][data-motion=idle]`).waitFor();
      assert.equal(await page.evaluate(() => window.sawGrowthCelebration), false, 'reload bootstrap replayed growth');
      // Include the next ordinary poll after reload, not only its first frame.
      const reloadFocus = await page.evaluate(() => ({ focused: document.hasFocus(), hidden: document.hidden }));
      assert.deepEqual(reloadFocus, { focused: true, hidden: false }, 'ordinary polling requires a foreground focused page');
      // Host and browser monotonic clocks can diverge during scheduling pauses.
      // Allow 90s externally for the native 15s poll; this is persistence
      // coverage, not a polling performance deadline or a clock simulation.
      await page.waitForResponse(response => new URL(response.url()).pathname === '/api/visit', { timeout: 90000 }).catch(async error => {
        console.error('POLL DIAGNOSTIC', label, JSON.stringify({ reloadFocus, reads, at: Date.now(), current: await page.evaluate(() => ({ at: Date.now(), monotonic: performance.now(), focused: document.hasFocus(), hidden: document.hidden, events: window.lifecycle, timers: window.pollTimers, text: document.body.innerText.slice(-2400) })) })); throw error;
      });
      await wait(2600); assert.equal(await page.evaluate(() => window.sawGrowthCelebration), false);
      assert.equal(await page.locator('.care-outcome,.care-milestone').count(), 0);
      const restored = (await api('state')).state;
      assert.deepEqual(immutable(restored), immutable(grown)); assert.equal(restored.careCount, 0);
      assert.deepEqual(restored.growth.care, grown.growth.care);
      assert.deepEqual(writes, sleeping ? [{ path: '/api/action', kind: 'sleep' }] : []); assert.deepEqual(errors, []);
      timerObservations.push(await page.evaluate(() => ({ phase: 'after-reload', at: Date.now(), monotonic: performance.now(), timers: window.pollTimers, lifecycle: window.lifecycle })));
      results.push({ label, timerObservations, fixturePoints: state.growth.points, fixtureLastTick: now, persisted: immutable(grown), sleeping, sleepSummary: wakeResult?.careFeedback.sleepSummary, celebration, reads, writes, errors });
      console.log('PASS', label);
      await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
    } catch (error) {
      const page = context.pages()[0];
      if (page) {
        console.error('CASE DIAGNOSTIC', JSON.stringify({ label, reads, writes, errors, at: Date.now(), current: await page.evaluate(() => ({ at: Date.now(), monotonic: performance.now(), focused: document.hasFocus(), hidden: document.hidden, events: window.lifecycle, timers: window.pollTimers, motion: document.querySelector('.pet-scene')?.outerHTML.slice(0, 500) })) }));
        await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
        await writeFile(join(artifacts, 'failure.txt'), await page.locator('body').innerText()).catch(() => {});
      }
      throw error;
    } finally { await context.close(); }
  }
  assert(results.length > 0, 'No matching passive growth case');
  console.log(`Passive growth: ${results.length} real-time threshold cases passed. Artifacts: ${artifacts}; temporary DB: ${dir}`);
} finally {
  if (browser) await browser.close();
  if (server?.pid && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve)); server.kill();
    const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timeout); }
  }
  await writeFile(join(artifacts, 'server.log'), log);
}
