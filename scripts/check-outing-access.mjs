// Real paused-game navigation + explicitly intercepted text/layout fixtures.
// Only an isolated binary/build and a disposable DB; never uses player data.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-outing-access-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(error => error ? reject(error) : resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = kind => kind === 'fishing' ? '.fishing-pause' : '.walk-pause';
const field = kind => kind === 'fishing' ? 'fishing' : 'walking';
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function open(page) {
  for (const k of ['A', 'A', 'A', 'B']) await key(page, k);
  await page.locator('[data-album-category="scenery"]').waitFor();
  assert.match(await page.locator('.lcd-bottom').innerText(), /C 返回暂停/);
}
async function readable(page, selector) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page horizontal overflow');
  const errors = await page.locator(selector).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    const scrollports = [el, ...(() => {
      const parents = [];
      for (let parent = el.parentElement; parent; parent = parent.parentElement) parents.push(parent);
      return parents;
    })()].filter(node => {
      const css = getComputedStyle(node);
      return /auto|scroll/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 1;
    });
    const scrollToLine = (range, lineIndex, scrollport) => {
      const line = range.getClientRects()[lineIndex];
      if (!line) return;
      const viewport = scrollport.getBoundingClientRect();
      const target = scrollport.scrollTop + line.top - viewport.top - 12;
      scrollport.scrollTop = Math.max(0, Math.min(scrollport.scrollHeight - scrollport.clientHeight, target));
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || text.parentElement?.closest('.sr-only,[aria-hidden="true"]')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lineCount = range.getClientRects().length;
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        for (const scrollport of scrollports) scrollToLine(range, lineIndex, scrollport);
        const box = range.getClientRects()[lineIndex];
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('clipped: ' + text.textContent);
          if (/auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('unreachable: ' + text.textContent);
        }
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], 'text clipped or overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0, 'LCD gameplay controls');
  assert.equal(await page.locator('.physical-button').count(), 3);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const at = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '暂停翻手记', createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  const fixtures = {};
  for (const kind of ['fishing', 'walk']) {
    await api('action', { kind: `play-${kind}` });
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(), writes = [], errors = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/action') writes.push(request.postDataJSON()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator(kind === 'fishing' ? '.fishing-game' : '.walking-game').waitFor();
    if (kind === 'fishing') await key(page, 'C');
    await page.locator(pause(kind)).waitFor();
    const before = await api('state'), count = writes.length;
    assert(before.state.game[field(kind)].paused); fixtures[kind] = structuredClone(before);
    await readable(page, pause(kind)); await open(page); await readable(page, '.album-panel');
    assert.match(await page.locator('.album-panel').innerText(), /还没有留下风景手记/);
    await key(page, 'B'); await key(page, 'A'); await key(page, 'C'); await page.locator(pause(kind)).waitFor();
    await wait(1300); assert.equal(writes.length, count, 'returning auto-resumed');
    const after = await api('state'); assert.deepEqual(after.state.game, before.state.game); assert.deepEqual(after.state.album, before.state.album);
    await key(page, 'B'); await page.locator('.album-panel').waitFor();
    await page.reload(); await page.locator(pause(kind)).waitFor(); await wait(1300);
    assert.equal(writes.length, count, 'reload auto-resumed');
    await key(page, 'C'); assert.equal(writes.length, count + 1); assert.equal(writes.at(-1).kind, kind === 'fishing' ? 'fish-resume' : 'walk-resume');
    assert.deepEqual(errors, []); results.push({ type: 'real-empty-shortcut-return-reload-explicit-resume', kind });
    await context.close(); const current = (await api('state')).state.game;
    await api('action', { kind: 'cancel-play', gameId: current.id });
  }
  // These are UI response fixtures, not invented natural catches/discoveries.
  for (const kind of ['fishing', 'walk']) for (const width of [1200, 320]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, isMobile: width === 320, hasTouch: true, reducedMotion: 'reduce', forcedColors: scale === 2 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(scale => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      // Actual text, including px-based labels: not just a rem-only zoom.
      style.textContent = `.reading-mode .lcd-content{font-size:${12 * scale}px!important}.reading-mode .lcd-content :is(p,small,strong,b,span,li,time,header,h3){font-size:${12 * scale}px!important;line-height:1.6!important}.lcd-bottom{font-size:${9 * scale}px!important}`;
      document.head.append(style);
    }), scale);
    const fixture = structuredClone(fixtures[kind]);
    await page.route('**/api/**', async route => {
      assert(['/api/state', '/api/visit'].includes(new URL(route.request().url()).pathname), 'read-only fixture attempted write');
      fixture.serverTime = Date.now();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    try {
      for (const status of ['saved', 'empty', 'legacy']) {
        fixture.state.schema = status === 'legacy' ? 12 : 13;
        fixture.state.album.entries = status === 'saved' ? [
          { kind: 'scenery-fishing-clear', at: at - 2000, source: 'shared' }, { kind: 'scenery-walk-rain', at: at - 1000, source: 'shared' },
        ] : [];
        await page.goto(base); await page.locator(pause(kind)).waitFor(); await readable(page, pause(kind));
        await page.screenshot({ path: join(dir, `pause-${kind}-${width}-${scale}-${status}.png`), fullPage: true });
        await open(page); await readable(page, '.album-panel');
        if (status === 'saved') {
          await key(page, 'B'); assert.equal(await page.locator('.album-panel').getAttribute('data-album-kind'), 'scenery-fishing-clear'); await readable(page, '.album-panel');
          await key(page, 'A'); assert.equal(await page.locator('.album-panel').getAttribute('data-album-kind'), null);
          await key(page, 'A'); assert.equal(await page.locator('.album-panel').getAttribute('data-album-kind'), 'scenery-walk-rain'); await readable(page, '.album-panel');
        } else assert.match(await page.locator('.album-panel').innerText(), status === 'legacy' ? /请更新服务/ : /还没有留下风景手记/);
        await page.screenshot({ path: join(dir, `reader-${kind}-${width}-${scale}-${status}.png`), fullPage: true });
        await key(page, 'C'); await page.locator(pause(kind)).waitFor();
        assert.equal(await page.locator('.album-panel').count(), 0); await readable(page, pause(kind));
        results.push({ type: 'read-only-layout-fixture', kind, width, scale, status });
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: join(dir, `failure-${kind}-${width}-${scale}.png`), fullPage: true });
      console.error('Artifacts:', dir); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
