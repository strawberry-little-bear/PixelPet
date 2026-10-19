// Optional real-Chrome regression. Never accepts a player's URL or database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set PIXELPET_TEST_BINARY to an absolute freshly built binary.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-sleep-feedback-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
let server, browser, startupError, log = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function seed(stage, full) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    schema: 1, revision: 1, species: 2, name: '睡个好觉', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    careCount: 0, logs: [], needs: { hunger: 60, mood: 80, clean: 60, energy: full ? 100 : 40 },
  }) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply)); assert.equal(reply.state.growth.stage, stage); return reply.state;
}
async function key(page, key) { await page.locator('.button-' + key + ':not(:disabled)').tap(); }
async function selectSleep(page) { await key(page, 'a'); for (let i = 0; i < 3; i++) await key(page, 'a'); }
async function inspect(page, mode) {
  const layout = await page.evaluate(() => {
    const content = document.querySelector('.lcd-content'), parent = content.getBoundingClientRect();
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT), ranges = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      ranges.push(...[...range.getClientRects()].filter(r => r.width && r.height));
    }
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      textInside: ranges.every(r => r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      textSize: Math.min(...[...document.querySelectorAll('.growth-feedback strong,.growth-feedback small')].map(e => parseFloat(getComputedStyle(e).fontSize))),
      minKey: Math.min(...[...document.querySelectorAll('.physical-button')].map(e => Math.min(e.offsetWidth, e.offsetHeight))),
    };
  });
  assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.equal(layout.textInside, true, JSON.stringify(layout));
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
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ label: 'normal', width: 390, height: 844, font: 14 }, { label: 'large', width: 320, height: 568, font: 28 }];
  const cases = [];
  for (const stage of ['baby', 'growing', 'adult']) for (const mode of modes) for (const profile of ['real', 'custom', 'full']) cases.push({ stage, mode, profile });
  for (const stage of ['baby', 'growing', 'adult']) for (const profile of ['old-server', 'missing-growth', 'invalid-growth', 'no-record', 'zero']) cases.push({ stage, mode: modes[1], profile });
  for (const { stage, mode, profile } of cases) {
    const before = await seed(stage, profile === 'full');
    const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await ctx.newPage(), writes = [], visits = [], errors = [], actions = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST') { const path = new URL(r.url()).pathname; (path === '/api/visit' ? visits : writes).push(path); } });
      // Only the action response is altered: earlier previews deliberately retain
      // the real default basis. Actual backend rules and persisted data stay real.
      await page.route('**/api/action', async route => {
        const response = await route.fetch(), reply = await response.json(); actions.push(structuredClone(reply));
        if (profile === 'custom') Object.assign(reply.careRules.growth, { restEnergyPerHabit: 20, restPointsPerHabit: .2 });
        if (profile === 'old-server') delete reply.careRules;
        if (profile === 'missing-growth') delete reply.careRules.growth;
        if (profile === 'invalid-growth') reply.careRules.growth.restEnergyPerHabit = 0;
        if (profile === 'no-record') delete reply.state.growth;
        if (profile === 'zero') reply.careRules.growth.restPointsPerHabit = 0;
        await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await selectSleep(page);
      assert((await page.getByLabel('所选菜单说明').innerText()).includes('每恢复 28'));
      const bedtime = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST');
      await key(page, 'b'); await bedtime;
      const status = page.locator('.growth-feedback[data-feedback="resting"]'); await status.waitFor();
      const text = await status.innerText(), reply = actions[0];
      assert.equal(reply.careFeedback.reason, 'resting'); assert.equal(reply.careFeedback.points, 0); assert.equal(reply.careFeedback.habitGain, 0);
      assert.equal(reply.state.sleeping, true); assert.equal(reply.state.growth.care.rest, before.growth.care.rest);
      assert(reply.state.needs.energy <= before.needs.energy); assert.equal(reply.state.careCount, before.careCount);
      if (profile === 'no-record') { assert(text.includes('成长记录尚未读到')); assert(!/28|0\.25|成长 \+|成年/.test(text)); }
      else if (['old-server', 'missing-growth', 'invalid-growth'].includes(profile)) {
        assert(text.includes('成长基准尚未读到')); assert(!/28|0\.25|习惯 \+1|成长 \+/.test(text));
        if (stage === 'adult') assert(text.includes('成年形态不变'));
      } else {
        assert(text.includes(`每恢复 ${profile === 'custom' ? 20 : 28} 体力，休息习惯 +1`));
        if (stage === 'adult') { assert(text.includes('成年形态不变')); assert(!text.includes('成长 +')); }
        else { assert(text.includes(`成长 +${profile === 'custom' ? .2 : profile === 'zero' ? 0 : .25}；按实际恢复比例记录`)); }
        if (profile === 'custom') assert(!/28|0\.25/.test(text));
      }
      const layout = await inspect(page, mode.label);
      if ((stage === 'growing' && ['real', 'custom'].includes(profile)) || (stage === 'adult' && profile === 'real')) {
        await page.screenshot({ path: join(artifacts, `sleep-feedback-${stage}-${profile}-${mode.label}.png`), fullPage: true });
      }
      await selectSleep(page);
      assert((await page.getByLabel('所选菜单说明').innerText()).includes('按 B 轻轻叫醒'));
      const wake = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST');
      await key(page, 'b'); await wake;
      await page.locator('.growth-feedback[data-feedback="awake"]').waitFor();
      const woke = actions[1];
      assert.equal(woke.state.sleeping, false); assert.equal(woke.careFeedback.reason, 'awake'); assert.equal(woke.careFeedback.points, 0); assert.equal(woke.careFeedback.habitGain, 0);
      assert(woke.state.growth.care.rest >= before.growth.care.rest); assert.equal(woke.state.careCount, before.careCount);
      assert.equal(woke.state.economy.coins, before.economy.coins);
      if (stage === 'adult') { assert.equal(woke.state.growth.points, 72); assert.equal(woke.state.growth.form, before.growth.form); }
      const wakeText = await page.locator('.growth-feedback[data-feedback="awake"]').innerText();
      assert(wakeText.includes('只按实际恢复')); assert(!/每恢复|成长 \+/.test(wakeText));
      assert.deepEqual(writes, ['/api/action', '/api/action']); assert(visits.length >= 1); assert.deepEqual(errors, []);
      results.push({ stage, mode: mode.label, profile, layout, writes: writes.length, readVisits: visits.length, restAtBedtime: reply.state.growth.care.rest, restAtWake: woke.state.growth.care.rest });
      console.log('PASS', results.length, stage, profile, mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'sleep-feedback-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
