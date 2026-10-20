// Real HTTP recent care diary reading; isolated build, save and random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-journal-reading-')), results = [];
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
  assert.equal(await page.locator('.screen-journal [data-care-reading-start]').count(), 1, 'exactly one journal date/empty reading start');
  const problems = await page.locator('.content-journal').evaluate(el => {
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
  for (const mode of modes) for (const sleeping of [false, true]) for (const empty of [false, true]) {
    const at = Date.now();
    // Legal long legacy text stresses native page scrolling, not fabricated gameplay.
    const logs = empty ? [] : [
      { at: at - 1000, text: '长日记：' + '今天一起散步，看见树叶和水纹。'.repeat(10) },
      { at: at - 2000, text: '短日记：一起吃饭。' },
      { at: at - 3000, text: '另一条日记：' + '慢慢照顾，留下共同经历。'.repeat(10) },
    ];
    const migrated = (await api('import', { schema: 1, revision: 1, species: 2, name: '日记伙伴',
      createdAt: at - 3600000, hatchedAt: at - 3500000, lastTick: at, sleeping,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 40 }, careCount: 0, logs })).state;
    // Migration legitimately adds its own diary note. Use the migrated backup
    // with a controlled legal history, rather than assuming migration is silent.
    migrated.logs = logs;
    const before = (await api('import', migrated)).state;
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = []; let reads = 0;
    const label = `${mode.width}-${mode.height}-${mode.font}-${sleeping}-${empty}`;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    const start = '.screen-journal > ' + (empty ? 'p' : 'time');
    try {
      console.log('RUN', label);
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      await key(page, 'A'); for (let i = 0; i < 5; i++) await key(page, 'A');
      await key(page, 'B'); await page.locator('.screen-journal').waitFor();
      await visible(page, start);
      for (let n = 0; n < (empty ? 1 : logs.length); n++) {
        await visible(page, start); await readable(page);
        const fontSize = await page.locator('.screen-journal > p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert(Math.abs(fontSize - mode.font * 12 / 14) < .1, 'actual diary text must scale with root');
        assert.equal(await page.locator('.screen-journal > p').innerText(), empty ? '还没有日记，之后的照顾和成长会慢慢记在这里。' : logs[n].text);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
        const focus = await focusedKey(page);
        // Native scroll remains possible, and ordinary sync must not replay navigation.
        await page.evaluate(() => scrollBy({ top: 80, behavior: 'instant' }));
        const position = await page.evaluate(() => scrollY), count = reads;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        for (let i = 0; i < 100 && reads === count; i++) await wait(20);
        assert(reads > count, 'authoritative read completed'); await wait(100);
        assert.equal(await page.evaluate(() => scrollY), position, 'sync moved reading position');
        assert.equal(await focusedKey(page), focus, 'sync moved native focus');
        // Read through to the end, then physically flip; no test-side positioning before visibility assertion.
        await page.locator('.journal-note').scrollIntoViewIfNeeded(); await visible(page, '.journal-note');
        if (n === 0) await page.screenshot({ path: join(dir, `full-${label}.png`), fullPage: true });
        await key(page, 'A'); await visible(page, start);
      }
      assert.equal(await page.locator('.screen-journal > span').innerText(), empty ? '0 条记录' : '1 / 3');
      // Reverse through the same records, including newest -> oldest wrap.
      // Tap B from the bottom; the real UI, not test-side scroll, locates its date.
      assert((await page.locator('.journal-note').innerText()).includes('首尾循环'));
      for (let n = 0; n < (empty ? 1 : logs.length); n++) {
        await page.locator('.journal-note').scrollIntoViewIfNeeded();
        await key(page, 'B'); await visible(page, start); await readable(page);
        const index = logs.length - 1 - n;
        assert.equal(await page.locator('.screen-journal > p').innerText(), empty ? '还没有日记，之后的照顾和成长会慢慢记在这里。' : logs[index].text);
        assert.equal(await focusedKey(page), 'b');
      }
      for (const [i, k] of ['Enter', 'Space'].entries()) {
        await page.keyboard.press(k); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > span').innerText(), empty ? '0 条记录' : `${3 - i} / 3`);
        assert.equal(await focusedKey(page), 'b');
      }
      await key(page, 'B'); await visible(page, start); // Back to newest.
      await key(page, 'A'); await key(page, 'B'); // An adjacent forward/reverse pair is identity.
      assert.equal(await page.locator('.screen-journal > span').innerText(), empty ? '0 条记录' : '1 / 3');
      // Focus A by real Tab navigation, without another flip.
      for (let i = 0; i < 12 && await focusedKey(page) !== 'a'; i++) await page.keyboard.press('Tab');
      // Native Enter/Space on the focused A key must still flip exactly once.
      assert.equal(await focusedKey(page), 'a');
      for (const [i, k] of ['Enter', 'Space'].entries()) {
        await page.keyboard.press(k); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > span').innerText(), empty ? '0 条记录' : `${i + 2} / 3`);
      }
      await page.screenshot({ path: join(dir, `visible-${label}.png`) });
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      await key(page, 'C'); await page.locator('.home-caption').waitFor();
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      const after = (await api('state')).state;
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game', 'logs']) assert.deepEqual(after[field], before[field]);
      let rolling = false;
      if (!sleeping && !empty) {
        // Construct a legal full history, then let an actual external care
        // transaction prepend/evict a record. This is not 30 natural care events.
        const history = Array.from({ length: 30 }, (_, i) => ({ at: at - (i + 1) * 1000, text: `保留的照顾记录 ${i}` }));
        async function sync() {
          const count = reads;
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          for (let i = 0; i < 100 && reads === count; i++) await wait(20);
          assert(reads > count, 'external save must be read'); await wait(100);
        }
        await api('import', { ...after, logs: history }); await sync();
        await key(page, 'A'); for (let i = 0; i < 5; i++) await key(page, 'A');
        await key(page, 'B'); await page.locator('.screen-journal').waitFor();
        await key(page, 'B'); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > p').innerText(), history[29].text);
        const feed = await api('action', { kind: 'feed', requestId: `journal-direction-${label}` });
        assert.equal(feed.state.logs.length, 30); assert.equal(feed.state.logs[29].text, history[28].text);
        await sync();
        assert.equal(await page.locator('.screen-journal > p').innerText(), history[28].text);
        assert((await page.locator('.journal-trimmed').innerText()).includes('不在最近日记中'));
        await key(page, 'B'); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > p').innerText(), history[27].text);
        assert.equal(await page.locator('.journal-trimmed').count(), 0);
        await key(page, 'A'); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > p').innerText(), history[28].text);
        await key(page, 'A'); await visible(page, start);
        assert.equal(await page.locator('.screen-journal > p').innerText(), feed.state.logs[0].text);
        await key(page, 'C'); await page.locator('.home-caption').waitFor();
        const final = (await api('state')).state;
        assert.deepEqual(final.logs, feed.state.logs); assert.equal(final.careCount, feed.state.careCount);
        assert.deepEqual(writes, []); assert.deepEqual(errors, []); rolling = true;
      }
      results.push({ ...mode, sleeping, empty, rolling, writes, errors });
    } catch (error) {
      await page.screenshot({ path: join(dir, `failure-${label}.png`) });
      console.error('Artifacts:', dir); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
