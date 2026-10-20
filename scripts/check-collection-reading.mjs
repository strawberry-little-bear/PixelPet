// Real HTTP reading navigation with a disposable save, random port and isolated build.
// Imported discovery records are explicit layout fixtures, not natural catches/walks.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Use an isolated web build');
const sharedPath = path => realpath(path).catch(error => { if (error.code === 'ENOENT') return resolve(path); throw error; });
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')), 'Do not run the shared binary');
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-collection-reading-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, `${path}: ${await res.clone().text()}`); return res.json();
}
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function visible(page, selector) {
  await wait(50); const box = await page.locator(selector).boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `${selector} outside native viewport: ${JSON.stringify(box)}`);
}
async function index(page, kind) {
  return kind === 'fish' ? page.locator('.fish-album-grid > div').evaluateAll(items => items.findIndex(el => el.getAttribute('aria-current') === 'true'))
    : Number((await page.locator('.park-album > header').innerText()).match(/·\s*(\d+)\s*\/\s*6/)[1]) - 1;
}
async function readable(page, kind) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  assert.equal(await page.locator(`.${kind}-album > header`).count(), 1);
  const problems = await page.locator(`.${kind}-album`).evaluate(el => {
    const bounds = document.querySelector('.lcd-content').getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const header = el.querySelector('header').getBoundingClientRect(), next = el.querySelector('header').nextElementSibling.getBoundingClientRect(), problems = [];
    for (const child of el.querySelectorAll('header > *')) {
      const box = child.getBoundingClientRect();
      if (box.top < header.top - 1 || box.bottom > header.bottom + 1 || box.bottom > next.top + 1) problems.push('header overlap: ' + child.textContent);
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > Math.min(bounds.bottom, footer.top) + 1) problems.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if ((/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) ||
              (/hidden|clip|auto|scroll/.test(css.overflowX) && (box.left < rect.left - 1 || box.right > rect.right + 1))) problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'collection text clipped or overlaps artwork/footer');
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
  for (const kind of ['fish', 'park']) for (const paused of [false, true]) for (const collection of ['nil', 'omitted', 'empty', 'known']) for (const mode of modes) {
    const at = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '图鉴伙伴', createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at,
      sleeping: false, needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [] });
    {
      const fixture = (await api('state')).state;
      const discoveries = ids => ids.map(id => ({ id, count: 2, firstAt: fixture.lastTick, lastAt: fixture.lastTick }));
      fixture.pond.fish = discoveries(['reed-minnow', 'sun-carp', 'ribbon-loach', 'lotus-fish', 'moon-perch', 'pebble-goby', 'rain-koi']);
      fixture.park.finds = discoveries(['leaf', 'pinecone', 'feather', 'flower', 'shell', 'pebble']);
      if (collection !== 'known') {
        fixture.pond.fish = collection === 'empty' ? [] : null;
        fixture.park.finds = collection === 'empty' ? [] : null;
        if (collection === 'omitted') { delete fixture.pond.fish; delete fixture.park.finds; }
      }
      await api('import', fixture);
    }
    if (paused) {
      const game = (await api('action', { kind: kind === 'fish' ? 'play-fishing' : 'play-walk' })).state.game;
      if (kind === 'fish') await api('action', { kind: 'fish-pause', gameId: game.id, step: game.fishing.step });
    }
    // Import intentionally copies nil slices to []. Seed only this disposable
    // SQLite save to cover other validator-legal persisted JSON representations.
    if (collection === 'nil' || collection === 'omitted') {
      const fixture = (await api('state')).state;
      fixture.pond.fish = null; fixture.park.finds = null;
      if (collection === 'omitted') { delete fixture.pond.fish; delete fixture.park.finds; }
      execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("UPDATE saves SET body=? WHERE id=1",(sys.stdin.read(),)); c.commit(); c.close()', join(dir, 'test.db')], { input: JSON.stringify(fixture) });
    }
    const before = (await api('state')).state;
    const expected = collection === 'empty' ? [] : null;
    if (collection !== 'known') {
      assert.deepEqual(before.pond.fish, expected, 'HTTP persisted read did not preserve the empty fish slice');
      assert.deepEqual(before.park.finds, expected, 'HTTP persisted read did not preserve the empty park slice');
    }
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, isMobile: mode.width < 700,
      reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], label = `${kind}-${paused}-${collection}-${mode.width}-${mode.height}`; let reads = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) reads++; });
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    try {
      const pause = kind === 'fish' ? '.fishing-pause' : '.walk-pause';
      await page.goto(base); await page.locator(paused ? pause : '.home-caption').waitFor();
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      await key(page, 'A');
      if (!paused) for (let i = 0; i < (kind === 'fish' ? 10 : 11); i++) await key(page, 'A');
      await key(page, 'B'); await page.locator(`.${kind}-album`).waitFor({ timeout: 5000 });
      const count = kind === 'fish' ? 7 : 6;
      for (let n = 0; n < count; n++) {
        assert.equal(await index(page, kind), n);
        if (collection !== 'known') {
          assert.match(await page.locator(`.${kind}-album > header`).innerText(), kind === 'fish' ? /已发现 0 \/ 7/ : /0 \/ 6 种/);
          assert.match(await page.locator(`.${kind}-album > h3`).innerText(), /还未遇见/);
        }
        await visible(page, `.${kind}-album > header`); await readable(page, kind);
        if (n === 0) await page.screenshot({ path: join(dir, `visible-${label}.png`) });
        // Read all the way to the last hint, then use an actual machine key.
        await page.locator(`.${kind}-album > small:last-child`).scrollIntoViewIfNeeded();
        await key(page, n % 2 ? 'A' : 'B');
      }
      assert.equal(await index(page, kind), 0); await visible(page, `.${kind}-album > header`);
      await page.evaluate(() => scrollBy({ top: 70, behavior: 'instant' }));
      const position = await page.evaluate(() => scrollY), beforeReads = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === beforeReads; i++) await wait(20);
      assert(reads > beforeReads); await wait(100); assert.equal(await page.evaluate(() => scrollY), position, 'ordinary read replayed navigation');
      for (const nativeKey of ['Enter', 'Space']) {
        await page.locator('.button-b').focus(); const previous = await index(page, kind);
        await page.keyboard.press(nativeKey); assert.equal(await index(page, kind), (previous + 1) % count);
        await visible(page, `.${kind}-album > header`);
        assert(await page.locator('.button-b').evaluate(el => document.activeElement === el), 'reading stole machine-key focus');
      }
      await page.screenshot({ path: join(dir, `keyboard-${label}.png`) });
      await key(page, 'C'); await page.locator(paused ? pause : '.home-caption').waitFor();
      if (paused) await visible(page, pause);
      await page.reload(); await page.locator(paused ? pause : '.home-caption').waitFor();
      await key(page, 'A');
      if (!paused) for (let i = 0; i < (kind === 'fish' ? 10 : 11); i++) await key(page, 'A');
      await key(page, 'B'); await page.locator(`.${kind}-album`).waitFor({ timeout: 5000 });
      assert.equal(await index(page, kind), 0); await readable(page, kind);
      await key(page, 'C'); await page.locator(paused ? pause : '.home-caption').waitFor();
      assert.deepEqual(writes, []); assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference);
      const after = (await api('state')).state;
      for (const field of ['game', 'pond', 'park', 'careCount', 'economy']) assert.deepEqual(after[field], before[field]);
      results.push({ kind, paused, discoveries: collection, ...mode, pages: count });
    } catch (e) { console.error({ label, errors }); await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw e; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
