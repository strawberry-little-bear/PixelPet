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
assert(binary && isAbsolute(binary) && resolve(binary) !== join(root, 'bin/pixelpet'), 'Set absolute PIXELPET_TEST_BINARY to an isolated binary');
assert(web && isAbsolute(web) && resolve(web) !== join(root, 'web/dist'), 'Set absolute PIXELPET_TEST_WEB to an isolated build');
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
    { label: 'short-large', width: 320, height: 380, font: 28 },
  ];
  const profiles = [
    { label: 'hungry', need: 'hunger', menu: '吃点东西', index: 0 },
    { label: 'dirty', need: 'clean', menu: '洗个澡澡', index: 2 },
    { label: 'tired', need: 'energy', menu: '睡个好觉', index: 3 },
    { label: 'playful', need: 'mood', menu: '一起玩耍', index: 1 },
    { label: 'sleep-hungry', need: 'hunger', menu: '吃点东西', index: 0, sleeping: true },
    { label: 'sleep-dirty', need: 'clean', menu: '洗个澡澡', index: 2, sleeping: true },
    { label: 'full-energy', menu: '睡个好觉', index: 3, full: true, advice: '现在很舒适' },
    { label: 'quiet', menu: '一起玩耍', index: 1, needs: { mood: 10, energy: 43 }, advice: '可以安静陪伴' },
    { label: 'comfortable', menu: '吃点东西', index: 0, advice: '现在很舒适' },
    { label: 'sleeping', menu: '起床啦', index: 3, sleeping: true, advice: '正在休息，不必急着叫醒' },
    { label: 'sleep-full', menu: '起床啦', index: 3, sleeping: true, full: true, advice: '体力已满，可以从菜单选「起床啦」' },
  ];
  for (const stage of ['baby', 'growing', 'adult']) for (const mode of modes) for (const profile of profiles) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    const needs = { hunger: 80, mood: 80, clean: 80, energy: 80 };
    if (profile.need) needs[profile.need] = 10;
    Object.assign(needs, profile.needs);
    const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      schema: 1, revision: 1, species: 2, name: '照顾伙伴', createdAt: at - age, hatchedAt: at - age, lastTick: at,
      sleeping: !!profile.sleeping, needs, careCount: 0, logs: [],
    }) });
    const expectedAdvice = profile.advice ?? (profile.sleeping ? `先从菜单选「起床啦」，再选「${profile.menu}」` : `从菜单选「${profile.menu}」`);
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
        assert(text.includes(expectedAdvice));
        await readable(page, '[aria-label="照顾建议"]');
        if (stage === 'baby' && profile.label === 'sleep-dirty') await page.screenshot({ path: join(dir, `sleep-advice-${mode.label}.png`), fullPage: true });
        await key(page, 'c');
      }
      await select(page, profile.index);
      assert((await page.locator('.care-item.selected').innerText()).includes(profile.menu));
      const preview = await page.getByLabel('所选菜单说明').innerText();
      await readable(page, '[aria-label="所选菜单说明"]');
      if (profile.sleeping && profile.need) {
        assert(preview.includes(`先选「起床啦」叫醒，再选「${profile.menu}」`));
        for (let i = profile.index; i < 3; i++) await key(page, 'a');
        assert((await page.locator('.care-item.selected').innerText()).includes('起床啦'));
        assert((await page.getByLabel('所选菜单说明').innerText()).includes('按 B 轻轻叫醒'));
      }
      if (profile.full && !profile.sleeping) { assert(preview.includes('饱食和清洁仍会下降')); assert(preview.includes('不增加休息习惯')); }
      const menuAdvice = page.locator('.care-menu-advice');
      await menuAdvice.waitFor({ timeout: 3000 });
      assert((await menuAdvice.innerText()).includes('现在怎么照顾 · 最近读取'));
      assert((await menuAdvice.innerText()).includes(expectedAdvice));
      await readable(page, '.care-menu-advice');
      const layout = await page.evaluate(() => {
        const menu = document.querySelector('.care-menu').getBoundingClientRect();
        const advice = document.querySelector('.care-menu-advice').getBoundingClientRect();
        const preview = document.querySelector('.care-preview').getBoundingClientRect();
        return { menuEnd: menu.bottom, adviceTop: advice.top, adviceEnd: advice.bottom, previewTop: preview.top,
          font: parseFloat(getComputedStyle(document.querySelector('.care-menu-advice .care-advice')).fontSize),
          readingFont: parseFloat(getComputedStyle(document.querySelector('.lcd-content')).fontSize) };
      });
      assert(layout.menuEnd <= layout.adviceTop + 1 && layout.adviceEnd <= layout.previewTop + 1, 'menu/advice/preview overlap');
      assert.equal(layout.font, layout.readingFont, 'advice must retain reading font size');
      // Native document scrolling reaches the whole note and then the keys;
      // this does not add a clickable LCD control or move the selected item.
      const selectedBefore = await page.locator('.care-item.selected').innerText();
      await menuAdvice.scrollIntoViewIfNeeded();
      if (stage === 'baby' && ['sleep-dirty', 'comfortable'].includes(profile.label)) await page.screenshot({ path: join(dir, `menu-advice-${profile.label}-${mode.label}.png`), fullPage: true });
      await page.locator('.button-c').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.care-item.selected').innerText(), selectedBefore);
      await page.reload(); await page.locator('.home-caption').waitFor();
      await key(page, 'b');
      assert((await page.locator('.care-menu-advice').innerText()).includes(expectedAdvice), 'refresh lost saved advice');
      assert((await page.locator('.care-item.selected').innerText()).includes('吃点东西'), 'advice must not auto-select an action');
      await readable(page, '.care-menu'); await readable(page, '[aria-label="所选菜单说明"]');
      if (stage === 'baby' && ['full-energy', 'sleep-dirty'].includes(profile.label)) await page.screenshot({ path: join(dir, `${profile.label}-${mode.label}.png`), fullPage: true });
      assert.deepEqual(writes, [], 'reading guidance must not issue a care write');
      let explicitFeed = false;
      if (profile.label === 'tired') {
        // Deliberately choose feed even though rest is recommended: only B's
        // actual selected action may be submitted; advice is never automation.
        const acknowledgement = page.waitForResponse(res => new URL(res.url()).pathname === '/api/action' && res.request().method() === 'POST');
        await key(page, 'b');
        const res = await acknowledgement, reply = await res.json();
        assert(res.ok(), JSON.stringify(reply));
        assert.equal(reply.state.sleeping, false, 'recommendation executed instead of selected feed');
        assert.equal(reply.state.careCount, 1);
        assert.equal(reply.careFeedback.kind, 'feed');
        assert.equal(reply.careFeedback.habitGain, 0, 'already satisfied food must not credit a habit');
        assert.equal(reply.careFeedback.points, 0);
        assert.deepEqual(writes, ['/api/action']);
        const persisted = await (await fetch(base + '/api/state')).json();
        assert.equal(persisted.state.careCount, 1);
        assert.equal(persisted.state.sleeping, false);
        assert.equal(persisted.state.growth.care.nutrition, 0);
        explicitFeed = true;
      }
      assert.deepEqual(errors, []);
      results.push({ stage, mode: mode.label, profile: profile.label, fixture: !!profile.full, explicitFeed });
      console.log('PASS', results.length, stage, mode.label, profile.label);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
