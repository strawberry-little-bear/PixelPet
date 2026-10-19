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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-growth-basis-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts), 'PIXELPET_TEST_ARTIFACTS must be absolute.');
await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;
const expected = { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 };
const results = [];
let server, browser, startupError, log = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function seed(stage, sleeping) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    schema: 1, revision: 1, species: 2, name: '慢慢长大', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping,
    careCount: 0, logs: [], needs: { hunger: 60, mood: 80, clean: 60, energy: 40 },
  }) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply));
  assert.equal(reply.state.growth.stage, stage); assert.equal(reply.state.sleeping, sleeping);
  assert.deepEqual(reply.careRules.growth, expected);
}
async function key(page, key) { await page.locator('.button-' + key + ':not(:disabled)').tap(); }
async function open(page) { await key(page, 'a'); for (let i = 0; i < 6; i++) await key(page, 'a'); await key(page, 'b'); for (let i = 0; i < 4; i++) await key(page, 'b'); }
async function inspect(page, mode) {
  const layout = await page.evaluate(() => {
    const parent = document.querySelector('.lcd-content').getBoundingClientRect();
    const texts = [...document.querySelectorAll('.growth-basis, .growth-basis h4, .growth-basis p')];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      inside: texts.every(e => { const r = e.getBoundingClientRect(); return r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1; }),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      textSize: Math.min(...texts.slice(1).map(e => parseFloat(getComputedStyle(e).fontSize))),
      minKey: Math.min(...[...document.querySelectorAll('.physical-button')].map(e => Math.min(e.offsetWidth, e.offsetHeight))),
    };
  });
  assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.equal(layout.inside, true, JSON.stringify(layout));
  assert(layout.textSize >= layout.rootSize * .85 && layout.minKey >= 44, JSON.stringify(layout));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.growth-page-dots').textContent(), '5 / 6');
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
  const modes = [
    { label: 'normal', width: 390, height: 844, font: 14 },
    { label: 'large', width: 320, height: 568, font: 28 },
  ];
  const cases = [];
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const mode of modes) cases.push({ stage, sleeping, mode, metadata: 'real' });
  for (const metadata of ['old-server', 'missing-growth', 'invalid-growth']) for (const stage of ['baby', 'adult']) cases.push({ stage, sleeping: true, mode: modes[1], metadata });
  for (const test of cases) {
    await seed(test.stage, test.sleeping);
    const ctx = await browser.newContext({ viewport: { width: test.mode.width, height: test.mode.height }, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage(), writes = [], errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', req => { if (['/api/action', '/api/reset', '/api/import', '/api/recap/read'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), test.mode.font);
      if (test.metadata !== 'real') {
        const change = async route => {
          const response = await route.fetch(), reply = await response.json();
          if (test.metadata === 'old-server') delete reply.careRules;
          else if (test.metadata === 'missing-growth') delete reply.careRules.growth;
          else reply.careRules.growth.restEnergyPerHabit = 0;
          await route.fulfill({ response, json: reply });
        };
        await page.route('**/api/state', change); await page.route('**/api/visit', change);
      }
      await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
      const basis = page.getByRole('region', { name: '成长与照顾基准', exact: true });
      const text = await basis.textContent();
      if (test.metadata !== 'real') {
        assert(text.includes('成长基准尚未读到')); assert(!/0\.5|0\.75|28|0\.25/.test(text));
      } else {
        assert(text.includes('每实际恢复 28 点体力')); assert(text.includes('1 点休息习惯'));
        if (test.stage === 'adult') { assert(text.includes('成长已完成，不再增加成长点')); assert(!/0\.5|0\.75|\+0\.25/.test(text)); }
        else { assert(text.includes('0.5 + 0.75 × 舒适比例')); assert(text.includes('随状态变化累计')); assert(text.includes('+0.25 成长点')); }
      }
      assert(text.includes('入睡本身不送体力或成长点'));
      const layout = await inspect(page, test.mode.label);
      if (test.stage === 'growing' && test.metadata === 'real' && test.sleeping === (test.mode.label === 'large')) await page.screenshot({ path: join(artifacts, `growth-basis-${test.mode.label}.png`), fullPage: true });
      await key(page, 'a'); assert.equal(await page.locator('.growth-basis').count(), 0);
      await key(page, 'b'); assert.equal(await page.locator('.growth-page-dots').textContent(), '1 / 6');
      await key(page, 'c'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const state = (await (await fetch(base + '/api/state')).json()).state;
      assert.equal(state.growth.stage, test.stage); assert.equal(state.sleeping, test.sleeping); assert.equal(state.careCount, 0); assert.equal(state.schema, 12);
      const backup = await (await fetch(base + '/api/backup')).text();
      assert(!/basePerHour|restEnergyPerHabit|careRules/.test(backup));
      results.push({ stage: test.stage, sleeping: test.sleeping, metadata: test.metadata, layout, writeCount: writes.length });
      console.log('PASS', results.length, test.stage, test.sleeping, test.metadata, test.mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'growth-basis-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
