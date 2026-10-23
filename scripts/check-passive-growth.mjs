// Constructed near-threshold history + real elapsed time, HTTP, and Chrome.
// No care action crosses the threshold; this is not natural multi-day raising.
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
    { name: 'phone-large-contrast', width: 320, height: 480, font: 28 }]) for (const target of ['growing', 'adult']) {
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
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: mode.width === 320,
      hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.width === 320 ? 'active' : 'none' });
    try {
      const page = await context.newPage(), writes = [], errors = [], label = `${mode.name}-${target}`;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/visit') writes.push(request.url()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = font + 'px'; window.sawGrowthCelebration = false;
        const check = () => { if (document.querySelector('[data-motion=celebrating]')) window.sawGrowthCelebration = true; };
        new MutationObserver(check).observe(document.body, { attributes: true, childList: true, subtree: true }); check();
      }), mode.font);
      await page.goto(base); await page.locator(`.pet-scene[data-stage=${prior}][data-motion=idle]`).waitFor();
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-before.png`), fullPage: true });
      await page.locator(`.pet-scene[data-stage=${target}][data-motion=celebrating]`).waitFor({ timeout: 35000 });
      const celebration = await page.locator('.content-home').textContent();
      assert.match(celebration, target === 'adult' ? /长大啦！成为了均衡型/ : /进入成长期/);
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-during.png`), fullPage: true });
      await page.locator(`.pet-scene[data-stage=${target}][data-motion=idle]`).waitFor();
      await page.locator('.toast').waitFor({ state: 'hidden' });
      const grown = (await api('state')).state, at = target === 'adult' ? grown.growth.adultAt : grown.growth.growingAt;
      assert.equal(grown.growth.stage, target); assert.equal(grown.careCount, 0); assert.deepEqual(grown.growth.care, state.growth.care);
      assert(at > now && at <= grown.lastTick, 'milestone must come from elapsed settlement, not the fixture timestamp');
      const memories = grown.album.entries.filter(m => m.kind === target);
      assert.deepEqual(memories, [{ kind: target, at, source: 'shared', ...(target === 'adult' ? { form: 'balanced' } : {}) }]);
      if (target === 'adult') {
        assert.equal(await page.locator('.pet-scene').getAttribute('data-form'), 'balanced');
        assert.equal(grown.growth.points, 72); assert(grown.growth.formRecord); assert(grown.growth.formRecord.trackedHours > 12);
      } else { assert(grown.growth.points >= 24); assert.equal(grown.growth.form, ''); }
      assert.equal(await page.locator('.care-outcome,.care-milestone').count(), 0, 'passive growth must not invent a care receipt');
      await layout(page, '.content-home'); await page.screenshot({ path: join(artifacts, `${label}-after.png`), fullPage: true });
      await history(page, grown, target, label);
      assert.equal(await page.evaluate(() => window.sawGrowthCelebration), true, 'observer must see the actual first celebration');
      await page.reload(); await page.locator(`.pet-scene[data-stage=${target}][data-motion=idle]`).waitFor();
      assert.equal(await page.evaluate(() => window.sawGrowthCelebration), false, 'reload bootstrap replayed growth');
      // Include the next ordinary poll after reload, not only its first frame.
      await page.waitForResponse(response => new URL(response.url()).pathname === '/api/visit', { timeout: 20000 });
      await wait(2600); assert.equal(await page.evaluate(() => window.sawGrowthCelebration), false);
      assert.equal(await page.locator('.care-outcome,.care-milestone').count(), 0);
      const restored = (await api('state')).state;
      assert.deepEqual(immutable(restored), immutable(grown)); assert.equal(restored.careCount, 0);
      assert.deepEqual(restored.growth.care, state.growth.care); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, fixturePoints: state.growth.points, fixtureLastTick: now, persisted: immutable(grown), celebration, writes, errors });
      await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
    } finally { await context.close(); }
  }
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
