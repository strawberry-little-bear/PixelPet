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
async function open(page) { await key(page, 'a'); for (let i = 0; i < 6; i++) await key(page, 'a'); await key(page, 'b'); }
async function inspect(page, mode, section = 'basis') {
  const layout = await page.evaluate(section => {
    const parent = document.querySelector('.lcd-content').getBoundingClientRect();
    const texts = [...document.querySelectorAll(section === 'sleep' ? '.care-preview, .care-preview p, .care-preview strong, .care-preview small' : section === 'snapshot' ? '.growth-current, .growth-current h4, .growth-current dt, .growth-current dd, .growth-current p' : '.growth-basis, .growth-basis h4, .growth-basis p')];
    const content = document.querySelector('.lcd-content'), walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT), ranges = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      ranges.push(...[...range.getClientRects()].filter(r => r.width && r.height));
    }
    return {
      textInside: ranges.every(r => r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      inside: texts.every(e => { const r = e.getBoundingClientRect(); return r.left >= parent.left - 1 && r.right <= parent.right + 1 && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1; }),
      rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      textSize: Math.min(...texts.slice(1).map(e => parseFloat(getComputedStyle(e).fontSize))),
      minKey: Math.min(...[...document.querySelectorAll('.physical-button')].map(e => Math.min(e.offsetWidth, e.offsetHeight))),
    };
  }, section);
  assert.equal(layout.textInside, true, JSON.stringify(layout)); assert.equal(layout.overflow, false, JSON.stringify(layout)); assert.equal(layout.inside, true, JSON.stringify(layout));
  assert(layout.textSize >= layout.rootSize * .85 && layout.minKey >= 44, JSON.stringify(layout));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  if (section !== 'sleep') assert.equal(await page.locator('.growth-page-dots').textContent(), section === 'snapshot' ? '1 / 6' : '5 / 6');
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
  for (const metadata of ['old-server', 'missing-growth', 'invalid-growth']) for (const stage of ['baby', 'adult']) for (const sleeping of [false, true]) cases.push({ stage, sleeping, mode: modes[1], metadata });
  for (const stage of ['baby', 'growing', 'adult']) cases.push({ stage, sleeping: false, mode: modes[1], metadata: 'custom' });
  for (const test of cases) {
    await seed(test.stage, test.sleeping);
    const ctx = await browser.newContext({ viewport: { width: test.mode.width, height: test.mode.height }, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage(), writes = [], errors = [], snapshots = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', req => { if (['/api/action', '/api/reset', '/api/import', '/api/recap/read'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), test.mode.font);
      {
        const change = async route => {
          const response = await route.fetch(), reply = await response.json();
          if (test.metadata === 'old-server') delete reply.careRules;
          else if (test.metadata === 'missing-growth') delete reply.careRules.growth;
          else if (test.metadata === 'custom') Object.assign(reply.careRules.growth, { basePerHour: .2, comfortPerHour: .4, restEnergyPerHabit: 20, restPointsPerHabit: .2 });
          else if (test.metadata === 'invalid-growth') reply.careRules.growth.restEnergyPerHabit = 0;
          snapshots.push(structuredClone(reply));
          await route.fulfill({ response, json: reply });
        };
        await page.route('**/api/state', change); await page.route('**/api/visit', change);
      }
      await page.goto(base); await page.locator('.home-caption').waitFor();
      // Only select and cancel sleep: browsing must not toggle sleep or award recovery.
      await key(page, 'a'); for (let i = 0; i < 3; i++) await key(page, 'a');
      const menuText = await page.getByRole('note', { name: '所选菜单说明', exact: true }).textContent();
      const valid = ['real', 'custom'].includes(test.metadata);
      const energy = test.metadata === 'custom' ? 20 : 28;
      const reward = test.metadata === 'custom' ? '0.2' : '0.25';
      if (test.sleeping) {
        assert(menuText.includes('按 B 轻轻叫醒')); assert(menuText.includes('不因反复睡下或叫醒多记'));
        assert(!/28|20 体力|成长 \+/.test(menuText));
      } else if (!valid) {
        assert(menuText.includes('成长基准尚未读到')); assert(!/28|0\.25|习惯 \+1|成长 \+/.test(menuText));
      } else {
        assert(menuText.includes(`每恢复 ${energy} 体力，休息习惯 +1`));
        if (test.stage === 'adult') { assert(menuText.includes('成年形态不变')); assert(!menuText.includes('成长 +')); }
        else assert(menuText.includes(`成长 +${reward}；按实际恢复比例记录`));
        if (test.metadata === 'custom') assert(!/28|0\.25/.test(menuText));
      }
      const menuLayout = await inspect(page, test.mode.label, 'sleep');
      if (test.stage === 'growing' && !test.sleeping && test.metadata === 'real') await page.screenshot({ path: join(artifacts, `sleep-basis-${test.mode.label}.png`), fullPage: true });
      await key(page, 'c'); await page.locator('.home-caption').waitFor(); await open(page);
      const current = await page.getByRole('region', { name: '此刻状态与成长', exact: true }).innerText();
      const recent = snapshots.at(-1), needs = recent.state.needs;
      const comfort = (needs.hunger + needs.mood + needs.clean + needs.energy) / 400;
      assert(current.includes(`${(comfort * 100).toFixed(1)}%`));
      assert(current.includes('不是历史平均'));
      if (test.stage === 'adult') { assert(current.includes('成年不再增加成长点')); assert(!current.includes('点/小时')); }
      else if (!valid) { assert(current.includes('成长基准尚未读到')); assert(!current.includes('点/小时')); }
      else {
        const g = recent.careRules.growth;
        assert(current.includes(`${(g.basePerHour + g.comfortPerHour * comfort).toFixed(2)} 点/小时`));
        assert(current.includes('不含睡眠额外成长或照顾奖励')); assert(current.includes('不是下一小时的预测'));
      }
      const snapshotLayout = await inspect(page, test.mode.label, 'snapshot');
      if (test.stage === 'growing' && test.metadata === 'real' && test.sleeping === (test.mode.label === 'large')) await page.screenshot({ path: join(artifacts, `growth-snapshot-${test.mode.label}.png`), fullPage: true });
      for (let i = 0; i < 4; i++) await key(page, 'b');
      const basis = page.getByRole('region', { name: '成长与照顾基准', exact: true });
      const text = await basis.textContent();
      if (!valid) {
        assert(text.includes('成长基准尚未读到')); assert(!/0\.5|0\.75|28|0\.25/.test(text));
      } else {
        assert(text.includes(`每实际恢复 ${energy} 点体力`)); assert(text.includes('1 点休息习惯'));
        if (test.stage === 'adult') { assert(text.includes('成长已完成，不再增加成长点')); assert(!/0\.5|0\.75|\+0\.25/.test(text)); }
        else { assert(text.includes(test.metadata === 'custom' ? '0.2 + 0.4 × 舒适比例' : '0.5 + 0.75 × 舒适比例')); assert(text.includes('随状态变化累计')); assert(text.includes(`+${reward} 成长点`)); }
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
      results.push({ stage: test.stage, sleeping: test.sleeping, metadata: test.metadata, menuLayout, snapshotLayout, layout, writeCount: writes.length });
      console.log('PASS', results.length, test.stage, test.sleeping, test.metadata, test.mode.label);
    } finally { await ctx.close(); }
  }
  // Real three-key care, unlike the read-only metadata/display cases above.
  for (const stage of ['baby', 'growing', 'adult']) for (const mode of modes) {
    await seed(stage, false);
    const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    try {
      const page = await ctx.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', req => { const p = new URL(req.url()).pathname; if (['/api/action', '/api/reset', '/api/import', '/api/recap/read'].includes(p)) writes.push(p); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const before = (await (await fetch(base + '/api/state')).json()).state;
      await open(page);
      assert((await page.getByLabel('此刻状态与成长').innerText()).includes('60.0%'));
      let after = before, snapshotLayout;
      for (const kind of ['feed', 'clean']) {
        await key(page, 'c'); await page.locator('.home-caption').waitFor(); await key(page, 'a');
        if (kind === 'clean') { await key(page, 'a'); await key(page, 'a'); }
        const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST'), key(page, 'b')]);
        assert(response.ok()); const result = await response.json(); after = result.state;
        assert.equal(result.careFeedback.kind, kind); assert.equal(result.careFeedback.reason, 'credited');
        assert.equal(result.careFeedback.points, stage === 'adult' ? 0 : .25);
        await page.locator('.home-caption').waitFor(); await open(page);
        const text = await page.getByLabel('此刻状态与成长').innerText();
        const n = after.needs, comfort = (n.hunger + n.mood + n.clean + n.energy) / 400;
        assert(text.includes(`${(comfort * 100).toFixed(1)}%`));
        if (stage === 'adult') { assert(text.includes('成年不再增加成长点')); assert(!text.includes('点/小时')); }
        else assert(text.includes(`${(result.careRules.growth.basePerHour + result.careRules.growth.comfortPerHour * comfort).toFixed(2)} 点/小时`));
        snapshotLayout = await inspect(page, mode.label, 'snapshot');
      }
      assert.equal(after.careCount, before.careCount + 2); assert.equal(after.growth.care.nutrition, before.growth.care.nutrition + 1);
      assert.equal(after.growth.care.clean, before.growth.care.clean + 1); assert.equal(after.economy.coins, before.economy.coins);
      if (stage === 'adult') { assert.equal(after.growth.points, 72); assert.equal(after.growth.form, before.growth.form); }
      assert.deepEqual(writes, ['/api/action', '/api/action']); assert.deepEqual(errors, []);
      if (stage === 'growing') await page.screenshot({ path: join(artifacts, `growth-snapshot-care-${mode.label}.png`), fullPage: true });
      await key(page, 'c'); await page.locator('.home-caption').waitFor();
      const final = (await (await fetch(base + '/api/state')).json()).state;
      assert.equal(final.careCount, after.careCount); assert.equal(final.economy.coins, after.economy.coins);
      results.push({ stage, scenario: 'real-feed-clean', mode: mode.label, snapshotLayout, writeCount: writes.length });
      console.log('PASS', results.length, stage, 'real-feed-clean', mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'growth-basis-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
