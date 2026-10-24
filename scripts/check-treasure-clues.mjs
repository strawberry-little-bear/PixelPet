// Controlled clue journeys, not blind play: only this temporary service's map
// chooses a route. All play after setup uses physical A/B/C, never grid clicks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-clues-'));
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
const results = [];
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  const button = page.locator(`.button-${letter}:not(:disabled)`); await button.waitFor();
  if (page.viewportSize().width < 700) await button.tap(); else await page.keyboard.press(letter);
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function select(page, index) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const selected = await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label');
    if (selected.startsWith(`${index + 1}号格`)) return;
    await key(page, 'a');
  }
  assert.fail(`Could not select ${index + 1}`);
}
const neighbors = index => Array.from({ length: 9 }, (_, at) => at).filter(at => at !== index &&
  Math.abs(Math.floor(at / 3) - Math.floor(index / 3)) <= 1 && Math.abs(at % 3 - index % 3) <= 1);
async function clue(page, index, layout) {
  const cells = page.locator('.treasure-grid [role=gridcell]'), nearby = neighbors(index);
  assert.equal(await page.locator('[data-clue-source=true]').count(), 1, 'latest empty clue source missing');
  assert.equal(await cells.nth(index).getAttribute('data-clue-source'), 'true');
  const marked = await cells.evaluateAll(cells => cells.flatMap((cell, at) => cell.dataset.clueNeighbor === 'true' ? [at] : []));
  assert.deepEqual(marked, nearby);
  const count = nearby.filter(at => layout[at] > 0).length;
  assert((await page.locator('.treasure-clue').textContent()).includes(`${index + 1}号格 · 数字 ${count}`));
  assert((await page.locator('.treasure-clue').textContent()).includes('含斜角及已找到的小物'));
  for (const at of nearby) {
    assert((await cells.nth(at).getAttribute('aria-label')).includes(`在${index + 1}号格线索范围内`));
    assert((await cells.nth(at).locator('small').textContent()).includes('邻'));
  }
  for (let at = 0; at < 9; at++) {
    if (await cells.nth(at).getAttribute('data-opened') === 'false') {
      assert((await cells.nth(at).getAttribute('aria-label')).includes('未探索'));
      assert.equal(await cells.nth(at).locator('span').textContent(), '未探索', 'hidden object leaked');
      assert.equal(await cells.nth(at).locator('strong').textContent(), '?');
    }
  }
  await readable(page);
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const clipped = await page.locator('.treasure-game').evaluate(el => {
    const errors = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const scrollParent = text.parentElement?.closest('.lcd-content');
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), b = parent.getBoundingClientRect();
          // The LCD shell clips its child by design. A treasure panel inside
          // the scrollable LCD may legitimately have lines outside the
          // current scroll window; those lines must be checked at the bottom
          // below instead of treated as permanently clipped.
          const clipsScrollableLcd = scrollParent && parent.contains(scrollParent);
          if (!clipsScrollableLcd && /hidden|clip/.test(style.overflowY) && (box.top < b.top - 2 || box.bottom > b.bottom + 2)) errors.push('vertical: ' + text.textContent);
          if (/hidden|clip/.test(style.overflowX) && (box.left < b.left - 2 || box.right > b.right + 2)) errors.push('horizontal: ' + text.textContent);
        }
      }
    }
    return [...new Set(errors)];
  });
  assert.deepEqual(clipped, [], 'treasure text clipped');
  const bottomReadable = await page.locator('.lcd-content').evaluate(container => {
    const previous = container.scrollTop;
    const rule = container.querySelector('.treasure-rule')?.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    // The app may render a daily allowance panel after the game. Scroll to
    // the game's own rule footer rather than blindly using the LCD's absolute
    // bottom, which could place the footer just above that following panel.
    if (rule) container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
      previous + rule.bottom - viewport.bottom));
    const after = container.getBoundingClientRect();
    const visibleRule = container.querySelector('.treasure-rule')?.getBoundingClientRect();
    const status = container.querySelector('.treasure-status')?.getBoundingClientRect();
    const visible = (box) => !!box && box.top < after.bottom + 1 && box.bottom > after.top - 1;
    container.scrollTop = previous;
    return { rule: visible(visibleRule), status: visible(status) };
  });
  assert.equal(bottomReadable.rule, true, 'treasure rule cannot be read at LCD bottom');
  assert.equal(bottomReadable.status, true, 'treasure status cannot be read at LCD bottom');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [{ name: 'desktop-corner', width: 1200, height: 850, font: 14 },
    { name: 'phone-large-forced', width: 320, height: 480, font: 28 }]) {
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '慢慢找线索',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const started = await api('action', { kind: 'play-treasure' }), layout = started.state.game.treasure.layout;
    // Four corners / four edges guarantee an empty choice with only three items.
    const first = (mode.width > 700 ? [0, 2, 6, 8] : [4, 1, 3, 5, 7]).find(at => layout[at] === 0);
    assert.notEqual(first, undefined);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.width < 700 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.treasure-pause').waitFor();
      assert.equal(await page.locator('.treasure-clue').count(), 0);
      await key(page, 'c'); await select(page, first); await key(page, 'b'); await clue(page, first, layout);
      await page.screenshot({ path: join(dir, `${mode.name}-clue.png`), fullPage: true });
      const count = writes.length; await key(page, 'a'); await clue(page, first, layout); assert.equal(writes.length, count, 'selection wrote');
      await key(page, 'c'); await page.locator('.treasure-pause').waitFor();
      await page.reload(); await page.locator('.treasure-pause').waitFor(); const pausedWrites = writes.length;
      await wait(350); assert.equal(writes.length, pausedWrites, 'reload automatically resumed'); await clue(page, first, layout);
      assert.deepEqual((await api('state')).state.game.treasure.opened, [first]);
      await page.screenshot({ path: join(dir, `${mode.name}-paused.png`), fullPage: true });
      await key(page, 'c');
      const found = neighbors(first).find(at => layout[at] > 0) ?? layout.findIndex(item => item > 0);
      await select(page, found); await key(page, 'b'); await clue(page, first, layout);
      assert((await page.locator('.treasure-result').textContent()).includes('已找到'));
      const second = layout.findIndex((item, at) => !item && at !== first);
      await select(page, second); await key(page, 'b'); await clue(page, second, layout);
      const opened = [first, found, second];
      for (let at = 0; opened.length < 6; at++) {
        if (layout[at] || opened.includes(at)) continue;
        await select(page, at); await key(page, 'b'); opened.push(at);
      }
      await page.locator('.treasure-game[data-done=true]').waitFor(); await readable(page);
      assert.equal(await page.locator('[data-clue-source=true],[data-clue-neighbor=true],.treasure-clue').count(), 0);
      assert.equal(await page.getByText('留在林间', { exact: true }).count(), 2);
      const terminal = (await api('state')).state; assert.deepEqual(terminal.game.treasure.opened, opened);
      assert.equal(terminal.economy.coins, 0); assert.equal(terminal.careCount, 0);
      await page.screenshot({ path: join(dir, `${mode.name}-done.png`), fullPage: true });
      await page.reload(); await page.locator('.treasure-game[data-done=true]').waitFor();
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 0);
      await key(page, 'b'); await page.locator('.treasure-game').waitFor({ state: 'detached' });
      await page.reload(); await page.locator('.home-caption').waitFor(); const settled = (await api('state')).state;
      assert(!settled.game); assert.equal(settled.careCount, 1); assert.equal(settled.economy.coins, 4);
      assert.equal(writes.filter(w => w.kind === 'treasure-dig').length, 6);
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 1);
      assert.deepEqual(errors, []); results.push({ mode: mode.name, layout, opened, firstNeighbors: neighbors(first), writes, coins: settled.economy.coins });
    } catch (error) {
      await page.screenshot({ path: join(dir, `${mode.name}-failure.png`), fullPage: true }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exit = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exit;
  }
}
