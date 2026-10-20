// Focus/blur and elapsed browser timers are controlled signals, not an OS-focus
// or natural sixteen-minute absence certification. Only our temporary visits
// row is backdated to reach the return threshold; pet saves are never edited.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-window-presence-')), db = join(dir, 'test.db'), results = [];
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
async function seed(stage = 'baby', sleeping = false) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const r = await api('import', { schema: 1, revision: 1, species: 2, name: '离窗陪伴', createdAt: now - age, hatchedAt: now - age,
    lastTick: now, sleeping, needs: { hunger: 80, mood: 80, clean: 80, energy: 50 }, careCount: 0, logs: [] });
  assert.equal(r.state.growth.stage, stage); return r;
}
function presence(backdate = false) {
  // The filename comes only from mkdtemp above. Never accept a database argument.
  return JSON.parse(execFileSync(process.env.PIXELPET_PYTHON || 'python3', ['-c', `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA busy_timeout=5000')
if sys.argv[2]=='1':
 c.execute('UPDATE visits SET last_seen=last_seen-960000 WHERE id=1'); c.commit()
r=c.execute('SELECT last_seen,baseline,recap,pending FROM visits WHERE id=1').fetchone()
assert r is not None
print(json.dumps(dict(lastSeen=r[0],baseline=json.loads(r[1]),recap=json.loads(r[2]) if r[2] else None,pending=bool(r[3]))))
c.close()`, db, backdate ? '1' : '0'], { encoding: 'utf8' }));
}
async function view(large = false, initialFocused = true) {
  const ctx = await browser.newContext({ viewport: { width: large ? 320 : 1200, height: large ? 568 : 900 },
    isMobile: large, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), reads = [], claims = [], actions = [], errors = [];
  await page.clock.install();
  // Headless Chrome does not model native OS-window focus. This fixture is
  // solely the initial browser signal; signal() supplies subsequent events.
  await page.addInitScript(focused => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
  }, initialFocused);
  await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), large ? 28 : 14);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const path = new URL(r.url()).pathname;
    if (['/api/visit', '/api/state'].includes(path)) reads.push(path);
    if (path === '/api/recap/read') claims.push(path);
    if (['/api/action', '/api/reset', '/api/import'].includes(path)) actions.push(path);
  });
  return { ctx, page, reads, claims, actions, errors };
}
const signal = (v, type) => v.page.evaluate(type => {
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => type === 'focus' });
  window.dispatchEvent(new Event(type));
}, type);
async function open(v) {
  const read = v.page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
  await v.page.goto(base); const r = await (await read).json(); await v.page.locator('.content-home').waitFor(); return r;
}
async function key(v, k) {
  const button = v.page.locator(`.button-${k}:not(:disabled)`); await button.scrollIntoViewIfNeeded(); await button.tap();
  await v.page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function check(v) {
  assert.deepEqual(v.errors, []); assert.equal(await v.page.locator('.physical-button').count(), 3);
  assert.equal(await v.page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
  assert(await v.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: db, PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) {
    await seed(stage, sleeping); const v = await view(sleeping);
    try {
      const initial = await open(v), baseline = presence(true);
      await signal(v, 'blur'); assert.equal(await v.page.evaluate(() => document.hidden), false);
      await v.page.clock.runFor(45000);
      assert.deepEqual(v.reads, ['/api/visit']); assert.equal(v.claims.length, 0); assert.deepEqual(presence(), baseline);
      const returned = v.page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
      await signal(v, 'focus'); const reply = await (await returned).json(), recap = reply.returnRecap;
      assert(reply.recapPending); assert.equal(recap.from, baseline.lastSeen); assert.deepEqual(recap.before, baseline.baseline);
      assert.deepEqual(recap.after.needs, reply.state.needs);
      const elapsed = (reply.state.lastTick - initial.state.lastTick) / 3600000;
      for (const field of ['hunger', 'mood', 'clean', 'energy']) {
        const expected = Math.max(0, Math.min(100, initial.state.needs[field] + reply.careRules[sleeping ? 'sleeping' : 'awake'][field] * elapsed));
        assert(Math.abs(reply.state.needs[field] - expected) < 1e-7, `${stage}/${sleeping}/${field}`);
      }
      assert.equal(reply.state.careCount, initial.state.careCount); assert.deepEqual(reply.state.economy, initial.state.economy);
      assert.equal(reply.state.growth.stage, stage);
      if (stage === 'adult') { assert.equal(reply.state.growth.points, initial.state.growth.points); assert.equal(reply.state.growth.form, initial.state.growth.form); }
      else assert(reply.state.growth.points >= initial.state.growth.points);
      if (sleeping) {
        await v.page.clock.runFor(1000); assert.equal(v.claims.length, 0);
        assert.equal(await v.page.locator('.return-panel').count(), 0);
        for (const k of ['a', 'a', 'a', 'a']) await key(v, k);
        await key(v, 'b'); await v.page.clock.runFor(4000);
      }
      await v.page.locator('.return-panel').waitFor(); assert.equal(v.claims.length, 1);
      assert.deepEqual(v.actions, sleeping ? ['/api/action'] : []);
      await key(v, 'a');
      await v.page.locator('.return-panel').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await check(v); await v.page.screenshot({ path: join(dir, `${stage}-${sleeping ? 'sleep' : 'awake'}.png`), fullPage: true });
      await key(v, 'c'); await v.page.reload(); await v.page.locator('.content-home').waitFor();
      assert.equal(await v.page.locator('.return-panel').count(), 0); assert.equal(v.claims.length, 1);
      results.push({ stage, sleeping, controlledBrowserMillis: 45000, thresholdFixtureMillis: 960000, actualSettledHours: elapsed, passed: true });
    } finally { await v.ctx.close(); }
  }
  for (const late of ['read', 'claim']) {
    await seed(); await api('visit', {}); presence(true);
    const v = await view(true), fetched = deferred(), release = deferred(); let held = false;
    try {
      const path = late === 'read' ? '/api/visit' : '/api/recap/read';
      await v.page.route(`**${path}`, async route => {
        if (held) return route.continue(); held = true;
        const response = await route.fetch(); fetched.resolve(); await release.promise; await route.fulfill({ response });
      });
      await v.page.goto(base); await fetched.promise; await signal(v, 'blur'); release.resolve();
      await v.page.locator('.content-home').waitFor(); await v.page.clock.runFor(15000);
      assert.equal(v.claims.length, late === 'claim' ? 1 : 0); assert.equal(await v.page.locator('.return-panel').count(), 0);
      assert.equal(v.reads.length, 1);
      await signal(v, 'focus'); await v.page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
      if (late === 'read') { await v.page.locator('.return-panel').waitFor(); assert.equal(v.claims.length, 1); }
      else {
        await v.page.clock.runFor(1000); assert.equal(await v.page.locator('.return-panel').count(), 0); assert.equal(v.claims.length, 1);
        await key(v, 'a'); for (let i = 0; i < 7; i++) await key(v, 'a'); await key(v, 'b');
        await v.page.locator('.return-panel').waitFor(); assert.equal(v.claims.length, 1);
      }
      await check(v); assert.deepEqual(v.actions, []); results.push({ lateResponse: late, passed: true });
    } finally { release.resolve(); await v.ctx.close(); }
  }
  for (const sleeping of [false, true]) for (const pending of [false, true]) {
    await seed('baby', sleeping); await api('visit', {});
    if (pending) { presence(true); assert((await api('visit', {})).recapPending); }
    const baseline = presence(), v = await view(sleeping, false);
    try {
      const first = v.page.waitForResponse(r => new URL(r.url()).pathname === '/api/state');
      await v.page.goto(base); await first; await v.page.locator('.content-home').waitFor();
      assert.equal(await v.page.evaluate(() => document.hasFocus()), false);
      await v.page.clock.runFor(45000);
      assert.deepEqual(v.reads, ['/api/state']); assert.equal(v.claims.length, 0);
      assert.equal(await v.page.locator('.return-panel').count(), 0); assert.deepEqual(presence(), baseline);
      const returned = v.page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
      await signal(v, 'focus'); await returned; await v.page.clock.runFor(1000);
      if (pending && !sleeping) await v.page.locator('.return-panel').waitFor();
      else await v.page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
      assert.deepEqual(v.reads, ['/api/state', '/api/visit']);
      assert.equal(v.claims.length, pending && !sleeping ? 1 : 0); assert.deepEqual(v.actions, []);
      await check(v);
      results.push({ initialUnfocused: true, sleeping, pending, controlledBrowserMillis: 45000, passed: true });
    } finally { await v.ctx.close(); }
  }
  for (const nowSleeping of [false, true]) {
    await seed(); await api('visit', {}); presence(true); assert((await api('visit', {})).recapPending);
    const v = await view(true, false), fetched = deferred(), release = deferred(); let held = false;
    try {
      await v.page.goto(base); await v.page.locator('.content-home').waitFor();
      assert.deepEqual(v.reads, ['/api/state']); assert.equal(v.claims.length, 0);
      // A second client can update the pet after our read-only bootstrap. The
      // focused visit must win before this old pending recap can be claimed.
      if (nowSleeping) await api('action', { kind: 'sleep' });
      await v.page.route('**/api/visit', async route => {
        if (held) return route.continue(); held = true;
        const response = await route.fetch(); fetched.resolve(); await release.promise; await route.fulfill({ response });
      });
      await signal(v, 'focus'); await fetched.promise;
      await v.page.clock.runFor(1000); assert.equal(v.claims.length, 0);
      assert.equal(await v.page.locator('.return-panel').count(), 0);
      const finished = v.page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit'); release.resolve(); await finished; await v.page.clock.runFor(1000);
      if (!nowSleeping) await v.page.locator('.return-panel').waitFor();
      else await v.page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
      assert.equal(v.claims.length, nowSleeping ? 0 : 1);
      assert.deepEqual(v.reads, ['/api/state', '/api/visit']); assert.deepEqual(v.actions, []); await check(v);
      await v.page.screenshot({ path: join(dir, `initial-unfocused-${nowSleeping ? 'new-sleep' : 'recap'}.png`), fullPage: true });
      results.push({ initialUnfocused: true, delayedFocusedVisit: true, nowSleeping, passed: true });
    } finally { release.resolve(); await v.ctx.close(); }
  }
  console.log(JSON.stringify({ dir, groups: results.length, results }, null, 2));
} finally {
  await writeFile(join(dir, 'server.log'), log); await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
}
