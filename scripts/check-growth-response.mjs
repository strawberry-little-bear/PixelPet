// Growth, care and return-response real-Chrome acceptance. Always creates its own save/server; never a player's URL.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-growth-response-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts), 'PIXELPET_TEST_ARTIFACTS must be absolute.');
await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;
const scope = process.env.PIXELPET_TEST_SCOPE || 'all';
assert(['all', 'return', 'settlement'].includes(scope), 'PIXELPET_TEST_SCOPE must be all, return or settlement.');
const results = [];
let server, browser, startupError, log = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const get = async () => (await (await fetch(base + '/api/state')).json());
async function importState(state) {
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply)); return reply.state;
}
async function seed(stage = 'baby', evidence = false) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  let state = await importState({ schema: 1, revision: 1, species: 2, name: '成长回复核对', createdAt: now - age, hatchedAt: now - age, lastTick: now,
    sleeping: false, careCount: 0, logs: [], needs: { hunger: 50, mood: 70, clean: 60, energy: 80 } });
  if (evidence) {
    assert.equal(stage, 'adult');
    state.growth.formRecord = { nutrition: 0, play: 0, clean: 0, rest: 0, trackedHours: 0, wellbeing: 0 };
    state = await importState(state);
  }
  assert.equal(state.growth.stage, stage); assert.equal(state.careCount, 0);
  return state;
}
const modes = [
  { label: 'normal', width: 390, height: 844, font: 14 },
  { label: 'large', width: 320, height: 568, font: 28 },
];
async function view(mode) {
  const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = [], writes = [], reads = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', req => {
    const path = new URL(req.url()).pathname;
    if (['/api/action', '/api/reset', '/api/import', '/api/recap/read'].includes(path)) writes.push(path);
    if (['/api/state', '/api/visit'].includes(path)) reads.push(path);
  });
  await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
  await page.clock.install(); // Only the poll scenario advances controlled browser time; not long-duration certification.
  return { ctx, page, errors, writes, reads, mode };
}
async function key(v, k) { const b = v.page.locator('.button-' + k + ':not(:disabled)'); await b.scrollIntoViewIfNeeded(); await b.tap(); }
async function settled(v) { await v.page.waitForFunction(() => !document.querySelector('.button-b').disabled); }
async function readable(v) {
  const layout = await v.page.locator('.lcd-content').evaluate(el => {
    const box = el.getBoundingClientRect(), ranges = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    // Ordinary reading pages intentionally scroll inside the fixed LCD. Use
    // the scrollport's virtual content bounds here; comparing every range to
    // its current viewport would report the lower half of a long page as
    // clipped before the user has scrolled there.
    const scroll = { left: box.left, right: box.right,
      top: box.top - el.scrollTop, bottom: box.top - el.scrollTop + el.scrollHeight };
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const hint = walker.currentNode.parentElement.closest('.care-reading-hint');
      if (hint) {
        const style = getComputedStyle(hint);
        if (style.clipPath !== 'none' || style.clip !== 'auto') continue;
      }
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      const panel = walker.currentNode.parentElement.closest('.return-mode .return-panel');
      const bounds = panel ? { left: panel.getBoundingClientRect().left, right: panel.getBoundingClientRect().right,
        top: panel.getBoundingClientRect().top - panel.scrollTop, bottom: panel.getBoundingClientRect().top - panel.scrollTop + panel.scrollHeight } : scroll;
      for (const r of range.getClientRects()) if (r.width && r.height) ranges.push({ text: walker.currentNode.textContent.trim().slice(0, 120), left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: bounds });
    }
    return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, ranges, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(layout.overflow, false, JSON.stringify(layout));
  for (const r of layout.ranges) {
    // Return content intentionally scrolls inside the fixed LCD. All other
    // reading pages must still fit normal flow; never ignore horizontal clipping.
    const bounds = r.scroll ?? layout.box;
    assert(r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1, JSON.stringify({ layout, r }));
    assert(r.left >= layout.box.left - 1 && r.right <= layout.box.right + 1);
  }
  const recap = v.page.locator('.return-mode .return-panel');
  if (await recap.count()) {
    const reach = await recap.evaluate(el => {
      const previous = el.scrollTop; el.scrollTop = el.scrollHeight;
      const box = el.getBoundingClientRect();
      const r = [...el.querySelectorAll('small')].at(-1).getBoundingClientRect();
      const result = { overflow: getComputedStyle(el).overflowY, widthFits: el.scrollWidth <= el.clientWidth + 1,
        bottomVisible: r.bottom <= box.bottom + 1 && r.top >= el.querySelector('header').getBoundingClientRect().bottom - 1 };
      el.scrollTop = previous; return result;
    });
    assert.equal(reach.overflow, 'auto'); assert(reach.widthFits && reach.bottomVisible, JSON.stringify(reach));
  }
  for (const b of await v.page.locator('.physical-button').all()) {
    await b.scrollIntoViewIfNeeded(); const r = await b.boundingBox(); assert(r.width >= 44 && r.height >= 44);
  }
  return { overflow: layout.overflow, textRanges: layout.ranges.length };
}
async function end(v, result, expectedWrites, allowedWrites = ['/api/action']) {
  assert.deepEqual(v.errors, []); assert.equal(v.writes.length, expectedWrites);
  assert(v.writes.every(path => allowedWrites.includes(path)));
  assert.equal(await v.page.locator('.physical-button').count(), 3);
  assert.equal(await v.page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  results.push({ ...result, mode: v.mode.label, writes: v.writes.length, reads: v.reads.length });
  console.log('PASS', results.length, JSON.stringify(results.at(-1)));
}
function returnHistory(r) {
  const g = r.state.growth;
  const snapshot = { needs: structuredClone(r.state.needs), stage: g.stage, form: g.form,
    points: g.points, rest: g.care.rest, trackedHours: g.trackedHours, sleeping: r.state.sleeping };
  return { id: 'synthetic-response-history', from: r.serverTime - 1800000, to: r.serverTime,
    before: structuredClone(snapshot), after: structuredClone(snapshot) };
}
// Controlled elapsed-time fixture: modify ONLY this run's mkdtemp database,
// with no browser context open. Shift all saved epochs together so migrated
// growth timestamps retain their ordering. This is not a natural 30-minute wait.
async function absent(sleeping = false) {
  let state = await seed(sleeping ? 'growing' : 'baby');
  if (sleeping) { state.sleeping = true; state = await importState(state); }
  const visit = await fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(visit.ok);
  await shiftElapsed(.5);
  return state;
}
// No client/server clock changes: only this run's own fixture epochs move.
// Used before opening a browser context, never against a player's save.
async function shiftElapsed(hours) {
  assert(Number.isFinite(hours) && hours > 0);
  await promisify(execFile)('python3', ['-c', `
import sqlite3, json, sys
with sqlite3.connect(sys.argv[1]) as db:
    def shift(value):
        if isinstance(value, dict): return {k: shift(v) for k, v in value.items()}
        if isinstance(value, list): return [shift(v) for v in value]
        if isinstance(value, (int, float)) and value > 1000000000000: return value - int(sys.argv[2])
        return value
    body = json.loads(db.execute('SELECT body FROM saves WHERE id=1').fetchone()[0])
    db.execute('UPDATE saves SET body=? WHERE id=1', (json.dumps(shift(body)),))
    db.execute('UPDATE visits SET last_seen=last_seen-? WHERE id=1', (int(sys.argv[2]),))
`, join(dir, 'test.db'), String(hours * 3600000)]);
}
const corruptions = [
  ...['date', 'needs', 'period'].map(field => ({ name: 'return-' + field, stage: 'growing', damage: r => {
    r.returnRecap = returnHistory(r); r.recapPending = true;
    if (field === 'date') r.returnRecap.from = 8640000000000001;
    else if (field === 'period') r.returnRecap.from = r.returnRecap.to + 1;
    else r.returnRecap.before.needs = null;
  } })),
  { name: 'habits', stage: 'baby', damage: r => { r.state.growth.care = null; } },
  { name: 'record', stage: 'adult', damage: r => { r.state.growth.formRecord = []; } },
  { name: 'date', stage: 'adult', damage: r => { r.state.growth.adultAt = 8640000000000001; } },
  { name: 'points', stage: 'growing', damage: r => { r.state.growth.points = '25'; } },
  { name: 'feedback-points', stage: 'baby', damage: r => { r.careFeedback = { kind: 'feed', reason: 'credited', points: '1', habitGain: 1, habit: 'nutrition' }; } },
  { name: 'feedback-reason', stage: 'adult', damage: r => { r.careFeedback = { kind: 'feed', reason: {}, points: 0, habitGain: 1, habit: 'nutrition' }; } },
];
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stderr.on('data', data => { log += data; }); server.stdout.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log); assert.equal(server.signalCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, 'Own test server did not start: ' + log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  // The return subset includes reversed-period entry/reconciliation as well
  // as recap claims; other corruption categories remain in the full matrix.
  for (const test of corruptions.filter(test => scope === 'all' || (scope === 'return' && test.name === 'return-period'))) for (const scenario of ['initial', 'poll', 'committed', 'uncommitted']) {
    const seeded = await seed(test.stage, test.stage === 'adult');
    const v = await view(modes[['initial', 'committed'].includes(scenario) ? 1 : 0]);
    try {
      const writing = ['committed', 'uncommitted'].includes(scenario);
      let badVisit = scenario === 'initial', badState = false, badWrite = writing;
      await v.page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let response, reply;
        if (path === '/api/action' && scenario === 'uncommitted' && badWrite) reply = await get();
        else { response = await route.fetch(); reply = await response.json(); }
        if ((path === '/api/visit' && badVisit) || (path === '/api/state' && badState) || (path === '/api/action' && badWrite)) test.damage(reply);
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base);
      if (scenario !== 'initial') {
        await v.page.locator('.content-home').waitFor();
        if (scenario === 'poll') { badVisit = true; await v.page.clock.runFor(15010); }
        else { await key(v, 'a'); await key(v, 'b'); }
      }
      await v.page.locator('.save-recovery').waitFor(); await settled(v);
      assert.equal(await v.page.locator('.button-a').isDisabled(), true); assert.equal(await v.page.locator('.button-c').isDisabled(), true);
      await v.page.keyboard.press('a'); await v.page.keyboard.press('c');
      assert.equal(await v.page.locator('.save-recovery').count(), 1);
      const alert = await v.page.getByRole('alert').innerText();
      assert.equal(alert.includes('可能已经保存'), writing);
      assert.equal(await v.page.locator('.growth-feedback.has-feedback,.care-outcome').count(), 0);
      // A second malformed read must not unlock care or retransmit it.
      // Unknown writes use GET state; plain connection failures retain visit settlement.
      badState = true; const readCount = v.reads.length;
      await key(v, 'b'); await settled(v); assert.equal(v.reads.length, readCount + 1);
      assert.equal(v.reads.at(-1), writing ? '/api/state' : '/api/visit');
      assert.equal(await v.page.locator('.save-recovery').count(), 1);
      const layout = await readable(v);
      if (test.name === 'habits' && scenario === 'committed') await v.page.screenshot({ path: join(artifacts, 'growth-response-large.png'), fullPage: true });
      if (test.name === 'record' && scenario === 'uncommitted') await v.page.screenshot({ path: join(artifacts, 'growth-response-normal.png'), fullPage: true });
      badVisit = false; badState = false; badWrite = false;
      await key(v, 'b'); await v.page.locator('.save-recovery').waitFor({ state: 'detached' }); await v.page.locator('.content-home').waitFor();
      assert.equal(await v.page.locator('.pet-scene').getAttribute('data-motion'), 'idle');
      assert.equal(await v.page.locator('.growth-feedback.has-feedback,.care-outcome').count(), 0);
      const after = (await get()).state;
      assert.equal(after.careCount, scenario === 'committed' ? 1 : 0);
      assert.equal(after.growth.stage, test.stage); assert.equal(after.growth.form, seeded.growth.form);
      assert.deepEqual(after.growth.formRecord, seeded.growth.formRecord);
      assert.equal(after.economy.coins, seeded.economy.coins);
      assert.equal(v.writes.length, writing ? 1 : 0);
      if (writing) {
        await key(v, 'a'); await key(v, 'b'); await v.page.locator('.growth-feedback.has-feedback').waitFor();
        assert.equal((await get()).state.careCount, scenario === 'committed' ? 2 : 1);
      }
      await end(v, { corruption: test.name, scenario, stage: test.stage, layout }, writing ? 2 : 0);
    } finally { await v.ctx.close(); }
  }
  if (scope === 'all') for (const growth of ['absent', 'null', 'null-record', 'valid-record']) {
    const seeded = await seed('adult', growth === 'valid-record');
    const v = await view(modes[growth.includes('record') ? 1 : 0]);
    try {
      await v.page.route('**/api/visit', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (growth === 'absent') delete reply.state.growth;
        if (growth === 'null') reply.state.growth = null;
        if (growth === 'null-record') reply.state.growth.formRecord = null;
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base); await v.page.locator('.content-home').waitFor();
      await key(v, 'a'); for (let i = 0; i < 6; i++) await key(v, 'a'); await key(v, 'b');
      await v.page.locator('.growth-panel').waitFor(); await key(v, 'b'); await key(v, 'b');
      assert.equal(await v.page.locator('.growth-page-dots').textContent(), '3 / 6');
      assert.equal(await v.page.locator(growth === 'valid-record' ? '.form-record-care' : '.form-record-missing').count(), 1);
      const layout = await readable(v); await key(v, 'c'); await v.page.locator('.content-home').waitFor();
      const after = (await get()).state; assert.equal(after.careCount, 0); assert.deepEqual(after.growth.formRecord, seeded.growth.formRecord);
      await end(v, { compatibility: growth, layout }, 0);
    } finally { await v.ctx.close(); }
  }
  // Valid legacy fractional totals really go through the server. Never rewrite
  // the reply to synthesize these deltas, and never round the saved habit totals.
  if (scope === 'all') for (const stage of ['baby', 'growing', 'adult']) for (const kind of ['feed', 'clean']) for (const initial of [.4, 1.2]) {
    let seeded = await seed(stage, stage === 'adult');
    const habit = kind === 'feed' ? 'nutrition' : 'clean';
    seeded.growth.care[habit] = initial;
    seeded = await importState(seeded);
    const v = await view(modes[initial === .4 ? 0 : 1]);
    let acknowledged;
    try {
      await v.page.route('**/api/action', async route => {
        const response = await route.fetch(); acknowledged = await response.json();
        await route.fulfill({ response, json: acknowledged });
      });
      await v.page.goto(base); await v.page.locator('.content-home').waitFor();
      await key(v, 'a');
      if (kind === 'clean') { await key(v, 'a'); await key(v, 'a'); }
      // Home renders the acknowledgement as the compact, visible summary;
      // the detailed `.care-learning` block is intentionally aria-hidden there.
      await key(v, 'b'); await v.page.locator('.care-outcome-compact-summary').waitFor();
      const expectedGain = (initial + 1) - initial;
      assert.equal(acknowledged.careFeedback.habitGain, expectedGain);
      assert.equal(acknowledged.careFeedback.reason, 'credited');
      const label = kind === 'feed' ? '喂食习惯' : '清洁习惯';
      assert((await v.page.locator('.growth-feedback.has-feedback strong').innerText()).endsWith(label + ' +1'));
      assert((await v.page.locator('.care-outcome-compact-summary').innerText()).includes(label + '：+1'));
      assert.equal(await v.page.locator('.save-recovery').count(), 0);
      const after = (await get()).state;
      assert.equal(after.growth.care[habit], initial + 1); assert.equal(after.careCount, 1);
      assert.equal(after.growth.stage, stage); assert.equal(after.growth.form, seeded.growth.form);
      assert.deepEqual(after.growth.formRecord, seeded.growth.formRecord);
      assert.equal(after.economy.coins, seeded.economy.coins);
      if (stage === 'adult') {
        assert.equal(after.growth.points, 72); assert.equal(acknowledged.careFeedback.points, 0);
      } else assert.equal(acknowledged.careFeedback.points, .25);
      const layout = await readable(v);
      if (stage === 'adult' && kind === 'clean' && initial === 1.2)
        await v.page.screenshot({ path: join(artifacts, 'care-credit-large.png'), fullPage: true });
      if (stage === 'baby' && kind === 'feed' && initial === .4)
        await v.page.screenshot({ path: join(artifacts, 'care-credit-normal.png'), fullPage: true });
      await end(v, { credit: kind, stage, initial, rawGain: acknowledged.careFeedback.habitGain, layout }, 1);
    } finally { await v.ctx.close(); }
  }
  if (scope === 'all') for (const feedback of ['absent', 'null']) {
    await seed(); const v = await view(modes[feedback === 'null' ? 1 : 0]);
    try {
      await v.page.route('**/api/action', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (feedback === 'absent') delete reply.careFeedback;
        else reply.careFeedback = null;
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base); await v.page.locator('.content-home').waitFor();
      await key(v, 'a'); await key(v, 'b'); await settled(v);
      assert.equal((await get()).state.careCount, 1);
      assert.equal(await v.page.locator('.save-recovery,.growth-feedback.has-feedback,.care-outcome').count(), 0);
      await end(v, { compatibility: 'feedback-' + feedback, layout: await readable(v) }, 1);
    } finally { await v.ctx.close(); }
  }
  if (scope !== 'settlement') for (const committed of [false, true]) for (const field of ['date', 'needs', 'period']) {
    const seeded = await absent(); const v = await view(modes[committed ? 1 : 0]);
    let badRead = true, seenRecap;
    try {
      await v.page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let response, reply;
        if (path === '/api/recap/read' && !committed) reply = await get();
        else { response = await route.fetch(); reply = await response.json(); }
        if (reply.returnRecap) seenRecap = structuredClone(reply.returnRecap);
        if (path === '/api/recap/read' || (path === '/api/state' && badRead)) {
          assert(reply.returnRecap);
          if (field === 'date') reply.returnRecap.to = 8640000000000001;
          else if (field === 'period') reply.returnRecap.to = reply.returnRecap.from - 1;
          else reply.returnRecap.after.needs = null;
        }
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base); await v.page.locator('.save-recovery').waitFor(); await settled(v);
      assert((await v.page.getByRole('alert').innerText()).includes('可能已经保存'));
      assert.equal(await v.page.locator('.return-panel').count(), 0);
      assert.equal(await v.page.locator('.button-a').isDisabled(), true);
      assert.equal(await v.page.locator('.button-c').isDisabled(), true);
      if (['needs', 'period'].includes(field)) await v.page.screenshot({ path: join(artifacts, 'return-recovery-' + (field === 'period' ? 'period-' : '') + v.mode.label + '.png'), fullPage: true });
      const authoritative = await get();
      assert.equal(authoritative.recapPending, !committed);
      assert.equal(authoritative.returnRecap.id, seenRecap.id);
      assert.equal(authoritative.state.careCount, 0);
      assert.equal(authoritative.state.economy.coins, seeded.economy.coins);
      await key(v, 'b'); await settled(v);
      assert.equal(v.reads.at(-1), '/api/state');
      assert.equal(await v.page.locator('.save-recovery').count(), 1);
      badRead = false; await key(v, 'b'); await v.page.locator('.save-recovery').waitFor({ state: 'detached' });
      await v.page.locator('.content-home').waitFor();
      assert.equal(await v.page.locator('.return-panel,.save-recovery').count(), 0);
      assert.equal(await v.page.locator('.pet-scene').getAttribute('data-motion'), 'idle');
      // B reconciliation and manual reading do not repeat the claim. Later
      // ordinary heartbeats retain the existing pending-record handling.
      // The saved history stays reachable from the three-key menu, both pages.
      await key(v, 'a'); for (let i = 0; i < 7; i++) await key(v, 'a'); await key(v, 'b');
      await v.page.locator('.return-panel').waitFor();
      assert.equal(await v.page.locator('.return-panel header span').innerText(), '1 / 2');
      await key(v, 'a'); assert.equal(await v.page.locator('.return-panel header span').innerText(), '2 / 2');
      const layout = await readable(v);
      if (['needs', 'period'].includes(field)) await v.page.screenshot({ path: join(artifacts, 'return-response-' + (field === 'period' ? 'period-' : '') + v.mode.label + '.png'), fullPage: true });
      await key(v, 'c'); await v.page.locator('.content-home').waitFor();
      const after = await get();
      assert.deepEqual(after.returnRecap, authoritative.returnRecap);
      assert.equal(after.recapPending, !committed);
      assert.equal(after.state.careCount, 0);
      await end(v, { returnClaim: field, committed, layout }, 1, ['/api/recap/read']);
    } finally { await v.ctx.close(); }
  }
  if (scope !== 'settlement') for (const sleeping of [false, true]) for (const sleepField of ['absent', 'null']) {
    const seeded = await absent(sleeping); const v = await view(modes[sleepField === 'null' ? 1 : 0]);
    try {
      await v.page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (reply.returnRecap) for (const endpoint of ['before', 'after']) {
          if (sleepField === 'absent') delete reply.returnRecap[endpoint].sleeping;
          else reply.returnRecap[endpoint].sleeping = null;
        }
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base);
      if (sleeping) {
        await v.page.locator('.content-home').waitFor(); await settled(v);
        assert.deepEqual(v.writes, []); assert.equal((await get()).recapPending, true);
        await key(v, 'a'); for (let i = 0; i < 3; i++) await key(v, 'a'); await key(v, 'b');
        await v.page.waitForFunction(() => document.querySelector('.pet-scene')?.getAttribute('data-motion') === 'waking');
        await key(v, 'c');
      }
      await v.page.locator('.return-panel').waitFor();
      const authoritative = await get(), history = structuredClone(authoritative.returnRecap);
      assert.equal(authoritative.recapPending, false);
      assert.equal(history.before.sleeping, sleeping); assert.equal(history.after.sleeping, sleeping);
      assert.equal(history.to - history.from >= 1800000, true);
      assert.equal(authoritative.state.economy.coins, seeded.economy.coins);
      assert.equal((await v.page.locator('.return-panel').innerText()).includes('离开时：未记录'), true);
      assert.equal((await v.page.locator('.return-panel').innerText()).includes('旧记录缺失的信息不作推测'), true);
      assert(history.after.needs.hunger < history.before.needs.hunger);
      assert(history.after.points > history.before.points);
      assert(history.after.trackedHours - history.before.trackedHours >= .5);
      assert(history.after.trackedHours - history.before.trackedHours < .51);
      if (sleeping) assert(history.after.rest > history.before.rest);
      else assert.equal(history.after.rest, history.before.rest);
      if (sleeping) assert(history.after.needs.energy > history.before.needs.energy);
      else assert(history.after.needs.energy < history.before.needs.energy);
      await readable(v); await key(v, 'a');
      assert.equal(await v.page.locator('.return-panel header span').innerText(), '2 / 2');
      assert((await v.page.locator('.return-care').innerText()).includes('清醒'));
      const layout = await readable(v);
      await key(v, 'c'); await v.page.locator('.content-home').waitFor();
      assert.deepEqual((await get()).returnRecap, history);
      await end(v, { returnCompatibility: sleepField, sleeping, controlledMinutes: 30, layout }, sleeping ? 2 : 1,
        sleeping ? ['/api/action', '/api/recap/read'] : ['/api/recap/read']);
    } finally { await v.ctx.close(); }
  }
  if (scope !== 'return') for (const sleeping of [false, true]) for (const test of [
    { stage: 'baby', gaps: [24], absence: 24, settled: 12 },
    { stage: 'growing', gaps: [8, 8, 8], absence: 24, settled: 24 },
    { stage: 'adult', gaps: [8, 40], absence: 48, settled: 20 },
  ]) {
    let seeded = await seed(test.stage);
    if (sleeping) { seeded.sleeping = true; seeded = await importState(seeded); }
    assert((await fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok);
    for (let i = 0; i < test.gaps.length; i++) {
      await shiftElapsed(test.gaps[i]);
      if (i < test.gaps.length - 1) assert.equal((await get()).returnRecap, undefined);
    }
    const response = await fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert(response.ok); const authoritative = await response.json(), history = structuredClone(authoritative.returnRecap);
    assert(authoritative.recapPending);
    const hours = history.after.trackedHours - history.before.trackedHours;
    assert(Math.abs(hours - test.settled) < .01, JSON.stringify({ hours, test }));
    assert(Math.abs((history.to - history.from) / 3600000 - test.absence) < .01);
    assert.equal(history.before.stage, test.stage);
    assert.equal(history.before.sleeping, sleeping); assert.equal(history.after.sleeping, sleeping);
    assert.equal(authoritative.state.careCount, 0); assert.equal(authoritative.state.economy.coins, seeded.economy.coins);
    if (sleeping) {
      assert.equal(history.after.needs.energy, 100);
      assert(Math.abs(history.after.rest - history.before.rest - (100 - seeded.needs.energy) / 28) < .001);
    } else { assert(history.after.needs.energy < history.before.needs.energy); assert.equal(history.after.rest, history.before.rest); }
    if (test.stage === 'adult') { assert.equal(history.after.points, 72); assert.equal(history.after.form, seeded.growth.form); }
    const v = await view(modes[sleeping ? 1 : 0]);
    try {
      // Keep the real pending record unclaimed for manual reading. No gameplay
      // write is necessary to inspect history, even while the pet is asleep.
      await v.page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if ('recapPending' in reply) reply.recapPending = false;
        await route.fulfill({ response, json: reply });
      });
      await v.page.goto(base); await v.page.locator('.content-home').waitFor();
      await key(v, 'a'); for (let i = 0; i < 7; i++) await key(v, 'a'); await key(v, 'b');
      assert((await v.page.locator('.return-panel').innerText()).includes(`离开了 ${test.absence} 小时`));
      await key(v, 'b'); assert.equal(await v.page.locator('.return-panel header span').innerText(), '2 / 2');
      const text = await v.page.locator('.return-panel').innerText();
      assert(text.includes(`${test.settled.toFixed(2)} 小时`));
      assert(text.includes('累计结算，不等同于离开时长')); assert(text.includes('可能分多次结算'));
      assert(text.includes('具体见状态页时间说明')); assert(!text.includes('单次离线最多结算 12 小时'));
      const layout = await readable(v);
      if (test.stage === 'growing') await v.page.screenshot({ path: join(artifacts, `return-settlement-${v.mode.label}.png`), fullPage: true });
      await key(v, 'a'); assert.equal(await v.page.locator('.return-panel header span').innerText(), '1 / 2');
      await key(v, 'b'); await key(v, 'b'); await v.page.locator('.content-home').waitFor();
      await key(v, 'a'); for (let i = 0; i < 6; i++) await key(v, 'a'); await key(v, 'b');
      for (let i = 0; i < 4; i++) await key(v, 'b');
      const guide = await v.page.getByLabel('离线与成长说明').innerText();
      assert(guide.includes('每次结算有上限')); assert(guide.includes('多次读取可能累计更多'));
      await readable(v);
      if (test.stage === 'growing' && sleeping) await v.page.screenshot({ path: join(artifacts, 'return-settlement-handbook-large.png'), fullPage: true });
      await key(v, 'c'); await v.page.locator('.content-home').waitFor();
      const after = await get(); assert.deepEqual(after.returnRecap, history); assert(after.recapPending);
      assert.equal(after.state.careCount, 0); assert.equal(after.state.economy.coins, seeded.economy.coins);
      await end(v, { settlement: test.stage, sleeping, gaps: test.gaps, absence: test.absence, actualHours: hours, layout }, 0);
    } finally { await v.ctx.close(); }
  }
  await writeFile(join(artifacts, 'growth-response-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, scope, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
