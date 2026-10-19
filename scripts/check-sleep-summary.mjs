// Real Chrome + HTTP/SQLite on a private port/database/build only.
// Short real sleeps test accumulation; simulated hour/cap boundaries live in Go tests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary)); assert(web && isAbsolute(web));
assert.notEqual(resolve(binary), join(root, 'bin/pixelpet'));
assert.notEqual(resolve(web), join(root, 'web/dist'));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-sleep-summary-'));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms)), results = [];
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(base + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(r.ok, await r.clone().text()); return r.json();
}
async function seed(stage, full) {
  const now = Date.now(), age = (stage === 'adult' ? 80 : 1) * 3600000;
  return api('import', { schema: 1, revision: 1, species: 2, name: '好梦伙伴', createdAt: now - age, hatchedAt: now - age,
    lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 90, energy: full ? 100 : 40 }, careCount: 0, logs: [] });
}
async function key(page, name) {
  await page.locator('.button-' + name.toLowerCase()).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function sleep(page) {
  for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
  const reply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
  await key(page, 'B'); const r = await reply; assert(r.ok());
  const result = await r.json(); await key(page, 'C'); return result;
}
async function readable(page) {
  const issues = await page.locator('.sleep-summary').evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'Sleep summary clipped or trapped');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  await page.locator('.sleep-summary > small').scrollIntoViewIfNeeded();
  assert(await page.locator('.sleep-summary > small').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1;
  }), 'End of sleep summary cannot be reached');
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const stage of ['baby', 'adult']) {
      const initial = await seed(stage, stage === 'adult');
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor();
        const bed = await sleep(page); assert(bed.state.sleeping); assert(bed.state.sleepSession); assert(!bed.careFeedback.sleepSummary);
        await wait(1000); const first = await api('visit', {}); assert(first.state.sleepSession.settledHours > 0);
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.sleep-summary').count(), 0, 'Reload invented completed sleep');
        await wait(1000); const second = await api('visit', {});
        assert(second.state.sleepSession.settledHours > first.state.sleepSession.settledHours);
        const wake = await sleep(page), summary = wake.careFeedback.sleepSummary;
        assert(summary); assert(!wake.state.sleeping); assert(!wake.state.sleepSession);
        assert.equal(summary.startedAt, bed.state.sleepSession.startedAt);
        assert.equal(summary.wokeAt, wake.careFeedback.effect.at);
        assert.equal(wake.careFeedback.points, 0); assert.equal(wake.careFeedback.habitGain, 0);
        assert.deepEqual(wake.careFeedback.effect.before, wake.careFeedback.effect.after);
        const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
        close(summary.settledHours, (summary.wokeAt - summary.startedAt) / 3600000);
        close(summary.energyRecovered, wake.state.needs.energy - bed.state.needs.energy);
        close(summary.restGain, wake.state.growth.care.rest - bed.state.growth.care.rest);
        close(summary.growthPoints, wake.state.growth.points - bed.state.growth.points);
        if (stage === 'baby') assert(summary.energyRecovered > second.state.sleepSession.energyRecovered);
        else { assert.equal(summary.growthPoints, 0); assert.equal(wake.state.growth.form, initial.state.growth.form); }
        await page.locator('.sleep-summary').waitFor(); await readable(page);
        assert(await page.locator('.sleep-summary').evaluate((el, font) => parseFloat(getComputedStyle(el).fontSize) >= font * .85, font));
        const text = await page.locator('.sleep-summary').textContent();
        // Another page's ordinary action changes the pet, not this acknowledgement.
        await api('action', { kind: 'sleep', requestId: `other-page-${width}-${stage}` });
        await api('visit', {}); await wait(16000);
        assert.equal(await page.locator('.sleep-summary').textContent(), text);
        assert.equal(writes.length, 2, 'Reading repeated a wake');
        await readable(page);
        await page.locator('.sleep-summary').screenshot({ path: join(dir, `sleep-${width}-${stage}.png`) });
        await page.screenshot({ path: join(dir, `sleep-${width}-${stage}-viewport.png`) });
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.sleep-summary').count(), 0, 'Reload rebuilt old receipt from state');
        assert.deepEqual(errors, []); results.push({ width, font, stage, summary, passed: true });
      } finally { await context.close(); }
    }
  }
  // Response-shaped fixtures only: these prove the long-duration text/layout,
  // not natural day-long sleeps. Go controlled-clock tests prove real capping.
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const settledHours of [12, 24]) {
      await seed('baby', false);
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor(); await sleep(page);
        await page.route('**/api/action', async route => {
          const response = await route.fetch(), body = await response.json();
          if (body.careFeedback?.reason === 'awake') {
            const wokeAt = body.careFeedback.effect.at;
            body.careFeedback.sleepSummary = { startedAt: wokeAt - 24 * 3600000, wokeAt,
              settledHours, energyRecovered: 0, restGain: 0, growthPoints: 0 };
          }
          await route.fulfill({ response, json: body });
        });
        await sleep(page); await page.locator('.sleep-summary').waitFor();
        const text = await page.locator('.sleep-summary').textContent();
        assert(text.includes('入睡至起床：24.00 小时'));
        assert(text.includes(`实际结算：${settledHours.toFixed(2)} 小时`));
        assert.equal(text.includes('未计入结算：12.00 小时'), settledHours === 12);
        await readable(page); await wait(3200);
        await page.locator('.sleep-summary').screenshot({ path: join(dir, `duration-${width}-${settledHours}.png`) });
        await page.screenshot({ path: join(dir, `duration-${width}-${settledHours}-viewport.png`) });
        assert.deepEqual(errors, []);
        results.push({ kind: 'duration-response-fixture', width, font, elapsedHours: 24, settledHours, passed: true });
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify({ dir, results }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) { server.kill('SIGTERM'); await new Promise(r => { if (server.exitCode !== null) return r(); server.once('exit', r); }); }
  await writeFile(join(dir, 'server.log'), log);
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
}
