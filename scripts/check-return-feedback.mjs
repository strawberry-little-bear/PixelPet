// Real HTTP/SQLite + Chrome; a private presence-gap fixture, NOT a 30-minute sleep.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-feedback-'));
const db = join(dir, 'test.db'), artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [];
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
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const problems = await page.locator(selector).evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(text.textContent);
        for (let p = text.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (/hidden|clip/.test(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(text.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(problems, [], 'care receipt text clipped');
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: db, PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const { width, font, skip } of [{ width: 1200, font: 14, skip: false }, { width: 320, font: 28, skip: true }]) {
    const label = `${width}-${font}-${skip ? 'skip' : 'natural'}`, now = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '回访衔接', createdAt: now - 3600000, hatchedAt: now - 3600000,
      lastTick: now, sleeping: false, needs: { hunger: 16, mood: 80, clean: 20, energy: 40 }, careCount: 0, logs: [] });
    await api('action', { kind: 'sleep', requestId: `sleep-${label}` });
    // Only this test's database is edited. Real Visit settles and creates the recap.
    execFileSync('python3', ['-c', `import sqlite3,sys,time,os
p=sys.argv[1]; assert os.path.basename(p)=='test.db' and os.path.basename(os.path.dirname(p)).startswith('pixelpet-return-feedback-')
c=sqlite3.connect(p); c.execute('UPDATE visits SET last_seen=? WHERE id=1',(int(time.time()*1000)-1800000,)); c.commit(); c.close()`, db]);
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true,
      isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    await context.addInitScript(font => {
      window.__presentation = {};
      const observer = new MutationObserver(() => {
        if (document.documentElement.style.fontSize !== `${font}px`) document.documentElement.style.fontSize = `${font}px`;
        const p = window.__presentation;
        if (document.querySelector('.growth-feedback.has-feedback') && document.querySelector('.pet-scene[data-motion=idle]') && p.feedbackAt == null) p.feedbackAt = performance.now();
        if (document.querySelector('.return-panel') && p.returnAt == null) p.returnAt = performance.now();
      });
      document.addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true }));
    }, font);
    const page = await context.newPage(), writes = [], errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', r => { if (r.method() === 'POST') writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    await page.goto(base); await page.locator('.pet-scene[data-motion=sleeping]').waitFor();
    assert.equal(await page.locator('.return-panel').count(), 0);
    await key(page, 'b'); for (let i = 0; i < 3; i++) await key(page, 'a');
    const waking = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
    await key(page, 'b'); const wake = await (await waking).json();
    assert.equal(wake.state.sleeping, false); assert.equal(wake.careFeedback.reason, 'awake');
    assert.equal(wake.recapPending, true); const recap = wake.returnRecap;
    if (skip) await key(page, 'c');
    await page.waitForFunction(() => document.querySelector('.return-panel,.pet-scene[data-motion=idle]'));
    assert.equal(await page.locator('.return-panel').count(), 0, 'recap interrupts wake feedback');
    assert.equal(writes.filter(r => r.path === '/api/recap/read').length, 0, 'recap claimed before feedback finishes');
    await page.locator('.growth-feedback[data-feedback=awake]').waitFor();
    const original = await page.locator('.care-outcome').textContent();
    assert.match(original, /这次睡眠/); await layout(page, '.care-outcome');
    await page.locator('.care-outcome').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `${label}-feedback.png`), fullPage: true });
    await page.locator('.return-panel').waitFor({ timeout: 15000 });
    const timing = await page.evaluate(() => window.__presentation);
    assert(Number.isFinite(timing.feedbackAt) && Number.isFinite(timing.returnAt));
    assert(timing.returnAt - timing.feedbackAt >= 7950, `feedback interval shortened: ${JSON.stringify(timing)}`);
    assert.equal(writes.filter(r => r.path === '/api/recap/read').length, 1);
    await key(page, 'b'); await page.locator('[aria-label="现在的照顾建议"]').waitFor();
    await page.locator('.return-panel').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('[aria-label="现在的照顾建议"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `${label}-return.png`), fullPage: true });
    await key(page, 'c'); await page.locator('.content-home').waitFor();
    assert.equal(await page.locator('.care-outcome').textContent(), original);
    assert.equal(await page.locator('.growth-feedback.has-feedback').count(), 0);
    const saved = await api('state'); assert.deepEqual(saved.returnRecap, recap); assert.equal(saved.recapPending, false);
    assert.equal(saved.state.sleeping, false);
    await page.reload(); await page.locator('.content-home').waitFor();
    assert.equal(await page.locator('.care-outcome').count(), 0, 'reload must not invent action feedback');
    assert.equal(await page.locator('.return-panel').count(), 0, 'read recap replays on reload');
    assert.equal(writes.filter(r => r.path === '/api/action').length, 1);
    assert.equal(writes.filter(r => r.path === '/api/recap/read').length, 1);
    assert.deepEqual(errors, []); results.push({ label, feedbackMs: timing.returnAt - timing.feedbackAt, writes });
    await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2)); await context.close();
  }
  console.log(JSON.stringify({ passed: results.length, artifacts, results }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server?.pid && server.exitCode === null) { const exit = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exit; }
  await writeFile(join(artifacts, 'server.log'), log);
}
