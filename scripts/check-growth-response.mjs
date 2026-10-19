// Growth and care-response real-Chrome acceptance. Always creates its own save/server; never a player's URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set PIXELPET_TEST_BINARY to an absolute, freshly built test binary.');
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
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const r of range.getClientRects()) if (r.width && r.height) ranges.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, ranges, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(layout.overflow, false, JSON.stringify(layout));
  for (const r of layout.ranges) assert(r.left >= layout.box.left - 1 && r.right <= layout.box.right + 1 && r.top >= layout.box.top - 1 && r.bottom <= layout.box.bottom + 1, JSON.stringify({ layout, r }));
  for (const b of await v.page.locator('.physical-button').all()) {
    await b.scrollIntoViewIfNeeded(); const r = await b.boundingBox(); assert(r.width >= 44 && r.height >= 44);
  }
  return { overflow: layout.overflow, textRanges: layout.ranges.length };
}
async function end(v, result, expectedWrites) {
  assert.deepEqual(v.errors, []); assert.equal(v.writes.length, expectedWrites);
  assert(v.writes.every(path => path === '/api/action'));
  assert.equal(await v.page.locator('.physical-button').count(), 3);
  assert.equal(await v.page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  results.push({ ...result, mode: v.mode.label, writes: v.writes.length, reads: v.reads.length });
  console.log('PASS', results.length, JSON.stringify(results.at(-1)));
}
const corruptions = [
  { name: 'habits', stage: 'baby', damage: r => { r.state.growth.care = null; } },
  { name: 'record', stage: 'adult', damage: r => { r.state.growth.formRecord = []; } },
  { name: 'date', stage: 'adult', damage: r => { r.state.growth.adultAt = 8640000000000001; } },
  { name: 'points', stage: 'growing', damage: r => { r.state.growth.points = '25'; } },
  { name: 'feedback-points', stage: 'baby', damage: r => { r.careFeedback = { kind: 'feed', reason: 'credited', points: '1', habitGain: 1, habit: 'nutrition' }; } },
  { name: 'feedback-reason', stage: 'adult', damage: r => { r.careFeedback = { kind: 'feed', reason: {}, points: 0, habitGain: 1, habit: 'nutrition' }; } },
];
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const test of corruptions) for (const scenario of ['initial', 'poll', 'committed', 'uncommitted']) {
    const seeded = await seed(test.stage, test.stage === 'adult');
    const v = await view(modes[['initial', 'committed'].includes(scenario) ? 1 : 0]);
    try {
      const writing = ['committed', 'uncommitted'].includes(scenario);
      let badVisit = scenario === 'initial', badState = false, badWrite = writing;
      await v.page.route('**/api/*', async route => {
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
  for (const growth of ['absent', 'null', 'null-record', 'valid-record']) {
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
  for (const stage of ['baby', 'growing', 'adult']) for (const kind of ['feed', 'clean']) for (const initial of [.4, 1.2]) {
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
      await key(v, 'b'); await v.page.locator('.care-learning').waitFor();
      const expectedGain = (initial + 1) - initial;
      assert.equal(acknowledged.careFeedback.habitGain, expectedGain);
      assert.equal(acknowledged.careFeedback.reason, 'credited');
      const label = kind === 'feed' ? '喂食习惯' : '清洁习惯';
      assert((await v.page.locator('.growth-feedback.has-feedback strong').innerText()).endsWith(label + ' +1'));
      assert((await v.page.locator('.care-learning').innerText()).includes(label + '：+1'));
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
  for (const feedback of ['absent', 'null']) {
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
  await writeFile(join(artifacts, 'growth-response-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
