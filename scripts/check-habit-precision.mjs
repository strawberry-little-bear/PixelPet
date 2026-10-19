// Optional real-Chrome acceptance. Own temporary save/server only; never targets a player's URL.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-habit-precision-'));
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
async function importState(state) {
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply)); return reply.state;
}
async function seed(stage, profile) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const state = await importState({ schema: 1, revision: 1, species: 2, name: '一点点休息', createdAt: now - age, hatchedAt: now - age, lastTick: now,
    sleeping: profile.includes('sleep') || profile === 'natural', careCount: 0, logs: [], needs: { hunger: 60, mood: 80, clean: 60, energy: profile === 'natural' ? 40 : 100 } });
  // Valid portable fixtures, isolated from the player's save. Fractional legacy
  // habits are permitted; decision-time evidence must agree with the fixed form.
  const g = state.growth;
  g.care = { ...g.care, nutrition: 0, play: 0, clean: 0, rest: profile.startsWith('tiny') ? .02 : 0 };
  if (profile === 'record') {
    g.care = { ...g.care, nutrition: 10, play: 99, clean: 90, rest: 90 };
    g.trackedHours = 1; g.wellbeing = .8;
    g.formRecord = { trackedHours: .5, wellbeing: .4, nutrition: .02, play: .02, clean: .02, rest: .02 };
  }
  const saved = await importState(state);
  assert.equal(saved.growth.stage, stage); assert.equal(saved.careCount, 0);
  if (profile === 'natural') await wait(1100); // Real elapsed recovery, not a fast-forwarded browser clock.
  return saved;
}
async function key(page, key) { await page.locator('.button-' + key + ':not(:disabled)').tap(); }
async function open(page) { await key(page, 'a'); for (let i = 0; i < 6; i++) await key(page, 'a'); await key(page, 'b'); await key(page, 'b'); }
async function inspect(page, mode) {
  const layout = await page.evaluate(() => {
    const lcd = document.querySelector('.lcd-content').getBoundingClientRect();
    const targets = [...document.querySelectorAll('.habit-rows b,.habit-precision-note,.form-guide-record,.form-record-care')];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      inside: targets.every(el => { const r = el.getBoundingClientRect(); return r.left >= lcd.left - 1 && r.right <= lcd.right + 1 && r.top >= lcd.top - 1 && r.bottom <= lcd.bottom + 1; }),
      textSize: Math.min(...targets.map(el => parseFloat(getComputedStyle(el).fontSize))),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      minKey: Math.min(...[...document.querySelectorAll('.physical-button')].map(el => Math.min(el.offsetWidth, el.offsetHeight))),
    };
  });
  assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.equal(layout.inside, true, JSON.stringify(layout));
  assert(layout.textSize >= layout.rootSize * .85 && layout.minKey >= 44, JSON.stringify(layout));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  return { mode, ...layout };
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stderr.on('data', data => { log += data; }); server.stdout.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, 'Own test server did not start: ' + log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ label: 'normal', width: 390, height: 844, font: 14 }, { label: 'large', width: 320, height: 568, font: 28 }];
  const cases = [];
  for (const stage of ['baby', 'growing', 'adult']) for (const profile of ['tiny-awake', 'tiny-sleep', 'zero', 'natural']) for (const mode of modes) cases.push({ stage, profile, mode });
  for (const mode of modes) cases.push({ stage: 'adult', profile: 'record', mode });
  for (const test of cases) {
    const seeded = await seed(test.stage, test.profile);
    const ctx = await browser.newContext({ viewport: { width: test.mode.width, height: test.mode.height }, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage(), writes = [], errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', req => { if (['/api/action', '/api/reset', '/api/import', '/api/recap/read'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), test.mode.font);
      await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
      const values = await page.locator('.habit-rows b').allTextContents();
      assert.equal(values[3], test.profile === 'zero' ? '0.0' : test.profile === 'record' ? '90.0' : '<0.1');
      assert.equal(await page.locator('.habit-precision-note').count(), ['zero', 'record'].includes(test.profile) ? 0 : 1);
      const habitsLayout = await inspect(page, test.mode.label);
      if (test.profile === 'natural' && test.stage === 'growing') await page.screenshot({ path: join(artifacts, `habit-precision-${test.mode.label}.png`), fullPage: true });
      await key(page, 'a'); assert.equal(await page.locator('.growth-page-dots').textContent(), '3 / 6');
      const evidence = await page.locator('.form-guide-record').textContent();
      assert(evidence.includes(test.profile === 'record' ? '定型时陪玩 <0.1 · 恬静分 <0.1' : `当前陪玩 0.0 · 恬静分 ${test.profile === 'zero' ? '0.0' : '<0.1'}`), evidence);
      if (test.profile === 'record') {
        assert.equal(await page.locator('.form-record-care').textContent(), '当时喂食 <0.1 · 清洁 <0.1 · 休息 <0.1');
        assert((await page.locator('.form-guide-note').textContent()).includes('定型时保存的记录'));
        if (test.mode.label === 'large') await page.screenshot({ path: join(artifacts, 'habit-precision-record-large.png'), fullPage: true });
      } else if (test.stage === 'adult') assert.equal(await page.locator('.form-record-missing').count(), 1);
      const evidenceLayout = await inspect(page, test.mode.label);
      await key(page, 'b'); assert.equal(await page.locator('.growth-page-dots').textContent(), '4 / 6'); assert.equal(await page.locator('.habit-precision-note').count(), 0);
      await key(page, 'c'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await (await fetch(base + '/api/state')).json()).state;
      assert.equal(after.growth.stage, test.stage); assert.equal(after.growth.form, seeded.growth.form); assert.equal(after.careCount, 0); assert.equal(after.schema, 13);
      assert.deepEqual(after.growth.formRecord, seeded.growth.formRecord);
      if (test.profile === 'natural') {
        assert(seeded.growth.care.rest >= 0 && seeded.growth.care.rest < .05); assert(after.needs.energy > seeded.needs.energy);
        assert(after.growth.care.rest > seeded.growth.care.rest && after.growth.care.rest < .05);
        if (test.stage !== 'adult') assert(after.growth.points > seeded.growth.points); else assert.equal(after.growth.points, 72);
      } else assert.equal(after.growth.care.rest, seeded.growth.care.rest);
      const backup = await (await fetch(base + '/api/backup')).json();
      assert.equal(backup.growth.care.rest, after.growth.care.rest); assert.deepEqual(backup.growth.formRecord, seeded.growth.formRecord);
      results.push({ stage: test.stage, profile: test.profile, rest: after.growth.care.rest, habitsLayout, evidenceLayout, writeCount: writes.length });
      console.log('PASS', results.length, test.stage, test.profile, test.mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'habit-precision-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
