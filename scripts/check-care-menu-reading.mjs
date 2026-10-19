// Real HTTP care-menu selection reading; isolated build, save and random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-menu-reading-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) { await page.locator(`.button-${k.toLowerCase()}`).tap(); }
async function focusedKey(page) { return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null); }
async function visible(page, selector) {
  await wait(100);
  const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside native viewport: ${JSON.stringify(box)}`);
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  const problems = await page.locator('.content-menu').evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), problems = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) problems.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'reading text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  const kinds = ['feed', 'arcade', 'clean', 'sleep', 'status', 'journal', 'growth', 'return', 'album', 'shop', 'fish-album', 'park-album'];
  const current = '.care-menu [aria-current="true"]';
  for (const mode of modes) for (const kind of ['eligible', 'cooldown', 'satisfied', 'full', 'imported-sleep']) {
    const at = Date.now(), need = { eligible: 60, cooldown: 60, satisfied: 85, full: 100, 'imported-sleep': 60 }[kind];
    const fixture = (await api('import', { schema: 1, revision: 1, species: 2, name: '看清再照顾',
      createdAt: at - 3600000, hatchedAt: at - 3500000, lastTick: at, sleeping: kind === 'imported-sleep',
      needs: { hunger: need, mood: 80, clean: need, energy: 40 }, careCount: 0, logs: [] })).state;
    // Explicitly constructed cooldown history, not a naturally played record.
    if (kind === 'cooldown') {
      fixture.growth.care.lastFeed = fixture.growth.care.lastClean = fixture.lastTick - 60000;
      fixture.growth.care.nutrition = fixture.growth.care.clean = 1;
      fixture.careCount = 2; await api('import', fixture);
    }
    const before = (await api('state')).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = []; let reads = 0;
    const label = `${kind}-${mode.width}-${mode.height}-${mode.font}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    async function selection(n) {
      await visible(page, current); // No test-side scrolling before this assertion.
      assert.equal(await page.locator(current).count(), 1);
      assert.equal(await page.locator(`${current} .menu-number`).innerText(), String(n + 1).padStart(2, '0'));
      assert.equal(await page.locator('[data-care-preview]').getAttribute('data-care-preview'), kinds[n]);
      await readable(page);
    }
    async function stableRead() {
      await page.evaluate(() => scrollBy({ top: 70, behavior: 'instant' }));
      const position = await page.evaluate(() => scrollY), focus = await focusedKey(page), count = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === count; i++) await wait(20);
      assert(reads > count, 'authoritative read completed'); await wait(100);
      assert.equal(await page.evaluate(() => scrollY), position, 'ordinary sync moved reading');
      assert.equal(await focusedKey(page), focus, 'ordinary sync moved native focus');
    }
    try {
      console.log('RUN', label); await page.goto(base); await page.locator('.home-caption').waitFor();
      const preferences = await page.evaluate(() => JSON.stringify(localStorage));
      await key(page, 'A'); await selection(0);
      const preview = await page.locator('.care-preview').innerText();
      const phrase = { eligible: '符合记录习惯的条件', cooldown: '30 分钟间隔', satisfied: '本次不记', full: '暂时不能喂食', 'imported-sleep': '先选「起床啦」' }[kind];
      assert(preview.includes(phrase), `${kind}: ${preview}`);
      const font = parseFloat(await page.locator('.care-preview p').first().evaluate(el => getComputedStyle(el).fontSize));
      assert(Math.abs(font - mode.font * 12 / 14) < .1, 'actual preview paragraph font must double');
      await stableRead();
      // Every one of the twelve options, wrapping, and the entire long preview.
      for (let n = 0; n < kinds.length; n++) {
        if (kinds[n] === 'sleep' && kind === 'imported-sleep') assert((await page.locator('.care-preview').innerText()).includes('没有完整入睡记录'));
        await page.locator('.care-preview > :last-child').scrollIntoViewIfNeeded(); await visible(page, '.care-preview > :last-child');
        await key(page, 'A'); await selection((n + 1) % kinds.length);
      }
      // Keep the real focused machine button; do not refocus (which could scroll).
      assert.equal(await focusedKey(page), 'a');
      for (const [i, k] of ['Enter', 'Space'].entries()) {
        await page.keyboard.press(k); await selection(i + 1);
        assert.equal(await focusedKey(page), 'a', 'reading stole native key focus');
      }
      await key(page, 'C'); await page.locator('.home-caption').waitFor();
      await key(page, 'B'); await selection(0);
      await page.screenshot({ path: join(dir, `menu-${label}.png`) }); await visible(page, current);
      await stableRead();
      await key(page, 'C'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game', 'album', 'pond', 'park', 'logs', 'sleepSession']) assert.deepEqual(after[field], before[field]);
      for (const field of ['nutrition', 'play', 'clean', 'lastFeed', 'lastPlay', 'lastClean']) assert.equal(after.growth.care[field], before.growth.care[field], 'read-only menus must not record explicit care');
      // Authoritative reads legitimately settle passive sleeping recovery.
      const restGain = after.growth.care.rest - before.growth.care.rest;
      const maxRest = before.sleeping ? (after.lastTick - before.lastTick) / 3600000 * 14 / 28 : 0;
      assert(restGain >= 0 && restGain <= maxRest + 1e-9, 'only elapsed passive rest may accrue');
      results.push({ ...mode, kind, history: 'schema1-import; constructed cooldown where noted' });
    } catch (error) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw error; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
