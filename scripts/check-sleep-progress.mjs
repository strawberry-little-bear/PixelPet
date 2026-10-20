// Live short sleeps: isolated HTTP/SQLite + Chrome; never touches a player save.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-sleep-progress-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(r.ok, await r.clone().text()); return r.json();
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function selectSleep(page) {
  for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
  assert.equal(await page.locator('.care-preview').getAttribute('data-care-preview'), 'sleep');
}
async function sleepAction(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
  await key(page, 'B'); const r = await response; assert(r.ok()); return r.json();
}
async function sync(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const r = await response; assert(r.ok()); const data = await r.json(); await wait(100); return data;
}
const amount = n => n > 0 && n < .005 ? '<0.01' : n.toFixed(2);
async function matches(page, result) {
  const s = result.state.sleepSession; assert(s && result.state.sleeping);
  const panel = page.locator('.sleep-progress'); await panel.waitFor();
  assert.deepEqual(await panel.locator('dd').allTextContents(), [`${amount(s.settledHours)} 小时`, `+${amount(s.energyRecovered)}`, `+${amount(s.restGain)}`, `+${amount(s.growthPoints)} 点`]);
  assert.deepEqual(await panel.locator('time').evaluateAll(nodes => nodes.map(n => n.dateTime)), [new Date(s.startedAt).toISOString(), new Date(result.state.lastTick).toISOString()]);
  assert.equal(await page.locator('.sleep-summary').count(), 0, 'Reading sleep invented a wake receipt');
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const issues = await page.locator('.sleep-progress').evaluate(el => {
    const issues = [], footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > footer.top + 1) issues.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'Progress text is clipped or overlaps footer');
  const end = page.locator('.sleep-progress > small'); await end.scrollIntoViewIfNeeded();
  assert(await end.evaluate(el => { const b = el.getBoundingClientRect(); return b.top >= -1 && b.bottom <= innerHeight + 1; }));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }]) {
    for (const stage of ['baby', 'growing', 'adult']) {
      const now = Date.now(), age = ({ baby: 2, growing: 30, adult: 80 }[stage]) * 3600000;
      const imported = await api('import', { schema: 1, revision: 1, species: 2, name: '安心休息', createdAt: now - age, hatchedAt: now - age,
        lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 90, energy: stage === 'adult' ? 100 : 40 }, careCount: 0, logs: [] });
      assert.equal(imported.state.growth.stage, stage);
      const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
        isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [], label = `${stage}-${mode.width}-${mode.height}`;
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      try {
        console.log('RUN', label); await page.goto(base); await page.locator('.home-caption').waitFor();
        await selectSleep(page); assert.equal(await page.locator('.sleep-progress').count(), 0);
        const bed = await sleepAction(page); assert(bed.state.sleepSession); await key(page, 'C');
        await wait(1100); const first = await api('visit', {}); assert(first.state.sleepSession.settledHours > 0);
        const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
        await page.reload(); await page.locator('.home-caption').waitFor(); const restored = await (await loaded).json();
        assert.equal(restored.state.sleepSession.startedAt, bed.state.sleepSession.startedAt);
        await selectSleep(page); await matches(page, restored); assert.equal(writes.length, 1);
        await readable(page);
        const actualFont = await page.locator('.sleep-progress').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert(actualFont >= mode.font * .85, 'Progress did not inherit enlarged body text');
        const y = await page.evaluate(() => scrollY), focus = await page.evaluate(() => [...document.querySelectorAll(".physical-button")].indexOf(document.activeElement));
        const refreshed = await sync(page); await matches(page, refreshed);
        assert(refreshed.state.sleepSession.settledHours >= restored.state.sleepSession.settledHours);
        assert.equal(await page.evaluate(() => scrollY), y, 'Read stole scroll position');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll(".physical-button")].indexOf(document.activeElement)), focus, 'Read stole native focus');
        await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
        // External actions model a second page, with no replay by this page.
        const externalWake = await api('action', { kind: 'sleep', requestId: `external-wake-${label}` });
        assert(!externalWake.state.sleeping); await sync(page);
        assert.equal(await page.locator('.sleep-progress,.sleep-summary').count(), 0);
        const nextBed = await api('action', { kind: 'sleep', requestId: `external-bed-${label}` });
        assert(nextBed.state.sleepSession.startedAt > bed.state.sleepSession.startedAt);
        const next = await sync(page); await matches(page, next); assert.equal(writes.length, 1);
        const wake = await sleepAction(page); assert(wake.careFeedback.sleepSummary); assert(!wake.state.sleepSession);
        await page.locator('.sleep-summary').waitFor(); assert.equal(await page.locator('.sleep-progress').count(), 0);
        assert.equal(writes.length, 2); assert.deepEqual(errors, []);
        results.push({ stage, ...mode, passed: true });
      } catch (error) { await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
      } finally { await context.close(); }
    }
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
