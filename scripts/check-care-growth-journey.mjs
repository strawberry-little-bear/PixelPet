// Real HTTP + physical A/B/C care across constructed, near-threshold saves.
// This is NOT a natural multi-day aging test. Never uses the player's DB,
// running preview, shared dist, response interception, or a mocked clock.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-growth-journey-'));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const forms = { balanced: '均衡型', lively: '活力型', gentle: '恬静型', easygoing: '自在型' };
const results = [];
let server, browser, log = '', startupError;
async function api(path, body, headers = {}) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}
async function key(page, name) { await page.locator(`.button-${name.toLowerCase()}`).tap(); }
async function scene(page, stage, motion, form) {
  const selector = `.pet-scene[data-stage="${stage}"][data-motion="${motion}"]${form ? `[data-form="${form}"]` : ''}`;
  await page.locator(selector).waitFor();
}
async function choose(page, index) {
  await key(page, 'a');
  for (let i = 0; i < index; i++) await key(page, 'a');
  await key(page, 'b');
}
function near(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`); }
function milestoneCount(state, kind) { return state.album.entries.filter(memory => memory.kind === kind).length; }
function immutableAdult(state) {
  return { form: state.growth.form, adultAt: state.growth.adultAt, growingAt: state.growth.growingAt,
    record: state.growth.formRecord, adultMemories: state.album.entries.filter(memory => memory.kind === 'adult') };
}
async function threeKeys(page) {
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
// Begin from a real new save/hatch, then explicitly construct its near-threshold
// history. These care totals are test inputs, not proof of days of prior play.
async function seed(form) {
  await api('reset', { confirm: true });
  const hatched = await api('action', { kind: 'hatch', species: 2, requestId: `hatch-${form}-${Date.now()}` });
  const state = hatched.state, now = Date.now(), age = 80 * 3600000;
  state.createdAt = state.hatchedAt = now - age; state.lastTick = now;
  state.album.since = state.createdAt;
  state.album.entries.find(memory => memory.kind === 'hatch').at = state.hatchedAt;
  state.needs = { hunger: 20, mood: 80, clean: 20, energy: 40 };
  state.growth = { stage: 'baby', points: 23.95, form: '', trackedHours: 12, wellbeing: form === 'easygoing' ? 3 : 10,
    growingAt: 0, adultAt: 0,
    care: { nutrition: 0, play: form === 'lively' ? 3 : 0, clean: form === 'gentle' ? 3 : 0,
      rest: form === 'gentle' ? 1 : 0, lastFeed: 0, lastPlay: 0, lastClean: 0 } };
  return api('import', state);
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
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch { /* Startup only. */ }
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const form of Object.keys(forms)) {
    const label = `${form}-${width}`;
    await seed(form);
    const context = await browser.newContext({ viewport: { width, height: 700 }, isMobile: width === 320,
      hasTouch: true, reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST') writes.push({ path, body: request.postDataJSON() });
    });
    if (width === 320) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '28px';
    }));
    async function care(index, kind) {
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/action' &&
        response.request().postDataJSON().kind === kind);
      await choose(page, index);
      const saved = await response; assert(saved.ok(), await saved.text());
      return { result: await saved.json(), body: saved.request().postDataJSON(), headers: await saved.request().allHeaders() };
    }
    async function reload(stage, motion = 'idle') {
      const count = writes.filter(write => write.path === '/api/action').length;
      await page.reload(); await scene(page, stage, motion, stage === 'adult' ? form : undefined);
      await threeKeys(page);
      assert.equal(await page.locator('.care-milestone').count(), 0, 'reload must not reconstruct the action milestone');
      assert.equal(writes.filter(write => write.path === '/api/action').length, count, 'reload replayed care');
      assert.equal(await page.locator('[data-motion="celebrating"]').count(), 0, 'reload replayed evolution');
    }
    try {
      await page.goto(base); await scene(page, 'baby', 'idle'); await threeKeys(page);
      const awakeStart = (await api('visit', {})).state;
      await wait(300); // Actual elapsed time, no clock replacement/backdating.
      const awakeEnd = (await api('visit', {})).state;
      const awakeHours = (awakeEnd.lastTick - awakeStart.lastTick) / 3600000;
      assert(awakeHours > 0 && awakeHours < 1 / 60);
      for (const [key, rate] of Object.entries({ hunger: -3, mood: -2.5, clean: -2, energy: -2 }))
        near(awakeEnd.needs[key] - awakeStart.needs[key], rate * awakeHours, `awake ${key}`);
      const averageComfort = Object.keys(awakeStart.needs).reduce((sum, key) =>
        sum + (awakeStart.needs[key] + awakeEnd.needs[key]) / 2, 0) / 400;
      near(awakeEnd.growth.points - awakeStart.growth.points, awakeHours * (.5 + .75 * averageComfort), 'passive growth');
      assert.deepEqual(awakeEnd.growth.care, awakeStart.growth.care);
      assert.equal(awakeEnd.careCount, awakeStart.careCount);
      const feed = await care(0, 'feed'), grown = feed.result.state;
      assert.deepEqual(feed.result.careFeedback.milestone, { stage: 'growing', at: feed.result.careFeedback.effect.at });
      assert.equal(feed.result.careFeedback.reason, 'credited'); near(feed.result.careFeedback.points, .25, 'feed bonus');
      assert.equal(grown.growth.stage, 'growing'); assert(grown.growth.growingAt > grown.hatchedAt);
      assert.equal(grown.growth.care.nutrition, 1); assert.equal(milestoneCount(grown, 'growing'), 1);
      near(feed.result.careFeedback.effect.after.hunger - feed.result.careFeedback.effect.before.hunger, 20, 'actual meal');
      await scene(page, 'growing', 'eating'); // Saved stage changes before its deferred presentation.
      await scene(page, 'growing', 'celebrating'); await key(page, 'c'); await scene(page, 'growing', 'idle');
      await page.locator('.care-milestone').scrollIntoViewIfNeeded();
      assert((await page.locator('.care-milestone').innerText()).includes('这次照顾推动进入成长期'));
      await threeKeys(page); await reload('growing');
      // Skip the untested multi-day interval explicitly, preserving this very
      // pet's real just-earned milestone/meal. No backdating of the server clock.
      const approaching = await api('backup'); approaching.growth.points = 71.95;
      const prepared = await api('import', approaching);
      assert.equal(prepared.state.growth.growingAt, grown.growth.growingAt);
      await reload('growing');
      const bath = await care(2, 'clean'), adult = bath.result.state;
      assert.equal(bath.result.careFeedback.reason, 'credited');
      assert.deepEqual(bath.result.careFeedback.milestone, { stage: 'adult', at: bath.result.careFeedback.effect.at, form });
      assert(bath.result.careFeedback.points > 0 && bath.result.careFeedback.points < .06, 'adult bonus must cap');
      assert.equal(adult.growth.stage, 'adult'); assert.equal(adult.growth.points, 72); assert.equal(adult.growth.form, form);
      assert(adult.growth.adultAt >= adult.growth.growingAt); assert(adult.growth.formRecord);
      for (const key of ['nutrition', 'play', 'clean', 'rest']) near(adult.growth.formRecord[key], adult.growth.care[key], `threshold ${key}`);
      near(adult.growth.formRecord.trackedHours, adult.growth.trackedHours, 'threshold tracked hours');
      near(adult.growth.formRecord.wellbeing, adult.growth.wellbeing, 'threshold wellbeing');
      assert.equal(milestoneCount(adult, 'adult'), 1); assert.equal(milestoneCount(adult, 'growing'), 1);
      await scene(page, 'adult', 'bathing', form); await scene(page, 'adult', 'celebrating', form);
      await key(page, 'c'); await scene(page, 'adult', 'idle', form);
      await page.locator('.care-milestone').scrollIntoViewIfNeeded();
      assert((await page.locator('.care-milestone').innerText()).includes(`这次照顾推动进入成年期 · ${forms[form]}已定型`));
      if (form === 'gentle') await page.screenshot({ path: join(dir, `${label}-milestone.png`), fullPage: true });
      await threeKeys(page); await reload('adult');
      const locked = immutableAdult(adult), careCount = adult.careCount;
      // Replay the exact real HTTP request, with its generation guard and id.
      const replay = await api('action', bath.body, { 'X-PixelPet-Generation': bath.headers['x-pixelpet-generation'] });
      assert.deepEqual(replay.careFeedback, bath.result.careFeedback);
      const afterReplay = (await api('state')).state;
      assert.equal(afterReplay.careCount, careCount); assert.deepEqual(immutableAdult(afterReplay), locked);
      // Body care still works during its habit cooldown, without a second bonus.
      const secondMeal = await care(0, 'feed');
      assert.equal(secondMeal.result.careFeedback.milestone, undefined);
      assert.equal(secondMeal.result.careFeedback.reason, 'cooldown'); assert.equal(secondMeal.result.careFeedback.points, 0);
      assert.equal(secondMeal.result.state.growth.care.nutrition, 1);
      assert.equal(secondMeal.result.state.careCount, careCount + 1);
      near(secondMeal.result.careFeedback.effect.after.hunger - secondMeal.result.careFeedback.effect.before.hunger, 20, 'cooldown meal');
      assert.deepEqual(immutableAdult(secondMeal.result.state), locked);
      await scene(page, 'adult', 'eating', form); await key(page, 'c'); await scene(page, 'adult', 'idle', form);
      const sleep = await care(3, 'sleep'); assert(sleep.result.state.sleeping);
      assert.equal(sleep.result.careFeedback.milestone, undefined); await scene(page, 'adult', 'sleeping', form);
      await wait(300); await reload('adult', 'sleeping');
      const sleeping = (await api('visit', {})).state, before = sleep.result.state;
      const hours = (sleeping.lastTick - before.lastTick) / 3600000;
      assert(hours > 0 && hours < 1 / 60, 'only short real elapsed time is tested');
      near(sleeping.needs.energy - before.needs.energy, 14 * hours, 'sleep recovery');
      near(sleeping.needs.hunger - before.needs.hunger, -3 * hours, 'sleep hunger');
      near(sleeping.needs.clean - before.needs.clean, -2 * hours, 'sleep cleanliness');
      near(sleeping.needs.mood, before.needs.mood, 'sleep mood');
      near(sleeping.growth.care.rest - before.growth.care.rest, 14 * hours / 28, 'proportional rest habit');
      assert.deepEqual(immutableAdult(sleeping), locked);
      const wake = await care(3, 'sleep'); assert.equal(wake.result.state.sleeping, false);
      assert.equal(wake.result.careFeedback.milestone, undefined);
      await scene(page, 'adult', 'waking', form); await key(page, 'c'); await scene(page, 'adult', 'idle', form);
      // The portable backup is restored unchanged into the same isolated server.
      const backup = await api('backup'), restored = await api('import', backup);
      assert.deepEqual(immutableAdult(restored.state), locked); await reload('adult');
      await choose(page, 6); await page.locator('.growth-panel[data-growth-page="0"]').waitFor();
      assert((await page.locator('.growth-panel').innerText()).includes(forms[form]));
      await key(page, 'b'); await key(page, 'b'); // Page 3: frozen form evidence, not today's habits.
      await page.locator('.growth-panel[data-growth-page="2"]').waitFor();
      assert((await page.locator('.growth-panel').innerText()).includes('定型'));
      await threeKeys(page);
      assert.deepEqual(writes.filter(write => write.path !== '/api/visit').map(write => [write.path, write.body.kind]),
        ['feed', 'clean', 'feed', 'sleep', 'sleep'].map(kind => ['/api/action', kind]), 'unexpected gameplay write');
      assert.deepEqual(errors, []);
      if (form === 'gentle' || form === 'easygoing') await page.screenshot({ path: join(dir, `${label}-evidence.png`), fullPage: true });
      results.push({ form, width, growingAt: grown.growth.growingAt, adultAt: adult.growth.adultAt, record: locked.record,
        awakeSeconds: awakeHours * 3600, sleepSeconds: hours * 3600, writes, restoredGenerationChanged: restored.saveGeneration !== wake.result.saveGeneration });
      assert(results.at(-1).restoredGenerationChanged, 'restore must replace save generation');
    } catch (error) {
      await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
