// Return layout regression: own temporary database/server, never a player's URL.
// Historical metadata/error responses are intercepted fixtures, not a settlement test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-layout-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`; let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function review(page) { await key(page, 'a'); for (let i = 0; i < 7; i++) await key(page, 'a'); await key(page, 'b'); await page.locator('.return-panel').waitFor(); }
async function size(page) { return page.evaluate(() => Object.fromEntries(['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content'].map(s => [s, document.querySelector(s).getBoundingClientRect().height]))); }
async function sync(page) { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }
async function bottom(page) {
  const panel = page.locator('.return-panel'); await panel.focus(); await page.keyboard.press('End');
  // This helper tests settled reading; mid-animation replacement is covered
  // separately by check-return-scroll.mjs with strict per-frame zero assertions.
  await page.evaluate(() => { window.__bottomReading = null; });
  await page.waitForFunction(() => {
    const e = document.querySelector('.return-panel'), previous = window.__bottomReading;
    const top = e.scrollTop, nearBottom = Math.abs(e.scrollHeight - e.clientHeight - top) < 2;
    const stable = nearBottom && previous?.top === top ? previous.stable + 1 : 0;
    window.__bottomReading = { top, stable }; return stable >= 3;
  });
  const reading = await panel.evaluate(el => {
    const box = el.getBoundingClientRect(), header = el.querySelector('header').getBoundingClientRect(), last = el.lastElementChild.lastElementChild.getBoundingClientRect();
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, visible: last.bottom <= box.bottom + 1 && last.top >= header.bottom - 1, headerTop: header.top, panelTop: box.top, sticky: header.top >= box.top - 1 && header.top <= box.top + parseFloat(getComputedStyle(el).paddingTop) + 1 };
  });
  assert(reading.top > 0 && reading.visible && reading.sticky, JSON.stringify(reading));
  return reading;
}
async function textBounds(page) {
  return page.locator('.return-panel').evaluate(el => {
    const box = el.getBoundingClientRect(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let count = 0, inside = true;
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const r of range.getClientRects()) if (r.width && r.height) { count++; inside &&= r.left >= box.left - 1 && r.right <= box.right + 1; }
    }
    return { count, inside, overflow: el.scrollWidth > el.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 390, 320]) for (const font of [14, 28]) for (const sleeping of [false, true]) {
    const now = Date.now(), seed = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: 1, revision: 1, species: 2, name: '回访稳稳读', createdAt: now - 25 * 3600000, hatchedAt: now - 25 * 3600000, lastTick: now, sleeping, needs: { hunger: 30, mood: 80, clean: 20, energy: 50 }, careCount: 0, logs: [] }) });
    assert(seed.ok, await seed.text());
    const contrast = width === 320 && sleeping;
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, isMobile: width < 700, hasTouch: true, reducedMotion: 'reduce', forcedColors: contrast ? 'active' : 'none' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
      const page = await ctx.newPage(), writes = [], errors = []; let record = 'one', failure = '', reads = 0;
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      await page.route(/\/api\/(state|visit)$/, async route => {
        reads++;
        if (failure) return route.fulfill({ status: failure === 'offline' ? 503 : 409, contentType: 'application/json', json: { error: '隔离回归错误夹具', code: failure === 'clock' ? 'clock_ahead' : failure === 'corrupt' ? 'save_corrupt' : undefined } });
        const response = await route.fetch(), reply = await response.json();
        if (record) {
          const snapshot = { needs: { hunger: 34, mood: 80, clean: 41, energy: 100 }, stage: 'baby', form: '', points: 23.9, rest: 0, trackedHours: 1 };
          reply.returnRecap = { id: record, from: reply.serverTime - 48 * 3600000, to: reply.serverTime, before: snapshot, after: { ...snapshot, stage: 'adult', form: 'gentle', points: 72, rest: .001, trackedHours: 13 } };
        } else delete reply.returnRecap;
        reply.recapPending = false; await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await review(page); const panel = page.locator('.return-panel'), first = await size(page);
      assert.equal(await panel.evaluate(el => el.scrollTop), 0);
      const firstBounds = await textBounds(page); assert(firstBounds.inside && !firstBounds.overflow, JSON.stringify(firstBounds));
      await page.screenshot({ path: join(dir, `return-first-${width}-${font}-${sleeping ? 'sleep' : 'awake'}.png`), fullPage: true });
      await key(page, 'b'); const second = await size(page); console.log('SIZES', JSON.stringify({ width, font, sleeping, first, second }));
      assert.deepEqual(first, second, 'changing recap page must not stretch any device/screen height');
      assert.equal(second['.lcd-content'], width <= 700 ? 284 : 380);
      assert.equal(await page.locator('.device-stage.return-mode').count(), 1);
      const bounds = await textBounds(page); assert(bounds.inside && !bounds.overflow, JSON.stringify(bounds));
      await page.screenshot({ path: join(dir, `return-top-${width}-${font}-${sleeping ? 'sleep' : 'awake'}.png`), fullPage: true });
      await panel.hover(); await page.mouse.wheel(0, 160);
      await page.waitForFunction(() => document.querySelector('.return-panel').scrollTop > 0);
      const scrolled = await bottom(page); assert((await panel.innerText()).includes('这里不会自动照顾'));
      await page.keyboard.press('a'); assert.equal(await panel.evaluate(el => el.scrollTop), 0); assert.equal(await panel.locator('header span').innerText(), '1 / 2');
      await key(page, 'a'); await bottom(page);
      const top = await panel.evaluate(el => el.scrollTop), oldReads = reads;
      const sameRead = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname)); await sync(page); await sameRead;
      assert(reads > oldReads); assert.equal(await panel.evaluate(el => el.scrollTop), top);
      record = 'two'; const nextRead = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname)); await sync(page); await nextRead;
      await page.locator('.return-sync-note').waitFor(); assert.equal(await panel.locator('header span').innerText(), '1 / 2'); assert.equal(await panel.evaluate(el => el.scrollTop), 0);
      await key(page, 'a'); await panel.focus(); await page.keyboard.press('End');
      await page.waitForFunction(() => { const e = document.querySelector('.return-panel'); return e.scrollHeight - e.clientHeight - e.scrollTop < 2; });
      await page.screenshot({ path: join(dir, `return-${width}-${font}-${sleeping ? 'sleep' : 'awake'}.png`), fullPage: true });
      for (const type of ['offline', 'corrupt', 'clock']) {
        failure = type; const response = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname)); await sync(page); await response;
        await page.locator('.save-recovery').waitFor(); assert.equal(await page.locator('.return-mode,.return-panel').count(), 0);
        const recovery = await page.locator('.lcd-content').evaluate(el => ({ auto: getComputedStyle(el).height, client: el.clientHeight, scroll: el.scrollHeight, text: el.innerText }));
        assert(recovery.scroll <= recovery.client + 1, JSON.stringify(recovery)); assert(recovery.text.includes(type === 'clock' ? '时间' : type === 'corrupt' ? '修复' : '连接'));
        if (width === 320 && font === 28) await page.screenshot({ path: join(dir, `recovery-${type}-${sleeping}.png`), fullPage: true });
        failure = ''; await key(page, 'b'); await page.locator('.save-recovery').waitFor({ state: 'hidden' });
        await page.locator('.home-caption,.return-panel').first().waitFor();
        if (!(await page.locator('.return-panel').count())) await review(page);
      }
      record = ''; const cleared = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname)); await sync(page); await cleared; await page.locator('.home-caption').waitFor(); assert.equal(await page.locator('.return-mode').count(), 0);
      assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []); results.push({ width, font, sleeping, contrast, first, second, scrolled, firstBounds, bounds, recoveries: 3 });
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, port, artifacts: dir }));
} finally {
  if (browser) await browser.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  await writeFile(join(dir, 'server.log'), log);
}
