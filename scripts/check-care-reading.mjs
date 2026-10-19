// Real HTTP care/status/handbook reading; isolated build, save and random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-reading-')), results = [];
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
async function open(page, kind) {
  await key(page, 'A'); for (let i = 0; i < (kind === 'growth' ? 6 : 4); i++) await key(page, 'A');
  await key(page, 'B'); await page.locator(`.content-${kind}`).waitFor();
  await visible(page, '[data-care-reading-start]');
}
async function readable(page, kind) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  assert.equal(await page.locator('[data-care-reading-start]').count(), 1, 'exactly one reading start');
  const problems = await page.locator(`.content-${kind}`).evaluate(el => {
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
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const mode of modes) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    await api('import', { schema: 1, revision: 1, species: 2, name: '慢慢阅读', createdAt: at - age, hatchedAt: at - age, lastTick: at,
      sleeping, needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [] });
    const before = (await api('state')).state; assert.equal(before.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, isMobile: mode.width < 700,
      reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = []; let reads = 0;
    const label = `${stage}-${sleeping}-${mode.width}-${mode.height}`, capture = stage === 'baby' && !sleeping || stage === 'adult' && sleeping;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      for (const kind of ['growth', 'status']) {
        await open(page, kind); const pages = kind === 'growth' ? 6 : 2;
        for (let n = 0; n < pages; n++) {
          const panel = page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status');
          assert.equal(await panel.getAttribute(`data-${kind}-page`), String(n));
          await visible(page, '[data-care-reading-start]'); await readable(page, kind);
          const focused = await focusedKey(page);
          if (capture && (n === 0 || n === 4 || n === 5 || kind === 'status')) {
            await page.screenshot({ path: join(dir, `visible-${kind}-${label}-${n}.png`) });
            await visible(page, '[data-care-reading-start]');
          }
          // Authoritative reads must not replay the explicit navigation intent.
          await page.evaluate(() => scrollBy({ top: 90, behavior: 'instant' }));
          const position = await page.evaluate(() => scrollY), beforeReads = reads;
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          for (let i = 0; i < 100 && reads === beforeReads; i++) await wait(20);
          assert(reads > beforeReads, 'same-session read not completed');
          await wait(100); assert.equal(await page.evaluate(() => scrollY), position, 'read jumped the document');
          assert.equal(await focusedKey(page), focused, 'reading moved focus');
          // End-of-page content remains reachable with normal document scrolling.
          const end = kind === 'growth' ? '.growth-page-dots' : '.status-page-number';
          await page.locator(end).scrollIntoViewIfNeeded(); await visible(page, end);
          // Full-page diagnostic capture comes last; it can perturb mobile scrollY.
          if (capture && (n === 0 || n === 4 || kind === 'status')) await page.screenshot({ path: join(dir, `full-${kind}-${label}-${n}.png`), fullPage: true });
          await key(page, kind === 'growth' && n % 2 ? 'B' : 'A');
        }
        assert.equal(await page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status').getAttribute(`data-${kind}-page`), '0');
        await visible(page, '[data-care-reading-start]');
        // The focused physical key remains usable via native Enter and Space.
        // Growth last used B; status last used A. Both flip this page.
        const focused = await focusedKey(page); assert(focused, 'physical key lost native focus');
        for (const [index, key] of ['Enter', 'Space'].entries()) {
          await page.keyboard.press(key); await visible(page, '[data-care-reading-start]');
          assert.equal(await page.locator(kind === 'growth' ? '.growth-panel' : '.screen-status').getAttribute(`data-${kind}-page`), String((index + 1) % pages), 'native key must flip exactly once');
          assert.equal(await focusedKey(page), focused);
        }
        await key(page, kind === 'growth' ? 'C' : 'B'); await page.locator('.home-caption').waitFor();
      }
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game']) assert.deepEqual(after[field], before[field]);
      assert.equal(after.growth.stage, stage); assert.equal(after.growth.form, before.growth.form);
      results.push({ type: 'real-http-reading-after-legacy-migration', stage, sleeping, ...mode, pages: 8 });
    } catch (e) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw e; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
