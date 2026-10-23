// Real HTTP / temporary SQLite / native Chrome. Low-energy fixtures are
// constructed; a short real sleep verifies the route back to manual play.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-readiness-')), results = [];
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
async function fixture() {
  const at = Date.now();
  return (await api('import', { schema: 1, species: 2, name: '需要休息的伙伴', createdAt: at - 3600000,
    hatchedAt: at - 3600000, lastTick: at, sleeping: false,
    needs: { hunger: 80, mood: 80, energy: 9.999, clean: 80 }, careCount: 0, logs: [] })).state;
}
async function key(page, k) {
  await page.locator(`.button-${k}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function openArcade(page, index = 0) {
  for (const k of ['a', 'a', 'b']) await key(page, k);
  await page.locator('.arcade-panel').waitFor();
  for (let i = 0; i < index; i++) await key(page, 'a');
}
async function readableNotice(page) {
  const note = page.locator('.game-start-note');
  const counter = page.locator('.game-guide > header small');
  if (await counter.count()) assert(await counter.evaluate(el => {
    const parent = el.parentElement.getBoundingClientRect(), rect = el.getBoundingClientRect();
    return rect.bottom <= parent.bottom + 1;
  }), 'page number intrudes into the care note');
  await note.scrollIntoViewIfNeeded();
  assert.match(await note.innerText(), /体力不足 10/);
  assert.match(await note.innerText(), /睡个好觉/);
  const problems = await note.evaluate(el => {
    const area = el.getBoundingClientRect(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), errors = [];
    let text;
    while ((text = walker.nextNode())) {
      const range = document.createRange(); range.selectNodeContents(text);
      for (const r of range.getClientRects()) if (r.width && r.height && (r.left < area.left - 1 || r.right > area.right + 1)) errors.push(text.textContent);
    }
    return errors;
  });
  assert.deepEqual(problems, [], 'care note text is horizontally clipped');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page overflows horizontally');
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ids = ['stars', 'tiles', 'snake', 'tetris', 'fishing', 'walk', 'treasure'];
  const actions = ['play', 'play-tiles', 'play-snake', 'play-tetris', 'play-fishing', 'play-walk', 'play-treasure'];
  const modes = [{ width: 1200, height: 800, font: 14 }, { width: 320, height: 568, font: 28 }, { width: 320, height: 380, font: 28 }];
  for (const [index, id] of ids.entries()) for (const seen of [false, true]) {
    const before = await fixture(), mode = modes[index % modes.length];
    // Verify the real server contract as well as the client explanation.
    const rejected = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: actions[index], requestId: `readiness-reject-${index}-${seen}` }) });
    assert(!rejected.ok, `${id} must reject insufficient energy`);
    assert.match(await rejected.text(), /累了/);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(), writes = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(r.url()); });
    await page.addInitScript(({ id, seen, font }) => {
      if (seen) localStorage.setItem(`pixelpet-guide-v1-${id}`, 'seen');
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; });
    }, { id, seen, font: mode.font });
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor(); await openArcade(page, index);
      await readableNotice(page); await key(page, 'b');
      await page.locator('.game-guide').waitFor(); await readableNotice(page);
      assert.match(await page.locator('.game-guide > small').innerText(), /B 暂不可开始/);
      assert.match(await page.locator('.lcd-bottom').innerText(), /B 暂不可开始/);
      await key(page, 'b'); assert.match(await page.locator('[role=alert]').innerText(), /睡个好觉/);
      await key(page, 'a'); await readableNotice(page); // Quick card opens rules; first-use flips the page.
      await key(page, 'a'); await readableNotice(page);
      await page.locator('.game-guide > small').scrollIntoViewIfNeeded();
      assert(await page.locator('.game-guide > small').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }), 'guide key instructions are unreachable');
      await page.screenshot({ path: join(dir, `${id}-${seen ? 'repeat' : 'first'}.png`), fullPage: true });
      await key(page, 'c'); assert.equal(await page.locator('.arcade-card[aria-current=true]').getAttribute('data-game'), id);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      for (const field of ['game', 'careCount', 'logs', 'economy']) assert.deepEqual(after[field], before[field]);
      assert.equal(await page.evaluate(id => localStorage.getItem(`pixelpet-guide-v1-${id}`), id), seen ? 'seen' : null);
      results.push({ id, seen, ...mode, passed: true });
    } finally { await context.close(); }
  }
  await fixture();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(base); await page.locator('.home-caption').waitFor(); await openArcade(page);
    await key(page, 'b'); await key(page, 'c'); await key(page, 'c');
    // Follow the suggested care route using only the three physical keys.
    for (const k of ['a', 'a', 'a', 'a', 'b']) await key(page, k);
    await page.waitForFunction(() => document.querySelector('.pet-scene')?.getAttribute('data-motion') === 'sleeping');
    assert((await api('state')).state.sleeping);
    let rested;
    for (let i = 0; i < 100; i++) { rested = (await api('visit', {})).state; if (rested.needs.energy >= 10.01) break; await wait(100); }
    assert(rested.needs.energy >= 10.01, 'short real sleep did not restore enough energy');
    for (const k of ['a', 'a', 'a', 'a', 'b']) await key(page, k);
    await page.waitForFunction(() => document.querySelector('.pet-scene')?.getAttribute('data-motion') === 'idle');
    await openArcade(page); await key(page, 'b');
    assert.equal(await page.locator('.game-start-note').count(), 0);
    assert(!(await api('state')).state.game, 'waking or reading rules automatically started a game');
    await key(page, 'b'); await page.locator('.star-game').waitFor();
    assert((await api('state')).state.game);
    results.push({ flow: 'three-key rest, short natural recovery, wake and explicit start', passed: true });
  } finally { await context.close(); }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
