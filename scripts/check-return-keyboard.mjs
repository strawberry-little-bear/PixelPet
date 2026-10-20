// Focused reading-key regression: own temporary database/server, never a player's URL.
// Historical recap responses are intercepted fixtures, not a settlement test.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-keyboard-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`; let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function review(page) { await key(page, 'a'); for (let i = 0; i < 7; i++) await key(page, 'a'); await key(page, 'b'); await page.locator('.return-panel').waitFor(); }
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
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
      const page = await ctx.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      await page.route(/\/api\/(state|visit)$/, async route => {
        const response = await route.fetch(), reply = await response.json();
        const snapshot = { needs: { hunger: 34, mood: 80, clean: 41, energy: 100 }, stage: 'baby', form: '', points: 23.9, rest: 0, trackedHours: 1 };
        reply.returnRecap = { id: 'reading', from: reply.serverTime - 48 * 3600000, to: reply.serverTime, before: snapshot, after: { ...snapshot, stage: 'adult', form: 'gentle', points: 72, rest: .001, trackedHours: 13 } };
        reply.recapPending = false; await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await review(page); const panel = page.locator('.return-panel');
      const stable = async () => page.evaluate(async () => {
        const el = document.querySelector('.return-panel'); let same = 0, previous = -1;
        for (let i = 0; i < 120; i++) {
          await new Promise(requestAnimationFrame);
          same = el.scrollTop === previous ? same + 1 : 0; previous = el.scrollTop;
          if (same >= 4) return el.scrollTop;
        }
        throw new Error('Native scrolling did not settle');
      });
      for (const pageNumber of [1, 2]) {
        if (pageNumber === 2) await page.keyboard.press('a');
        const expected = `${pageNumber} / 2`;
        await panel.focus(); await page.keyboard.press('Home'); await stable();
        const initial = await panel.evaluate(el => ({ max: el.scrollHeight - el.clientHeight, documentTop: scrollY }));
        assert(initial.max > 0, 'The fixture must require reading scroll');
        await panel.evaluate(el => { window.__readingNode = el; });
        for (const [down, up] of [['ArrowDown', 'ArrowUp'], ['Space', 'Shift+Space'], ['PageDown', 'PageUp'], ['End', 'Home']]) {
          await page.keyboard.press(down);
          assert.equal(await panel.locator('header span').innerText(), expected, `${down} must not change recap page`);
          await page.waitForFunction(() => document.querySelector('.return-panel')?.scrollTop > 0);
          const bottom = await stable(); assert(bottom > 0);
          assert(await panel.evaluate(el => el === window.__readingNode && document.activeElement === el));
          assert.equal(await page.evaluate(() => scrollY), initial.documentTop, 'Read inside the LCD, not the document');
          await page.keyboard.press(up);
          await page.waitForFunction(() => document.querySelector('.return-panel')?.scrollTop === 0); await stable();
          assert.equal(await panel.locator('header span').innerText(), expected);
          results.push({ width, font, sleeping, page: pageNumber, down, up, bottom, max: initial.max });
        }
      }
      await page.screenshot({ path: join(dir, `recap-${width}-${font}-${sleeping}.png`), fullPage: true });
      // Reading focus retains letter controls; physical keys retain global aliases.
      await page.keyboard.press('a'); assert.equal(await panel.locator('header span').innerText(), '1 / 2');
      await page.keyboard.press('b'); assert.equal(await panel.locator('header span').innerText(), '2 / 2');
      await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
      await review(page); await page.locator('.button-a').focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await panel.locator('header span').innerText(), '2 / 2');
      await page.locator('.button-b').focus(); await page.keyboard.press('Space'); await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, port, artifacts: dir }));
} finally {
  if (browser) await browser.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  await writeFile(join(dir, 'server.log'), log);
}
