// Exact residues: READ-ONLY response fixtures. Real writes: far-from-boundary
// needs, real HTTP/SQLite and server clock. Exact server-time care is covered
// separately by TestPersistedCareBoundaryAndReplay; do not conflate the evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set an absolute isolated PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set an absolute isolated PIXELPET_TEST_WEB');
// A clean checkout need not have shared build outputs at all.
async function sharedPath(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code === 'ENOENT') return resolve(path); throw error; }
}
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')));
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-boundary-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed(stage, need) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const r = await api('import', { schema: 1, revision: 1, species: 2, name: '照顾精度伙伴',
    createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    needs: { hunger: need, mood: 80, clean: need, energy: 80 }, careCount: 0, logs: [] });
  assert.equal(r.state.growth.stage, stage); assert.equal(r.careRules.needTolerance, 1e-9);
  return r.state;
}
async function key(page, k) {
  await page.locator(`.button-${k}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function select(page, kind) {
  await key(page, 'a');
  if (kind === 'clean') { await key(page, 'a'); await key(page, 'a'); }
  await page.locator(`[data-care-preview=${kind}]`).waitFor();
}
async function readable(page, selector) {
  const result = await page.locator(selector).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), failures = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) failures.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if ((/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) ||
            (/hidden|clip|auto|scroll/.test(css.overflowX) && (box.left < rect.left - 1 || box.right > rect.right + 1))) failures.push('clipped: ' + text.textContent);
        }
      }
    }
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minText = Math.min(...[el, ...el.querySelectorAll('p,small,dt,dd,strong')].map(e => parseFloat(getComputedStyle(e).fontSize)));
    return { failures, overflow: document.documentElement.scrollWidth > innerWidth + 1, rootSize, minText };
  });
  assert.deepEqual(result.failures, [], selector); assert.equal(result.overflow, false);
  assert(result.minText >= result.rootSize * .85, JSON.stringify(result));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [
    { label: 'desktop', width: 1200, height: 800, font: 14 },
    { label: 'phone-large', width: 320, height: 700, font: 28 },
    { label: 'short-contrast', width: 320, height: 380, font: 28, forcedColors: 'active' },
  ];
  const profiles = [
    { label: 'near-habit', boundary: 'habit', delta: 5e-10, tolerance: 1e-9, eligible: true, effect: true, rounded: false },
    { label: 'near-full', boundary: 'full', delta: -5e-10, tolerance: 1e-9, full: true, effect: false, rounded: false },
    { label: 'outside-habit', boundary: 'habit', delta: 2e-9, tolerance: 1e-9, effect: true, rounded: true },
    { label: 'outside-full', boundary: 'full', delta: -2e-9, tolerance: 1e-9, effect: true, rounded: true },
    { label: 'legacy-habit', boundary: 'habit', delta: 5e-10, effect: true, rounded: true },
    { label: 'malformed-full', boundary: 'full', delta: -5e-10, tolerance: 1e-6, effect: true, rounded: true },
  ];
  for (const stage of ['baby', 'growing', 'adult']) for (const kind of ['feed', 'clean']) for (const mode of modes) {
    const before = await seed(stage, 80), need = kind === 'feed' ? 'hunger' : 'clean', habit = kind === 'feed' ? 'nutrition' : 'clean';
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.forcedColors || 'none' });
    const page = await context.newPage(), errors = [], writes = []; let fixture = profiles[0];
    const label = `${stage}-${kind}-${mode.label}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() !== 'GET' && new URL(req.url()).pathname !== '/api/visit') writes.push(new URL(req.url()).pathname); });
    await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
    const responseFixture = async route => {
      if (!['/api/state', '/api/visit'].includes(new URL(route.request().url()).pathname)) return route.continue();
      const response = await route.fetch(), reply = await response.json();
      assert(reply.state && reply.careRules, 'fixture must start with a real response');
      reply.state.needs[need] = (fixture.boundary === 'habit' ? (kind === 'feed' ? 70 : 65) : (kind === 'feed' ? 96 : 99)) + fixture.delta;
      if (fixture.tolerance === undefined) delete reply.careRules.needTolerance;
      else reply.careRules.needTolerance = fixture.tolerance;
      await route.fulfill({ response, json: reply });
    };
    try {
      await page.route('**/api/**', responseFixture);
      for (const profile of profiles) {
        fixture = profile;
        await page.goto(base); await page.locator('.home-caption').waitFor(); await select(page, kind);
        const preview = page.locator('.care-preview'), text = await preview.innerText();
        if (profile.full) assert(text.includes(kind === 'feed' ? '暂时不能喂食' : '暂时不用洗澡'), text);
        else if (profile.eligible) assert(text.includes('符合记录习惯的条件'), text);
        else if (profile.boundary === 'habit') assert(text.includes('本次不记'), text);
        else assert(text.includes(kind === 'feed' ? '补充饱食' : '恢复清洁'), text);
        assert.equal(await page.locator('.care-base-effect').count(), Number(profile.effect));
        assert.equal(await page.locator('.care-rounded-reading').count(), Number(profile.rounded));
        await readable(page, '.care-preview');
        await page.locator('.care-preview > small').scrollIntoViewIfNeeded();
        const end = await page.locator('.care-preview > small').boundingBox();
        assert(end && end.y >= -1 && end.y + end.height <= mode.height + 1, 'last care note not reachable');
        assert.deepEqual(writes, [], 'read-only fixture must not perform care');
        if (stage === 'baby' && kind === 'feed' && ['near-habit', 'near-full'].includes(profile.label)) await page.screenshot({ path: join(dir, `fixture-${mode.label}-${profile.label}.png`), fullPage: true });
        results.push({ type: 'read-only-response-fixture', stage, kind, mode: mode.label, profile: profile.label });
      }
      const afterReading = (await api('state')).state;
      for (const field of ['careCount', 'economy']) assert.deepEqual(afterReading[field], before[field]);
      assert.equal(afterReading.growth.care[habit], before.growth.care[habit]);
      // From here on, no routes or modified responses. Real actions are well
      // below the thresholds so natural request latency cannot fake a boundary.
      await page.unroute('**/api/**', responseFixture);
      const realBefore = await seed(stage, 30);
      await page.goto(base); await page.locator('.home-caption').waitFor();
      let first;
      for (const reason of ['credited', 'cooldown']) {
        await select(page, kind);
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST');
        await key(page, 'b'); const receipt = await (await response).json();
        assert.equal(receipt.careFeedback?.reason, reason, JSON.stringify(receipt));
        assert.equal(receipt.careFeedback.habitGain, reason === 'credited' ? 1 : 0);
        assert.equal(receipt.careFeedback.points, reason === 'credited' && stage !== 'adult' ? .25 : 0);
        await page.locator(`[data-feedback=${reason}]`).waitFor();
        await readable(page, '.growth-feedback');
        if (reason === 'credited') first = receipt.state;
        else assert.equal(receipt.state.growth.care[habit], first.growth.care[habit]);
      }
      assert.deepEqual(writes, ['/api/action', '/api/action']);
      await page.reload(); await page.locator('.home-caption').waitFor();
      const persisted = (await api('state')).state;
      assert.equal(persisted.careCount, realBefore.careCount + 2);
      assert.equal(persisted.growth.care[habit], realBefore.growth.care[habit] + 1);
      assert.deepEqual(persisted.economy, realBefore.economy);
      assert.equal(persisted.growth.stage, stage);
      if (stage === 'adult') { assert.equal(persisted.growth.points, 72); assert.deepEqual(persisted.growth.formRecord, realBefore.growth.formRecord); }
      assert.deepEqual(writes, ['/api/action', '/api/action'], 'reload replayed care'); assert.deepEqual(errors, []);
      if (stage === 'baby' && kind === 'clean') { await select(page, kind); await page.screenshot({ path: join(dir, `real-care-${mode.label}.png`), fullPage: true }); }
      results.push({ type: 'real-http-care-and-reload', stage, kind, mode: mode.label, writes: writes.length });
      console.log('PASS', label, 'six read-only fixtures + two real care actions');
    } catch (error) { await page.screenshot({ path: join(dir, `failure-${label}.png`), fullPage: true }); throw error; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ fixtureGroups: results.filter(r => r.type === 'read-only-response-fixture').length,
    realCareGroups: results.filter(r => r.type === 'real-http-care-and-reload').length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) await new Promise(r => { server.once('exit', r); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
