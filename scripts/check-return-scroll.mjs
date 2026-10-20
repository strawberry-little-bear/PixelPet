// Native scrolling regression: own temporary database/server, never a player's URL.
// Historical metadata/error responses are intercepted fixtures, not a settlement test.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-scroll-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`; let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function review(page) { await key(page, 'a'); for (let i = 0; i < 7; i++) await key(page, 'a'); await key(page, 'b'); await page.locator('.return-panel').waitFor(); }
async function sync(page) { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }
async function observe(page, reset, expected) {
  await page.evaluate(({ reset, expected }) => {
    const old = document.querySelector('.return-panel');
    const top = old.scrollTop, max = old.scrollHeight - old.clientHeight, documentTop = scrollY;
    if (!(top > 0 && top < max)) throw new Error(`End must still be moving: ${top}/${max}`);
    window.__readingNode = old;
    window.__scrollTrace = null;
    const capture = () => {
      const el = document.querySelector('.return-panel');
      const values = [];
      const sample = () => ({ top: el.scrollTop, focused: document.activeElement === el, same: el === old, documentTop: scrollY });
      values.push(sample()); window.__scrollTrace = { top, max, documentTop, values };
      let frames = 0;
      const next = () => { values.push(sample()); if (++frames < 12) requestAnimationFrame(next); };
      requestAnimationFrame(next);
    };
    if (!reset) { capture(); return; }
    const observer = new MutationObserver(() => {
      if (document.querySelector('.return-panel header span')?.textContent !== expected) return;
      observer.disconnect(); capture();
    });
    observer.observe(document.querySelector('.lcd-content'), { childList: true, subtree: true, characterData: true });
  }, { reset, expected });
}
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
      const page = await ctx.newPage(), writes = [], errors = []; let record = 'one';
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      await page.route(/\/api\/(state|visit)$/, async route => {
        const response = await route.fetch(), reply = await response.json();
        if (record) {
          const snapshot = { needs: { hunger: 34, mood: 80, clean: 41, energy: 100 }, stage: 'baby', form: '', points: 23.9, rest: 0, trackedHours: 1 };
          reply.returnRecap = { id: record, from: reply.serverTime - 48 * 3600000, to: reply.serverTime, before: snapshot, after: { ...snapshot, stage: 'adult', form: 'gentle', points: 72, rest: .001, trackedHours: 13 } };
        } else delete reply.returnRecap;
        reply.recapPending = false; await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await review(page); const panel = page.locator('.return-panel');
      for (const action of ['record', 'a', 'b', 'same']) for (let repeat = 0; repeat < 2; repeat++) {
        console.log('TRIAL', JSON.stringify({ width, font, sleeping, action, repeat }));
        if (action !== 'b') await key(page, 'a');
        await panel.focus();
        await page.keyboard.press('End');
        await page.waitForFunction(() => {
          const el = document.querySelector('.return-panel'); return el.scrollTop > 0 && el.scrollTop < el.scrollHeight - el.clientHeight;
        });
        await observe(page, action !== 'same', action === 'b' ? '2 / 2' : '1 / 2');
        if (action === 'record' || action === 'same') {
          if (action === 'record') record = `record-${repeat}`;
          const response = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname));
          await sync(page); await (await response).finished();
        } else await page.keyboard.press(action);
        await page.waitForFunction(() => window.__scrollTrace?.values.length === 13);
        const trace = await page.evaluate(() => window.__scrollTrace);
        assert(trace.values.every(v => v.documentTop === trace.documentTop), 'restoring reading focus must not move the document');
        if (action === 'same') {
          assert(await panel.evaluate(el => el === window.__readingNode && document.activeElement === el && el.scrollTop > 0));
          assert(trace.values.every(v => v.same && v.focused && v.top > 0), JSON.stringify(trace));
          assert(trace.values.at(-1).top >= trace.values[0].top, JSON.stringify(trace));
          // The same-ID trace must stay native; wrap even if End is still moving.
          await page.keyboard.press('a');
        } else {
          assert(trace.values.every(v => v.top === 0 && v.focused), JSON.stringify(trace));
          assert(trace.values.every(v => !v.same), 'new content must retire the old native scroll target');
        }
        if (action === 'b') await page.keyboard.press('a');
        assert.equal(await panel.locator('header span').innerText(), '1 / 2');
        results.push({ width, font, sleeping, action, repeat, trace });
      }
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
