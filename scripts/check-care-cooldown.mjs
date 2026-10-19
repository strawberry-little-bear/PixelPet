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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-cooldown-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
let server, browser, startupError, log = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function importState(state) {
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply)); return reply.state;
}
async function seed(stage) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const pet = await importState({ schema: 1, revision: 1, species: 2, name: '每次照顾都算数', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    careCount: 2, logs: [], needs: { hunger: 30, mood: 80, clean: 20, energy: 80 } });
  pet.growth.care.lastFeed = pet.growth.care.lastClean = now - 29 * 60000;
  pet.growth.care.nutrition = pet.growth.care.clean = 1;
  const seeded = await importState(pet); assert.equal(seeded.growth.stage, stage); return seeded;
}
async function key(page, key) { await page.locator('.button-' + key + ':not(:disabled)').tap(); }
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
  for (const stage of ['baby', 'growing', 'adult']) for (const kind of ['feed', 'clean']) for (const mode of modes) for (const cover of ['help', 'hidden']) cases.push({ stage, kind, mode, cover, profile: 'real', controlled: true });
  for (const stage of ['baby', 'adult']) for (const profile of ['no-effect', 'expired-retry']) cases.push({ stage, kind: 'feed', mode: modes[1], cover: 'help', profile, controlled: true });
  cases.push({ stage: 'adult', kind: 'clean', mode: modes[0], cover: 'help', profile: 'real-wait', controlled: false });
  for (const { stage, kind, mode, cover, profile, controlled } of cases) {
    const before = await seed(stage);
    const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(font => {
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; });
        // Visibility event fixture, not an operating-system tab switch.
        window.__testHidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testHidden });
      }, mode.font);
      const page = await ctx.newPage(), writes = [], visits = [], errors = [], actions = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST') { const path = new URL(r.url()).pathname; (path === '/api/visit' ? visits : writes).push(path); } });
      await page.route('**/api/action', async route => {
        const response = await route.fetch(), reply = await response.json(); actions.push(structuredClone(reply));
        if (profile === 'no-effect') delete reply.careFeedback.effect;
        if (profile === 'expired-retry') reply.careFeedback.retryAt = Date.now() - 60000;
        await route.fulfill({ response, json: reply });
      });
      if (controlled) await page.clock.install();
      await page.goto(base); await page.locator('.home-caption').waitFor();
      if (controlled) await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
      await key(page, 'a'); if (kind === 'clean') { await key(page, 'a'); await key(page, 'a'); }
      const action = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST');
      await key(page, 'b'); await action; await page.locator('.growth-feedback[data-feedback="cooldown"]').waitFor(); await key(page, 'c');
      const toast = page.locator('.growth-feedback[data-feedback="cooldown"]'), initial = await toast.innerText(), acknowledged = actions[0];
      assert(initial.includes('记录时同类习惯仍在间隔内')); assert(initial.includes('下次以实际结果为准')); assert(!/已结束|还需.*分钟|成长 \+/.test(initial));
      assert.equal(acknowledged.careFeedback.reason, 'cooldown'); assert.equal(acknowledged.careFeedback.points, 0); assert.equal(acknowledged.careFeedback.habitGain, 0);
      const habit = kind === 'feed' ? 'nutrition' : 'clean'; assert.equal(acknowledged.state.growth.care[habit], before.growth.care[habit]);
      assert(acknowledged.careFeedback.effect.after[kind === 'feed' ? 'hunger' : 'clean'] > acknowledged.careFeedback.effect.before[kind === 'feed' ? 'hunger' : 'clean']);
      const started = Date.now();
      if (cover === 'help') await page.getByRole('button', { name: '玩法说明' }).click();
      else await page.evaluate(() => { window.__testHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      if (controlled) await page.clock.fastForward(65000); else { console.log('WAIT real 65s', stage, kind); await wait(65000); }
      if (cover === 'help') await page.getByRole('button', { name: '关闭', exact: true }).click();
      else await page.evaluate(() => { window.__testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await toast.innerText(), initial);
      const layout = await inspect(page, mode.label);
      if (stage === 'baby' && kind === 'feed' && cover === 'help' && profile === 'real') await page.screenshot({ path: join(artifacts, 'care-cooldown-' + mode.label + '.png'), fullPage: true });
      if (profile === 'no-effect') assert.equal(await page.locator('.care-outcome').count(), 0);
      else assert((await page.locator('.care-learning').innerText()).includes('记录时同类习惯仍在间隔内'));
      if (controlled) { await page.clock.runFor(7999); assert.equal(await toast.count(), 1); await page.clock.runFor(1); assert.equal(await toast.count(), 0); }
      const read = await fetch(base + '/api/state'), current = (await read.json()).state;
      assert.equal(current.growth.care[habit], before.growth.care[habit]); assert.equal(current.careCount, acknowledged.state.careCount); assert.equal(current.economy.coins, before.economy.coins);
      if (stage === 'adult') { assert.equal(current.growth.points, 72); assert.equal(current.growth.form, before.growth.form); }
      if (!controlled) {
        assert(Date.now() - started >= 65000); assert(current.lastTick >= acknowledged.careFeedback.retryAt);
        // A fresh state can make the next action eligible; it must not rewrite the old reason.
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await key(page, 'a'); await key(page, 'a'); await key(page, 'a');
        assert((await page.getByLabel('所选菜单说明').innerText()).includes('符合记录习惯的条件'));
      }
      assert.deepEqual(writes, ['/api/action']); assert.deepEqual(errors, []);
      results.push({ stage, kind, mode: mode.label, cover, profile, controlled, realWaitMs: controlled ? null : Date.now() - started, writes: writes.length, readVisits: visits.length, layout }); console.log('PASS', results.length, stage, kind, mode.label, cover, profile);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'care-cooldown-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'port', port, 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
