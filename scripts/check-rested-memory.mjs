// Actual short sleeps and real saved cards: no fake response, clock or sleep counters.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rested-memory-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(r.ok, await r.clone().text()); return r.json();
}
const cards = state => state.album.entries.filter(m => m.kind === 'rested');
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function sleepAction(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
  await key(page, 'B'); const r = await response; assert(r.ok()); return r.json();
}
async function reloadHome(page) {
  await page.reload(); await page.locator('.home-caption').waitFor();
}
async function openCareAlbum(page) {
  await key(page, 'A'); for (let i = 0; i < 8; i++) await key(page, 'A'); await key(page, 'B');
  await page.locator('.album-directory').waitFor();
  await key(page, 'A'); await key(page, 'A');
  assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'), 'care');
  await key(page, 'B');
  assert.equal(await page.locator('[data-album-category]').getAttribute('data-album-category'), 'care');
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const issues = await page.locator('.album-panel').evaluate(el => {
    const issues = [], footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > footer.top + 1) issues.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'card clipped or overlaps footer');
  for (const selector of ['.album-panel > header', '.album-source:last-child', '.button-a', '.button-b', '.button-c']) {
    const el = page.locator(selector); await el.scrollIntoViewIfNeeded();
    assert(await el.evaluate(el => { const b = el.getBoundingClientRect(); return b.top >= -1 && b.bottom <= innerHeight + 1; }), `${selector} unreachable`);
  }
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  for (const mode of modes) for (const stage of ['baby', 'growing', 'adult']) {
    const now = Date.now(), age = ({ baby: 2, growing: 30, adult: 80 }[stage]) * 3600000;
    // Explicit legacy import sets an initial near-full need. Sleep itself runs on real time.
    const initial = await api('import', { schema: 1, revision: 1, species: 2, name: '好梦伙伴', createdAt: now - age, hatchedAt: now - age,
      lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 90, energy: 99.999 }, careCount: 0, logs: [] });
    assert.equal(initial.state.growth.stage, stage); assert.equal(initial.state.schema, 18); assert.deepEqual(cards(initial.state), []);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = [], label = `${stage}-${mode.width}-${mode.height}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    try {
      console.log('RUN', label); await page.goto(base); await page.locator('.home-caption').waitFor();
      for (let i = 0; i < 4; i++) await key(page, 'A');
      const bed = await sleepAction(page); assert(bed.state.sleepSession); assert.deepEqual(cards(bed.state), []);
      await key(page, 'C');
      let full;
      for (let i = 0; i < 80; i++) {
        await wait(250); full = await api('visit', {}); assert.deepEqual(cards(full.state), []);
        if (full.state.needs.energy === 100 && full.state.sleepSession.energyRecovered > 0) break;
      }
      assert.equal(full.state.needs.energy, 100); assert(full.state.sleepSession.energyRecovered > 0);
      await reloadHome(page);
      for (let i = 0; i < 4; i++) await key(page, 'A');
      await page.locator('.sleep-progress').waitFor();
      const wake = await sleepAction(page), remembered = cards(wake.state);
      assert.equal(remembered.length, 1); assert.equal(remembered[0].at, wake.careFeedback.sleepSummary.wokeAt);
      assert.equal(wake.careFeedback.points, 0); assert.equal(wake.careFeedback.habitGain, 0);
      assert.equal(wake.state.economy.coins, full.state.economy.coins);
      assert(wake.careFeedback.sleepSummary.energyRecovered > 0); assert(!wake.state.sleeping);
      await key(page, 'C'); await openCareAlbum(page);
      assert.equal(await page.locator('.album-panel h3').filter({ hasText: '睡饱后的小小伸展' }).count(), 0);
      // Cover -> goodnight -> rested. A and B both turn a card; C remains return.
      await key(page, 'A'); assert.equal(await page.locator('.album-panel h3').innerText(), '轻轻说一声晚安');
      await key(page, 'B'); assert.equal(await page.locator('.album-panel h3').innerText(), '睡饱后的小小伸展');
      assert((await page.locator('.album-panel > p').innerText()).includes('不用每次都等到满格'));
      const font = await page.locator('.album-panel > p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(Math.abs(font - mode.font * 12 / 14) < .1, 'card does not inherit enlarged type');
      await readable(page); await page.locator('.album-panel > header').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      await key(page, 'C'); await page.locator('.album-directory').waitFor(); await key(page, 'C');
      await reloadHome(page);
      const backup = await api('backup'); assert.deepEqual(cards(backup), remembered);
      const restored = await api('import', backup); assert.deepEqual(cards(restored.state), remembered);
      await reloadHome(page); await openCareAlbum(page); await key(page, 'B'); await key(page, 'B');
      assert.equal(await page.locator('.album-panel h3').innerText(), '睡饱后的小小伸展');
      assert.equal(writes.length, 2, 'reading/reloading/restoring replayed sleep'); assert.deepEqual(errors, []);
      results.push({ stage, ...mode, energyRecovered: wake.careFeedback.sleepSummary.energyRecovered, remembered, passed: true });
    } catch (error) { await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
