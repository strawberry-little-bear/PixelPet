// Real-clock catches/reload/album/settlement on a temporary DB, followed by
// explicitly intercepted layout cases. Never touch the player's service/build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-fishing-catches-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const region = '.fishing-catches';
const names = { 'reed-minnow': '青苇小鲦', 'sun-carp': '暖阳小鲤', 'ribbon-loach': '丝带泥鳅',
  'lotus-fish': '荷花小鱼', 'moon-perch': '月纹小鲈', 'pebble-goby': '石斑虾虎', 'rain-koi': '雨珠小鲤' };
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }); assert(r.ok, `${path}: ${await r.clone().text()}`); return r.json();
}
async function key(page, k) {
  await page.locator(`.button-${k}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function catches(page, expected) {
  assert.deepEqual(await page.locator(`${region} li > strong`).allTextContents(), expected.map(id => names[id]));
  assert.deepEqual(await page.locator(`${region} li > span`).allTextContents(), expected.map((_, i) => `第 ${i + 1} 条`));
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const errors = await page.locator(region).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const bounds = el.getBoundingClientRect(), errors = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < Math.max(bounds.left, content.left) - 1 || box.right > Math.min(bounds.right, content.right) + 1 ||
          box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top, bounds.bottom) + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), b = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(style.overflowY) && (box.top < b.top - 1 || box.bottom > b.bottom + 1)) errors.push('clipped: ' + text.textContent);
        }
      }
    }
    return errors;
  });
  assert.deepEqual(errors, [], 'catch text clipped / overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  const note = page.locator('.fishing-catches-note'); await note.scrollIntoViewIfNeeded();
  const box = await note.boundingBox(); assert(box.y < page.viewportSize().height && box.y + box.height > 0, 'bottom note unreachable');
}
async function readingKeys(page, writes) {
  await page.locator(region).focus();
  await page.locator(region).evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const oldY = await page.evaluate(() => scrollY), count = writes.length;
  await page.keyboard.press('ArrowDown'); await wait(250); await page.keyboard.press('Space'); await wait(300);
  assert(await page.evaluate(() => scrollY) > oldY, 'reading keys must scroll');
  await page.keyboard.press('Enter'); await wait(200);
  assert.equal(writes.length, count, 'native reading resumed or collected');
  assert(await page.locator(region).evaluate(el => el === document.activeElement));
}
async function catchNaturally(page) {
  await key(page, 'b'); const deadline = Date.now() + 75000; let resumes = 0;
  while (Date.now() < deadline) {
    if (await page.locator('.fishing-bite').count()) {
      await key(page, 'b');
      const s = (await api('state')).state;
      assert.equal(s.game.fishing.outcome, 'caught'); return { state: s, resumes };
    }
    if (await page.locator('.fishing-pause').count()) {
      assert(++resumes <= 5, 'host repeatedly suspended'); await key(page, 'c');
    }
    await wait(150);
  }
  throw Error('no natural bite within deadline');
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_WEB: web,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_ADDR: `127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '池塘慢慢看', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } });
  await api('action', { kind: 'play-fishing' });
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
  await page.goto(base); await page.locator('.fishing-game').waitFor();
  assert.equal(await page.locator(region).count(), 0);
  const first = await catchNaturally(page); await key(page, 'c');
  await page.locator(region).waitFor(); await catches(page, first.state.game.fishing.catches); await readable(page); await readingKeys(page, writes);
  await page.reload(); await page.locator(region).waitFor(); await catches(page, first.state.game.fishing.catches);
  assert.equal((await api('state')).state.game.fishing.paused, true);
  const beforeAlbum = writes.length; await key(page, 'a'); await key(page, 'b'); await page.locator('.fish-album').waitFor();
  await key(page, 'c'); await page.locator(region).waitFor(); assert.equal(writes.length, beforeAlbum);
  await catches(page, first.state.game.fishing.catches); await key(page, 'c');
  assert.equal(await page.locator(region).count(), 0);
  const second = await catchNaturally(page);
  await key(page, 'b'); await key(page, 'b'); // third cast is explicitly reeled early
  await page.locator(region).waitFor(); const finished = await api('state');
  assert.equal(finished.state.game.fishing.phase, 'done'); assert.equal(finished.state.game.fishing.outcome, 'early');
  assert.equal(finished.state.game.fishing.catches.length, 2);
  await catches(page, finished.state.game.fishing.catches); await readable(page); await readingKeys(page, writes);
  assert.equal(finished.state.careCount, 0); assert.equal(finished.state.economy.coins, 0);
  await page.screenshot({ path: join(dir, 'real-two-catches-last-early.png'), fullPage: true });
  await page.locator(region).focus(); await page.keyboard.press('b'); await page.locator('.home-caption').waitFor();
  const settled = (await api('state')).state;
  assert.equal(writes.filter(a => a.kind === 'fish-finish').length, 1);
  assert.equal(settled.careCount, 1); assert.equal(settled.economy.coins, 4);
  assert.deepEqual(settled.pond.fish, finished.state.pond.fish);
  await page.reload(); await page.locator('.home-caption').waitFor(); assert.equal(await page.locator(region).count(), 0);
  assert.equal((await api('state')).state.careCount, 1);
  results.push({ type: 'natural-two-catches-pause-album-reload-last-early-read-and-explicit-settlement', catches: finished.state.game.fishing.catches,
    resumes: first.resumes + second.resumes });
  // Fresh session, a real catch, then abandon: album persists but no new reward.
  await api('action', { kind: 'play-fishing' }); await page.reload(); await page.locator('.fishing-game').waitFor();
  await key(page, 'c'); await page.locator(region).waitFor(); await catches(page, []); await key(page, 'c');
  const abandonCatch = await catchNaturally(page); await key(page, 'c'); await page.locator(region).waitFor();
  for (const k of ['a', 'a', 'b', 'b']) await key(page, k);
  await page.locator('.home-caption').waitFor(); const abandoned = (await api('state')).state;
  assert.deepEqual(abandoned.pond.fish, abandonCatch.state.pond.fish);
  assert.equal(abandoned.careCount, settled.careCount); assert.equal(abandoned.economy.coins, settled.economy.coins);
  const backup = await api('backup'); await api('import', backup);
  assert.deepEqual((await api('state')).state.pond.fish, abandoned.pond.fish);
  assert.deepEqual(errors, []); results.push({ type: 'natural-fresh-session-abandon-keeps-album-no-award-and-backup-roundtrip' });
  await ctx.close();
  // Deliberate response fixtures: layout compatibility is not natural play evidence.
  for (const width of [320, 1200]) for (const font of [14, 28]) for (const scenario of ['empty', 'duplicate', 'done', 'missing', 'nil']) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width === 320,
      reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    const p = await context.newPage(), runtimeErrors = [], fixtureWrites = [];
    p.on('pageerror', e => runtimeErrors.push(e.message));
    const fixture = structuredClone(finished), n = fixture.state.game.fishing;
    const empty = ['empty', 'missing', 'nil'].includes(scenario);
    Object.assign(n, { paused: true, phase: scenario === 'done' ? 'done' : 'result',
      casts: scenario === 'done' ? 3 : empty ? 1 : 2, spot: scenario === 'done' ? 1 : 0,
      catches: empty ? [] : scenario === 'done' ? ['sun-carp', 'lotus-fish', 'moon-perch'] : ['reed-minnow', 'reed-minnow'],
      candidate: scenario === 'done' ? 'moon-perch' : 'reed-minnow',
      lastFish: empty ? '' : scenario === 'done' ? 'moon-perch' : 'reed-minnow', outcome: empty ? 'missed' : 'caught' });
    fixture.state.pond.fish = [...new Set(n.catches)].map(id => ({ id, count: n.catches.filter(f => f === id).length,
      firstAt: fixture.state.lastTick, lastAt: fixture.state.lastTick }));
    if (scenario === 'missing') delete n.catches; if (scenario === 'nil') n.catches = null;
    await p.route('**/api/**', route => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/action') fixtureWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: fixture });
    });
    await p.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
    await p.goto(base); await p.locator(region).waitFor(); await catches(p, n.catches ?? []); await readable(p); await readingKeys(p, fixtureWrites);
    assert.deepEqual(fixtureWrites, []); assert.deepEqual(runtimeErrors, []);
    if (width === 320 && scenario === 'done') await p.screenshot({ path: join(dir, `320-${font}-done.png`), fullPage: true });
    results.push({ type: 'intercepted-layout-and-native-reading', width, font, scenario }); await context.close();
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }, null, 2));
} catch (e) {
  await writeFile(join(dir, 'failure.txt'), String(e.stack || e)); console.error(`Artifacts: ${dir}`); throw e;
} finally {
  await browser?.close(); server?.kill('SIGTERM'); await writeFile(join(dir, 'server.log'), log);
}
