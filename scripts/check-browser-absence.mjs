// Opt-in real browser-close acceptance. Six own databases/servers; no time mocks,
// response fixtures, direct DB edits or player URLs. The server stays running.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY to a freshly built test binary.');
const waitMs = Number(process.env.PIXELPET_WALL_WAIT_MS ?? 16 * 60000);
assert(Number.isSafeInteger(waitMs) && waitMs >= 16 * 60000 && waitMs <= 60 * 60000, 'Wait must be 16–60 real minutes.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-browser-absence-')), cases = [], results = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
let browser;
async function start(c) {
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
  c.base = `http://127.0.0.1:${port}`; let error;
  c.child = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_DB: c.db, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.child.once('error', e => { error = e; });
  c.child.stdout.on('data', d => { c.log += d; }); c.child.stderr.on('data', d => { c.log += d; });
  for (let i = 0; i < 100; i++) {
    if (error) throw error; assert.equal(c.child.exitCode, null, c.log);
    const ready = await new Promise(resolve => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => { s.destroy(); resolve(false); }); });
    if (ready) return; await wait(100);
  }
  throw new Error(`Server did not start: ${c.label}`);
}
async function stop(c) {
  if (c.child?.exitCode === null && c.child.signalCode === null) {
    const exited = new Promise(r => c.child.once('exit', r)); c.child.kill('SIGTERM'); await exited;
  }
}
async function api(c, path, body) {
  const r = await fetch(c.base + '/api/' + path, { signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  assert(r.ok, `${c.label} ${path}: ${r.status} ${await r.clone().text()}`); return r.json();
}
function instrument(page, c) {
  page.on('pageerror', e => c.errors.push(e.message));
  page.on('request', r => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/')) c.requests.push({ path, method: r.method(), body: r.postData(), at: Date.now(), phase: c.phase });
  });
}
const response = (page, path) => page.waitForResponse(r => new URL(r.url()).pathname === `/api/${path}`);
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).click(); }
async function menu(page, index) { await key(page, 'a'); for (let i = 0; i < index; i++) await key(page, 'a'); await key(page, 'b'); }
const near = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function verify(c, visit) {
  const before = c.baseline.state, after = visit.state, recap = visit.returnRecap, rules = c.baseline.careRules;
  assert(visit.recapPending && recap); assert.equal(visit.saveGeneration, c.baseline.saveGeneration);
  assert(recap.to - recap.from >= waitMs); assert.equal(recap.from, c.baseline.serverTime);
  assert.deepEqual(recap.before.needs, before.needs); assert.deepEqual(recap.after.needs, after.needs);
  assert.equal(recap.before.sleeping, c.sleeping); assert.equal(recap.after.sleeping, c.sleeping);
  const hours = (after.lastTick - before.lastTick) / 3600000;
  assert(hours >= waitMs / 3600000 && hours < rules.maxOfflineHours);
  for (const key of ['hunger', 'mood', 'clean', 'energy']) {
    const expected = before.needs[key] + rules[c.sleeping ? 'sleeping' : 'awake'][key] * hours;
    assert(expected > 0 && expected < 100); near(after.needs[key], expected, `${c.label} ${key}`);
  }
  assert.equal(after.growth.stage, c.stage); assert.equal(after.growth.form, before.growth.form);
  if (c.stage === 'adult') assert.equal(after.growth.points, before.growth.points);
  else assert(after.growth.points > before.growth.points);
  const rest = c.sleeping ? (after.needs.energy - before.needs.energy) / rules.growth.restEnergyPerHabit : 0;
  near(after.growth.care.rest - before.growth.care.rest, rest, 'effective rest');
  for (const key of ['careCount', 'economy', 'companion', 'pond', 'park', 'game']) assert.deepEqual(after[key], before[key], key);
  for (const key of ['nutrition', 'clean', 'play', 'lastFeed', 'lastClean', 'lastPlay']) assert.equal(after.growth.care[key], before.growth.care[key]);
  return { hours, needs: after.needs, growth: after.growth.points - before.growth.points, rest };
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) {
    const c = { label: `${stage}-${sleeping ? 'sleep' : 'awake'}`, stage, sleeping, db: join(dir, `${stage}-${sleeping}.db`), log: '', requests: [], errors: [], phase: 'baseline' }; cases.push(c);
    await start(c); const now = Date.now(), age = { baby: 1, growing: 30, adult: 80 }[stage] * 3600000;
    await api(c, 'import', { schema: 1, revision: 1, species: 2, name: '真实关页回访', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping, needs: { hunger: 60, mood: 80, clean: 65, energy: 40 }, careCount: 0, logs: [] });
    const context = await browser.newContext(), page = await context.newPage(); instrument(page, c);
    const first = response(page, 'visit'); await page.goto(c.base); c.baseline = await (await first).json();
    await page.locator('.home-caption').waitFor(); assert.equal(c.baseline.state.growth.stage, stage); assert(!c.baseline.recapPending && !c.baseline.returnRecap);
    await context.close(); c.closedAt = Date.now(); assert.equal(c.requests.length, 1, 'Baseline should contain only its real browser visit');
  }
  await browser.close(); browser = null;
  const started = performance.now(), wallStarted = Date.now(), counts = cases.map(c => c.requests.length);
  await writeFile(join(dir, 'waiting.json'), JSON.stringify({ waitMs, wallStarted, cases: cases.map(({ child, ...c }) => ({ ...c, pid: child.pid })) }, null, 2));
  console.log(JSON.stringify({ phase: 'browser-closed-real-wait', waitMs, wallStarted, artifacts: dir, browserRunning: false, servers: cases.map(c => c.child.pid) }));
  await wait(waitMs);
  const elapsed = performance.now() - started, wallElapsed = Date.now() - wallStarted;
  assert(elapsed >= waitMs - 1); assert(Math.abs(wallElapsed - elapsed) < 5000, 'Wall/monotonic clock drift');
  for (const [i, c] of cases.entries()) { assert.equal(c.requests.length, counts[i]); assert.equal(c.child.exitCode, null, 'Own server must stay running'); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const c of cases) {
    c.phase = 'return';
    const width = c.sleeping ? 320 : 1200, context = await browser.newContext({ viewport: { width, height: 800 }, forcedColors: c.sleeping ? 'active' : 'none' });
    if (c.sleeping) await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '28px'; }));
    const page = await context.newPage(); instrument(page, c); const returning = response(page, 'visit');
    // Register before navigation: an awake pet may claim immediately on mount.
    const claiming = c.sleeping ? null : response(page, 'recap/read');
    await page.goto(c.base); const visit = await (await returning).json(), settlement = verify(c, visit), recap = visit.returnRecap;
    let claimed;
    if (c.sleeping) {
      await page.locator('.home-caption').waitFor(); assert.equal(await page.locator('.return-panel').count(), 0);
      assert.equal(c.requests.filter(r => r.path === '/api/recap/read').length, 0, 'Do not claim while sleeping');
      const wake = response(page, 'action'), claimAfterWake = response(page, 'recap/read'); await menu(page, 3);
      const woken = await (await wake).json(); assert.equal(woken.state.sleeping, false); assert.deepEqual(woken.returnRecap, recap);
      claimed = await (await claimAfterWake).json();
    } else claimed = await (await claiming).json();
    assert(claimed.recapClaimed && !claimed.recapPending); assert.deepEqual(claimed.returnRecap, recap);
    await page.locator('.return-panel').waitFor(); assert.equal(await page.locator('.return-panel header span').innerText(), '1 / 2');
    const firstHeight = await page.locator('.device').evaluate(el => el.getBoundingClientRect().height);
    await key(page, 'b'); assert.equal(await page.locator('.return-panel header span').innerText(), '2 / 2');
    assert.equal(await page.locator('.device').evaluate(el => el.getBoundingClientRect().height), firstHeight);
    await page.locator('.return-panel').focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => { const e = document.querySelector('.return-panel'); return e.scrollHeight - e.clientHeight - e.scrollTop < 2; });
    await page.screenshot({ path: join(dir, `${c.label}-recap.png`), fullPage: true });
    await key(page, 'c'); await page.locator('.home-caption').waitFor();
    c.phase = 'reload'; const reloading = response(page, 'visit'); await page.reload(); const reloaded = await (await reloading).json();
    await page.locator('.home-caption').waitFor(); assert(!reloaded.recapPending && !reloaded.recapClaimed); assert.deepEqual(reloaded.returnRecap, recap);
    assert.equal(await page.locator('.return-panel').count(), 0); assert.equal(c.requests.filter(r => r.path === '/api/recap/read').length, 1);
    await menu(page, 7); await page.locator('.return-panel').waitFor(); await key(page, 'a');
    assert.equal(await page.locator('.return-panel header span').innerText(), '2 / 2');
    assert.equal(c.requests.filter(r => r.path === '/api/recap/read').length, 1, 'Manual review must not claim again');
    const persisted = await api(c, 'state'); assert.deepEqual(persisted.returnRecap, recap); assert(!persisted.recapPending);
    assert.equal(persisted.state.sleeping, false); assert.equal(persisted.state.careCount, c.baseline.state.careCount);
    for (const key of ['economy', 'companion', 'pond', 'park', 'game']) assert.deepEqual(persisted.state[key], c.baseline.state[key]);
    const actions = c.requests.filter(r => r.path === '/api/action'); assert.equal(actions.length, c.sleeping ? 1 : 0);
    for (const r of actions) assert.equal(JSON.parse(r.body).kind, 'sleep');
    assert(!c.requests.some(r => ['/api/import', '/api/reset'].includes(r.path))); assert.deepEqual(c.errors, []);
    assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
    results.push({ label: c.label, closedAt: c.closedAt, baseline: c.baseline, visit, claimed, reloaded, persisted, settlement, requests: c.requests });
    await context.close(); await stop(c); console.log('PASS', c.label, JSON.stringify(settlement));
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ waitMs, elapsed, wallElapsed, cases: results }, null, 2));
  console.log(JSON.stringify({ groups: results.length, elapsed, wallElapsed, artifacts: dir }));
} finally {
  if (browser) await browser.close(); await Promise.all(cases.map(stop));
  await Promise.all(cases.map(c => writeFile(join(dir, `${c.label}.log`), c.log)));
  await writeFile(join(dir, 'requests.json'), JSON.stringify(cases.map(c => ({ label: c.label, requests: c.requests, errors: c.errors })), null, 2));
}
