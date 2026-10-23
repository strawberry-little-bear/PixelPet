// Real HTTP game-directory/guide reading; isolated build, save and random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary) && resolve(binary) !== join(root, 'bin/pixelpet'), 'Set absolute PIXELPET_TEST_BINARY to an isolated binary');
assert(web && isAbsolute(web) && resolve(web) !== join(root, 'web/dist'), 'Set absolute PIXELPET_TEST_WEB to an isolated build');
const shared = async path => realpath(path).catch(() => resolve(path));
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Do not use shared binary, including symlinks');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Do not use shared web build, including symlinks');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-arcade-reading-')), results = [];
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
async function readable(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  const problems = await page.locator(selector).evaluate(el => {
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
  const ids = ['stars', 'tiles', 'snake', 'tetris', 'fishing', 'walk', 'treasure'];
  const at = Date.now();
  await api('import', { schema: 1, species: 2, name: '选游戏伙伴', createdAt: at - 3600000, hatchedAt: at - 3600000,
    lastTick: at, sleeping: false, needs: { hunger: 60, mood: 80, energy: 80, clean: 70 }, careCount: 0, logs: [] });
  const before = (await api('state')).state;
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  const current = '.arcade-card[aria-current="true"]', header = '.game-guide > header';
  for (const mode of modes) for (const seen of [false, true]) for (const [index, id] of ids.entries()) {
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = [];
    let reads = 0;
    const label = `${id}-${seen ? 'repeat' : 'first'}-${mode.width}-${mode.height}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    // Explicit preference fixture; this read-only test never pretends a guide
    // was acknowledged by starting/finishing an actual game.
    await page.addInitScript(({ font, seen, id }) => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
      if (seen) localStorage.setItem(`pixelpet-guide-v1-${id}`, 'seen');
    }), { font: mode.font, seen, id });
    async function selection(expected) {
      await visible(page, current); // No test-side scroll before this assertion.
      assert.equal(await page.locator(current).getAttribute('data-game'), expected);
      await readable(page, '.arcade-panel');
      const font = await page.locator(`${current} strong`).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(Math.abs(font - mode.font * 12 / 14) < .1, 'selected title did not use the requested text size');
    }
    async function guide(expectedPage) {
      await visible(page, header); // The actual physical key may scroll first.
      assert.equal(await page.locator('.game-guide').getAttribute('data-guide'), id);
      if (expectedPage !== null) assert((await page.locator(header).innerText()).includes(`${expectedPage + 1} / 2`));
      assert.equal(await page.locator('.game-guide [aria-label="当前陪玩习惯"]').count(), 1);
      assert.match(await page.locator('.guide-habit').innerText(), /陪玩习惯尚未记录/);
      await readable(page, '.game-guide');
      const font = await page.locator('.game-guide > strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(Math.abs(font - mode.font * 12 / 14) < .1, 'guide did not use the requested text size');
      await page.locator('.game-guide > small').scrollIntoViewIfNeeded();
      await visible(page, '.game-guide > small');
    }
    async function stableRead() {
      await page.evaluate(() => scrollBy({ top: 35, behavior: 'instant' }));
      const y = await page.evaluate(() => scrollY), focus = await focusedKey(page), count = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === count; i++) await wait(20);
      assert(reads > count); await wait(100);
      assert.equal(await page.evaluate(() => scrollY), y, 'ordinary read replayed explicit navigation');
      assert.equal(await focusedKey(page), focus, 'ordinary read stole native focus');
    }
    try {
      console.log('RUN', label); await page.goto(base); await page.locator('.home-caption').waitFor();
      const preferences = await page.evaluate(() => JSON.stringify(localStorage));
      for (const k of ['A', 'A']) await key(page, k);
      const entrance = page.locator('[data-care-preview="arcade"]');
      await entrance.waitFor();
      assert.match(await entrance.innerText(), new RegExp(`${ids.length} 款小游戏`));
      assert.match(await entrance.innerText(), /按喜好选，不必都玩/);
      await readable(page, '[data-care-preview="arcade"]');
      if (index === 0 && !seen) await page.screenshot({ path: join(dir, `entrance-${mode.width}-${mode.height}.png`), fullPage: true });
      await key(page, 'B');
      await selection(ids[0]);
      for (let i = 0; i < index; i++) { await key(page, 'A'); await selection(ids[i + 1]); }
      // Cycle through and wrap the directory once, using the real key's native
      // Enter/Space activation without refocusing it in the test.
      if (index === ids.length - 1) {
        await key(page, 'A'); await selection(ids[0]); assert.equal(await focusedKey(page), 'a');
        await page.keyboard.press('Enter'); await selection(ids[1]);
        await page.keyboard.press('Space'); await selection(ids[2]);
        for (let i = 2; i < index; i++) { await key(page, 'A'); await selection(ids[i + 1]); }
      }
      await stableRead(); await key(page, 'B'); await guide(seen ? null : 0);
      assert.equal(await page.locator('.game-quick-start').count(), seen ? 1 : 0);
      if (seen) { await key(page, 'A'); await guide(0); }
      await key(page, 'A'); await guide(1); await stableRead();
      await key(page, 'A'); await guide(0);
      await key(page, 'C'); await selection(id); // Return to the same card.
      await key(page, 'B'); await guide(seen ? null : 0);
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      await key(page, 'C'); await selection(id); await key(page, 'C'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preferences, 'reading marked a guide seen');
      results.push({ id, seen, ...mode, passed: true });
    } catch (error) {
      await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  const after = (await api('state')).state;
  for (const field of ['species', 'hatchedAt', 'careCount', 'game', 'economy', 'album', 'logs']) assert.deepEqual(after[field], before[field]);
  assert.deepEqual(after.growth.care, before.growth.care, 'read-only flow recorded care');
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
