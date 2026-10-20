// Chrome's native touch input pipeline, not DOM-dispatched scroll events.
// Own random-port service and temporary DB only; history is an HTTP fixture.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-touch-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${base}/api/${path}`, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const reply = await r.json(); assert(r.ok, JSON.stringify(reply)); return reply;
};
const key = async (page, k) => page.locator(`.button-${k}:not(:disabled)`).tap();
async function review(page) { await key(page, 'a'); for (let i = 0; i < 7; i++) await key(page, 'a'); await key(page, 'b'); await page.locator('.return-panel').waitFor(); }
async function sizes(page) {
  return page.evaluate(() => Object.fromEntries(['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content'].map(s => [s, document.querySelector(s).getBoundingClientRect().height])));
}
async function reading(page) {
  return page.locator('.return-panel').evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight, outer: scrollY, page: el.querySelector('header span').textContent }));
}
async function settle(page) {
  await page.evaluate(() => { window.__touchSettling = null; });
  await page.waitForFunction(() => {
    const el = document.querySelector('.return-panel'), previous = window.__touchSettling;
    const top = el.scrollTop, outer = scrollY;
    const frames = previous?.top === top && previous?.outer === outer ? previous.frames + 1 : 0;
    window.__touchSettling = { top, outer, frames }; return frames >= 5;
  });
}
// Coordinates stay below the sticky header and inside the current viewport.
async function gesture(page, cdp, down = true, during) {
  const box = await page.locator('.return-panel').evaluate(el => {
    const b = el.getBoundingClientRect(), h = el.querySelector('header').getBoundingClientRect();
    return { x: (b.left + b.right) / 2, high: Math.max(b.top, h.bottom) + 12, low: b.bottom - 16, viewport: innerHeight };
  });
  assert(box.low < box.viewport && box.high >= 0 && box.low - box.high > 60, JSON.stringify(box));
  const start = down ? box.low : box.high, end = down ? box.high : box.low;
  const point = y => [{ x: box.x, y, id: 1, radiusX: 4, radiusY: 4, force: .7 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(start + (end - start) * i / 10) });
    await wait(20);
    if (i === 5 && during) await during();
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(page);
}
async function edge(page, cdp, down) {
  for (let i = 0; i < 30; i++) {
    const r = await reading(page); if (down ? r.max - r.top < 2 : r.top === 0) return i;
    await gesture(page, cdp, down);
  }
  throw new Error(`Touch gestures did not reach ${down ? 'bottom' : 'top'}: ${JSON.stringify(await reading(page))}`);
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
  for (const width of [390, 320]) for (const font of [14, 28]) for (const sleeping of [false, true]) {
    console.log('TRIAL', width, font, sleeping);
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '回访稳稳读', createdAt: now - 25 * 3600000, hatchedAt: now - 25 * 3600000, lastTick: now, sleeping, needs: { hunger: 30, mood: 80, clean: 20, energy: 50 }, careCount: 0, logs: [] });
    const saved = await api('state');
    const ctx = await browser.newContext({ viewport: { width, height: 750 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', forcedColors: width === 320 && sleeping ? 'active' : 'none' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
        window.__touchInput = { starts: 0, moves: 0, ends: 0, untrusted: 0 };
        for (const [type, count] of [['touchstart', 'starts'], ['touchmove', 'moves'], ['touchend', 'ends']]) document.addEventListener(type, e => {
          if (e.target.closest?.('.return-panel')) { window.__touchInput[count]++; if (!e.isTrusted) window.__touchInput.untrusted++; }
        }, { passive: true });
      }), font);
      const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), writes = [], errors = [];
      let record = 'first';
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      await page.route(/\/api\/(state|visit)$/, async route => {
        const response = await route.fetch(), reply = await response.json();
        const snapshot = { needs: { hunger: 34, mood: 80, clean: 41, energy: 100 }, stage: 'baby', form: '', points: 23.9, rest: 0, trackedHours: 1 };
        reply.returnRecap = { id: record, from: now - 48 * 3600000, to: now, before: snapshot, after: { ...snapshot, stage: 'adult', form: 'gentle', points: 72, rest: .001, trackedHours: 13 } };
        reply.recapPending = false; await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor(); await review(page);
      const panel = page.locator('.return-panel'); await panel.scrollIntoViewIfNeeded();
      const firstSizes = await sizes(page), first = await reading(page); assert.equal(first.top, 0); assert(first.max > 0);
      const pages = [];
      for (const index of [0, 1]) {
        if (index) { await page.keyboard.press('a'); await settle(page); }
        const start = await reading(page); assert.equal(start.top, 0);
        await gesture(page, cdp); const moved = await reading(page);
        assert(moved.top > 0 && moved.page === `${index + 1} / 2`, JSON.stringify(moved));
        assert.equal(moved.outer, start.outer, 'swipe must scroll inside the LCD');
        const swipes = await edge(page, cdp, true), bottom = await reading(page);
        assert(bottom.max - bottom.top < 2); assert.equal(bottom.outer, start.outer);
        const visible = await panel.evaluate(el => {
          const header = el.querySelector('header'), b = el.getBoundingClientRect(), h = header.getBoundingClientRect(), last = el.lastElementChild.getBoundingClientRect();
          const hit = document.elementFromPoint((b.left + b.right) / 2, b.top + 1);
          return { sticky: h.top >= b.top - 1 && h.top < b.top + 12, finalVisible: last.bottom <= b.bottom + 1, covered: hit === header || header.contains(hit), hit: hit?.tagName, gap: h.top - b.top };
        });
        assert(visible.sticky && visible.finalVisible, JSON.stringify(visible));
        assert(visible.covered, `scrolled text must not bleed above the sticky header: ${JSON.stringify(visible)}`);
        // An extra swipe at either boundary must not pull the outer document.
        await gesture(page, cdp); assert.equal((await reading(page)).outer, start.outer);
        await edge(page, cdp, false); await gesture(page, cdp, false);
        const top = await reading(page); assert.equal(top.top, 0); assert.equal(top.outer, start.outer);
        assert.deepEqual(await sizes(page), firstSizes); pages.push({ index, moved, bottom, top, swipes });
      }
      const replacements = [];
      for (const action of ['page', 'b', 'record', 'same']) {
        console.log('REPLACE', width, font, sleeping, action);
        const expected = action === 'b' ? '1 / 2' : '2 / 2';
        if (await panel.locator('header span').innerText() !== expected) await page.keyboard.press('a');
        const start = await reading(page); assert.equal(start.top, 0);
        await panel.evaluate(el => {
          window.__oldTouchPanel = el;
          const trace = { values: [], stopped: false }; window.__touchTrace = trace;
          const sample = () => {
            if (trace.stopped) return;
            const current = document.querySelector('.return-panel');
            if (current !== el) trace.values.push({ top: current.scrollTop, outer: scrollY });
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        let middle;
        await gesture(page, cdp, true, async () => {
          middle = await reading(page); assert(middle.top > 0 && middle.top < middle.max, JSON.stringify(middle));
          if (action === 'page' || action === 'b') await page.keyboard.press(action === 'b' ? 'b' : 'a');
          else {
            if (action === 'record') record = `new-${width}-${font}-${sleeping}`;
            const response = page.waitForResponse(r => /\/api\/(state|visit)$/.test(new URL(r.url()).pathname));
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await (await response).finished();
          }
        });
        const end = await reading(page), same = await panel.evaluate(el => el === window.__oldTouchPanel);
        const trace = await page.evaluate(() => { window.__touchTrace.stopped = true; return window.__touchTrace.values; });
        assert.equal(end.outer, start.outer);
        if (action === 'same') { assert(same); assert(end.top >= middle.top && end.top > 0); }
        else {
          assert(!same); assert.equal(end.top, 0, `remaining native touch must not scroll new ${action}`);
          assert(trace.length >= 5 && trace.every(frame => frame.top === 0 && frame.outer === start.outer), JSON.stringify(trace));
        }
        assert.deepEqual(await sizes(page), firstSizes); replacements.push({ action, middle, end, same, trace });
        if (action === 'same') await page.keyboard.press('a');
      }
      // Full-page mobile screenshots can round the outer scroll offset by 1px.
      // Capture only after all document-position assertions, never weaken them.
      if (await panel.locator('header span').innerText() !== '2 / 2') await page.keyboard.press('a');
      await edge(page, cdp, true);
      await page.screenshot({ path: join(dir, `bottom-${width}-${font}-${sleeping}.png`), fullPage: true });
      const input = await page.evaluate(() => window.__touchInput);
      assert(input.starts > 0 && input.moves > 0 && input.ends > 0 && input.untrusted === 0, JSON.stringify(input));
      assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      const after = await api('state'); assert.equal(after.state.careCount, saved.state.careCount); assert.deepEqual(after.state.album, saved.state.album); assert.deepEqual(after.state.economy, saved.state.economy);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ width, font, sleeping, firstSizes, pages, replacements, input }); console.log('PASS', width, font, sleeping);
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
