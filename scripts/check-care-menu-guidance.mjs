// Isolated Chrome reading check: real legacy imports for needs; response-only
// fixtures for exact full energy (awake decay would otherwise move below 100).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-menu-guidance-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const p = socket.address().port;
    socket.close(error => error ? reject(error) : resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, log = '', startupError;
async function key(page, k) {
  await page.locator(`.button-${k}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function select(page, index) {
  await key(page, 'a');
  for (let i = 0; i < index; i++) await key(page, 'a');
}
async function readable(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const errors = await page.locator(selector).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('clipped: ' + text.textContent);
        }
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], 'clipped reading text');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [
    { label: 'desktop', width: 1280, height: 900, font: 14 },
    { label: 'phone-large', width: 320, height: 568, font: 28 },
    { label: 'contrast-large', width: 320, height: 568, font: 28, forcedColors: 'active' },
  ];
  const profiles = [
    { label: 'hungry', need: 'hunger', menu: '吃点东西', index: 0 },
    { label: 'dirty', need: 'clean', menu: '洗个澡澡', index: 2 },
    { label: 'tired', need: 'energy', menu: '睡个好觉', index: 3 },
    { label: 'playful', need: 'mood', menu: '一起玩耍', index: 1 },
    { label: 'sleep-hungry', need: 'hunger', menu: '吃点东西', index: 0, sleeping: true },
    { label: 'sleep-dirty', need: 'clean', menu: '洗个澡澡', index: 2, sleeping: true },
    { label: 'full-energy', menu: '睡个好觉', index: 3, full: true },
  ];
  for (const stage of ['baby', 'growing', 'adult']) for (const mode of modes) for (const profile of profiles) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    const needs = { hunger: 80, mood: 80, clean: 80, energy: 80 };
    if (profile.need) needs[profile.need] = 10;
    const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      schema: 1, revision: 1, species: 2, name: '照顾伙伴', createdAt: at - age, hatchedAt: at - age, lastTick: at,
      sleeping: !!profile.sleeping, needs, careCount: 0, logs: [],
    }) });
    const imported = await response.json(); assert(response.ok, JSON.stringify(imported)); assert.equal(imported.state.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: mode.width === 320, hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.forcedColors || 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path !== '/api/visit') writes.push(path);
      });
      if (profile.full) await page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (reply.state) reply.state.needs.energy = 100;
        await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      if (!profile.full) {
        await select(page, 4); await key(page, 'b');
        const advice = page.getByLabel('照顾建议'); await advice.waitFor();
        const text = await advice.innerText();
        assert(text.includes(profile.sleeping ? `先从菜单选「起床啦」，再选「${profile.menu}」` : `从菜单选「${profile.menu}」`));
        await readable(page, '[aria-label="照顾建议"]');
        if (stage === 'baby' && profile.label === 'sleep-dirty') await page.screenshot({ path: join(dir, `sleep-advice-${mode.label}.png`), fullPage: true });
        await key(page, 'c');
      }
      await select(page, profile.index);
      assert((await page.locator('.care-item.selected').innerText()).includes(profile.menu));
      const preview = await page.getByLabel('所选菜单说明').innerText();
      await readable(page, '[aria-label="所选菜单说明"]');
      if (profile.sleeping) {
        assert(preview.includes(`先选「起床啦」叫醒，再选「${profile.menu}」`));
        for (let i = profile.index; i < 3; i++) await key(page, 'a');
        assert((await page.locator('.care-item.selected').innerText()).includes('起床啦'));
        assert((await page.getByLabel('所选菜单说明').innerText()).includes('按 B 轻轻叫醒'));
      }
      if (profile.full) { assert(preview.includes('饱食和清洁仍会下降')); assert(preview.includes('不增加休息习惯')); }
      await readable(page, '.care-menu'); await readable(page, '[aria-label="所选菜单说明"]');
      if (stage === 'baby' && ['full-energy', 'sleep-dirty'].includes(profile.label)) await page.screenshot({ path: join(dir, `${profile.label}-${mode.label}.png`), fullPage: true });
      assert.deepEqual(writes, [], 'reading guidance must not issue a care write'); assert.deepEqual(errors, []);
      results.push({ stage, mode: mode.label, profile: profile.label, fixture: !!profile.full });
      console.log('PASS', results.length, stage, mode.label, profile.label);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
