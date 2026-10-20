// Persistent recovery notices must not cover reading text or the three keys.
// Errors are controlled responses, not real player corruption/clock diagnoses.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-recovery-reading-'));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
const modes = [
  { label: 'large', width: 320, height: 568, font: 28, contrast: true },
  { label: 'phone', width: 390, height: 844, font: 14, contrast: false },
  { label: 'desktop', width: 1200, height: 900, font: 14, contrast: false },
];
const wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
const get = async () => (await (await fetch(base + '/api/state')).json());
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function reading(page, name) {
  const notice = page.getByRole('alert');
  const metrics = await notice.evaluate(el => {
    const box = el.getBoundingClientRect(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let fits = true, textRanges = 0;
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const r of range.getClientRects()) if (r.width && r.height) { textRanges++; fits &&= r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1; }
    }
    return { position: getComputedStyle(el).position, font: parseFloat(getComputedStyle(el).fontSize), fits, textRanges,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  const occlusions = [];
  for (const target of await page.locator('.save-recovery h2,.save-recovery p,.save-recovery small,.physical-button').all()) {
    // Native document reading may put a line/key near the viewport bottom.
    // Do not rely on Playwright silently re-scrolling an intercepted tap.
    await target.evaluate(el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
    const hidden = await target.evaluate(el => {
      const toast = document.querySelector('.toast'), t = toast?.getBoundingClientRect();
      const ranges = [];
      if (el.matches('.physical-button')) ranges.push(el.getBoundingClientRect());
      else {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const r = document.createRange(); r.selectNodeContents(walker.currentNode); ranges.push(...r.getClientRects()); }
      }
      const visible = ranges.filter(r => r.width && r.height && r.top < innerHeight && r.bottom > 0);
      return { visible: visible.length, hidden: visible.filter(r => t &&
        r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top).map(r => ({
        text: el.textContent, textBox: { top: r.top, bottom: r.bottom }, toast: { top: t.top, bottom: t.bottom }, scrollY,
      })) };
    });
    assert(hidden.visible > 0, 'scroll check must actually show the target');
    if (name.endsWith('-large') && await target.evaluate(el => el.matches('h2,.button-b'))) {
      const label = await target.evaluate(el => el.matches('h2') ? 'title' : 'keys');
      await page.screenshot({ path: join(dir, `${name}-${label}-viewport.png`) });
    }
    if (hidden.hidden.length) {
      occlusions.push(...hidden.hidden);
      await page.screenshot({ path: join(dir, `${name}-occluded.png`) });
      break;
    }
  }
  await writeFile(join(dir, `${name}-reading.json`), JSON.stringify({ metrics, occlusions }, null, 2));
  assert.deepEqual(occlusions, [], 'persistent notice covers recovery text or a key; artifacts: ' + dir);
  assert.equal(metrics.position, 'static'); assert(metrics.fits && !metrics.overflow, JSON.stringify(metrics));
  assert.equal(await page.locator('main > .recovery-notice').count(), 1);
  for (const b of await page.locator('.physical-button').all()) {
    await b.scrollIntoViewIfNeeded();
    const r = await b.boundingBox(); assert(r.width >= 44 && r.height >= 44);
  }
  const close = notice.getByRole('button', { name: '关闭提示' });
  await close.scrollIntoViewIfNeeded(); const box = await close.boundingBox(); assert(box.width >= 44 && box.height >= 44);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  return metrics;
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
  for (const mode of modes) for (const kind of ['offline', 'clock', 'corrupt', 'uncommitted', 'committed']) {
    const initial = ['offline', 'clock', 'corrupt'].includes(kind), now = Date.now();
    const imported = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      schema: 1, revision: 1, species: 2, name: '恢复说明可读', createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now,
      sleeping: false, careCount: 0, logs: [], needs: { hunger: 50, mood: 70, clean: 60, energy: 80 },
    }) });
    assert(imported.ok, await imported.text()); const seeded = (await get()).state;
    const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: mode.width < 700,
      hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await ctx.newPage(), writes = [], reads = [], errors = []; let failed = true;
      // Pause browser time to prevent a heartbeat claiming anything while reading.
      // This is a layout/reconciliation fixture, not real background endurance.
      await page.clock.install(); await page.clock.pauseAt(new Date());
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { const p = new URL(r.url()).pathname;
        if (['/api/action', '/api/import', '/api/reset', '/api/recap/read'].includes(p)) writes.push(p);
        if (['/api/state', '/api/visit'].includes(p)) reads.push(p);
      });
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (failed && (initial || path === '/api/action' || path === '/api/state')) {
          if (kind === 'committed' && path === '/api/action') { const response = await route.fetch(); assert(response.ok()); }
          return route.fulfill({ status: kind === 'clock' || kind === 'corrupt' ? 409 : 503, json: {
            error: '隔离恢复阅读夹具', code: kind === 'clock' ? 'clock_ahead' : kind === 'corrupt' ? 'save_corrupt' : undefined,
          } });
        }
        const response = await route.fetch(); return route.fulfill({ response });
      });
      await page.goto(base);
      if (!initial) { await page.locator('.home-caption').waitFor(); await key(page, 'a'); await key(page, 'b'); }
      await page.locator('.save-recovery').waitFor();
      await page.waitForFunction(() => !document.querySelector('.button-b').disabled);
      // Corrupt-save recovery keeps the existing repair-key behavior: A/C
      // are enabled no-ops, while unknown writes/offline lock them outright.
      if (kind !== 'corrupt') {
        assert.equal(await page.locator('.button-a').isDisabled(), true);
        assert.equal(await page.locator('.button-c').isDisabled(), true);
      }
      const beforeKeys = writes.length, beforeReads = reads.length;
      await page.keyboard.press('a'); await page.keyboard.press('c');
      assert.equal(await page.locator('.save-recovery').count(), 1);
      assert.equal(writes.length, beforeKeys); assert.equal(reads.length, beforeReads);
      const metrics = await reading(page, `${kind}-${mode.label}`);
      assert(metrics.font >= mode.font * .85, JSON.stringify(metrics));
      const count = writes.length;
      await key(page, 'b'); await page.waitForFunction(() => !document.querySelector('.button-b').disabled);
      assert.equal(await page.locator('.save-recovery').count(), 1);
      assert.equal(writes.length, count); assert.equal(reads.at(-1), kind === 'offline' ? '/api/visit' : '/api/state');
      failed = false; await key(page, 'b'); await page.locator('.save-recovery').waitFor({ state: 'detached' });
      await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.recovery-notice').count(), 0);
      assert.equal(await page.locator('.pet-scene').getAttribute('data-motion'), 'idle');
      assert.equal(writes.length, initial ? 0 : 1);
      const after = (await get()).state;
      assert.equal(after.careCount, kind === 'committed' ? 1 : 0); assert.equal(after.economy.coins, seeded.economy.coins);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      assert.deepEqual(errors, []); results.push({ kind, mode: mode.label, metrics, writes, reads });
      console.log('PASS', results.length, kind, mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ port, results }, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) await new Promise(r => { server.once('exit', r); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
