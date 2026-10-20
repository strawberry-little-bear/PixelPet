// One real-clock route and one real discovery/abandon journey, then explicitly
// intercepted layout fixtures. Independent build, random port and temporary DB.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-walk-discoveries-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const regionSelector = '.walk-discoveries';
const parkNames = { leaf: '银杏叶', pinecone: '小松果', feather: '落羽', flower: '落花', shell: '水边贝壳', pebble: '圆石子' };
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
async function expectedFinds(page, game) {
  const n = game.walking, count = Math.floor(n.beat / 24);
  assert.deepEqual(await page.locator(`${regionSelector} li > strong`).allTextContents(), n.souvenirs.slice(0, count).map(id => parkNames[id]));
  assert.deepEqual(await page.locator(`${regionSelector} li > span`).allTextContents(), Array.from({ length: count }, (_, i) => `第 ${(i + 1) * 24} 步`));
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const errors = await page.locator(regionSelector).evaluate(el => {
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
  assert.deepEqual(errors, [], 'summary text clipped / overlaps footer');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  const note = page.locator('.walk-discoveries-note'); await note.scrollIntoViewIfNeeded();
  const b = await note.boundingBox(), viewport = page.viewportSize();
  assert(b.y < viewport.height && b.y + b.height > 0, 'bottom note must be reachable');
}
async function readingKeys(page, writes) {
  const region = page.locator(regionSelector); await region.focus();
  await region.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const oldY = await page.evaluate(() => scrollY), count = writes.length;
  await page.keyboard.press('ArrowDown'); await wait(250);
  await page.keyboard.press('Space'); await wait(300);
  assert(await page.evaluate(() => scrollY) > oldY, 'native reading keys must actually scroll');
  await page.keyboard.press('Enter'); await wait(300);
  assert.equal(writes.length, count, 'reading keys must not resume / collect');
  assert(await region.evaluate(el => el === document.activeElement), 'reading must retain focus');
}
async function reach(page, beat) {
  const deadline = Date.now() + 110000, resumptions = [];
  while (Date.now() < deadline) {
    const result = await api('state');
    if (result.state.game.walking.beat >= beat) return { result, resumptions };
    if (await page.locator('.walk-pause').isVisible()) {
      resumptions.push(Date.now()); assert(resumptions.length <= 6, 'host repeatedly suspended');
      await key(page, 'c'); // Expired foreground leases need explicit resume, never a clock change.
    }
    await wait(200);
  }
  throw Error(`walk did not reach ${beat} naturally`);
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
  await api('import', { schema: 1, revision: 1, species: 3, name: '沿途慢慢看', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } });
  await api('action', { kind: 'play-walk' });
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
  await page.goto(base); await page.locator(regionSelector).waitFor();
  assert.match(await page.locator(regionSelector).innerText(), /还没走到发现点/);
  const empty = (await api('state')).state; assert.equal(empty.park.finds.length, 0);
  await key(page, 'c'); assert.equal(await page.locator(regionSelector).count(), 0, 'do not enlarge the running game');
  const reached = await reach(page, 28); await key(page, 'c'); await page.locator('.walk-pause').waitFor();
  const paused = (await api('state')).state; assert(paused.game.walking.beat >= 28 && paused.game.walking.beat < 48);
  await expectedFinds(page, paused.game); await readable(page); await readingKeys(page, writes);
  assert.deepEqual((await api('state')).state.game, paused.game, 'reading changed the route');
  await page.reload(); await page.locator(regionSelector).waitFor();
  const afterReload = writes.length; await wait(1600);
  await expectedFinds(page, paused.game); assert.equal(writes.length, afterReload, 'reload auto-resumed');
  assert.deepEqual((await api('state')).state.game, paused.game);
  // The total album is still accessible and returns to this same paused route.
  await page.locator(regionSelector).focus(); await page.keyboard.press('a'); await page.keyboard.press('b');
  await page.locator('.park-album').waitFor(); await key(page, 'c'); await page.locator(regionSelector).waitFor();
  await expectedFinds(page, paused.game); assert.equal(writes.length, afterReload);
  await page.locator(regionSelector).focus(); await page.keyboard.press('c');
  const terminal = await reach(page, 72); await page.locator(regionSelector).waitFor();
  const finished = terminal.result; await expectedFinds(page, finished.state.game); await readable(page); await readingKeys(page, writes);
  assert.equal(finished.state.careCount, 0); assert.equal(finished.state.economy.coins, 0, 'reading awarded coins');
  await page.screenshot({ path: join(dir, 'natural-route-finds.png'), fullPage: true });
  await page.locator(regionSelector).focus(); await page.keyboard.press('b'); await page.locator('.home-caption').waitFor();
  const settled = (await api('state')).state;
  assert.equal(writes.filter(a => a.kind === 'walk-finish').length, 1);
  assert.equal(settled.careCount, 1); assert.equal(settled.park.walks, 1);
  assert.deepEqual(settled.park.finds, finished.state.park.finds);
  assert.equal(settled.economy.coins, 3 + Math.floor(finished.state.game.walking.cleared / 4));
  await page.reload(); await page.locator('.home-caption').waitFor(); assert.equal(await page.locator(regionSelector).count(), 0);
  assert.equal((await api('state')).state.careCount, 1, 'reload collected twice');
  results.push({ type: 'natural-full-route-read-reload-album-return-manual-settlement', beatAtPause: paused.game.walking.beat,
    souvenirs: finished.state.game.walking.souvenirs, resumptions: [...reached.resumptions, ...terminal.resumptions] });
  // A new real run must not show the previous route or synthesize history.
  await api('action', { kind: 'play-walk' }); await page.reload(); await page.locator(regionSelector).waitFor();
  assert.equal(await page.locator(`${regionSelector} li`).count(), 0); await key(page, 'c');
  const abandonedJourney = await reach(page, 28); await key(page, 'c'); await page.locator(regionSelector).waitFor();
  const beforeAbandon = (await api('state')).state; await expectedFinds(page, beforeAbandon.game);
  for (const k of ['a', 'a', 'b']) await key(page, k);
  await page.locator('.game-abandon').waitFor(); await key(page, 'b'); await page.locator('.home-caption').waitFor();
  const abandoned = (await api('state')).state;
  assert.deepEqual(abandoned.park.finds, beforeAbandon.park.finds);
  assert.equal(abandoned.careCount, settled.careCount); assert.equal(abandoned.economy.coins, settled.economy.coins);
  assert.equal(await page.locator(regionSelector).count(), 0);
  const backup = await api('backup'); await api('import', backup); const restored = (await api('state')).state;
  assert.deepEqual(restored.park.finds, abandoned.park.finds);
  assert.equal(restored.park.walks, abandoned.park.walks); assert.equal(restored.economy.coins, abandoned.economy.coins);
  assert.deepEqual(errors, []);
  results.push({ type: 'natural-discovery-abandon-keeps-finds-no-reward-and-backup-roundtrip', resumptions: abandonedJourney.resumptions });
  await context.close();
  // Layout-only response fixtures. They do not create saved discoveries, natural
  // play evidence or a new permanent route history. Include repeated finds.
  for (const width of [320, 1200]) for (const font of [14, 28]) for (const beat of [0, 28, 48, 72]) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width === 320,
      reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    const p = await ctx.newPage(), runtimeErrors = [], fixtureWrites = [];
    p.on('pageerror', e => runtimeErrors.push(e.message));
    const fixture = structuredClone(finished); fixture.state.game.walking.beat = beat; fixture.state.game.walking.paused = true;
    fixture.state.game.walking.souvenirs = ['leaf', 'shell', 'leaf']; fixture.state.game.walking.cleared = 0;
    await p.route('**/api/**', route => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/action') fixtureWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: fixture });
    });
    await p.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
    await p.goto(base); await p.locator(regionSelector).waitFor(); await expectedFinds(p, fixture.state.game); await readable(p);
    await readingKeys(p, fixtureWrites); assert.deepEqual(fixtureWrites, []); assert.deepEqual(runtimeErrors, []);
    if (width === 320 && beat === 72) await p.screenshot({ path: join(dir, `320-${font}-route.png`), fullPage: true });
    results.push({ type: 'intercepted-layout-and-native-reading', width, font, beat }); await ctx.close();
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }, null, 2));
} catch (e) {
  await writeFile(join(dir, 'failure.txt'), String(e.stack || e)); console.error(`Artifacts: ${dir}`); throw e;
} finally {
  await browser?.close(); server?.kill('SIGTERM'); await writeFile(join(dir, 'server.log'), log);
}
