// Private HTTP/Chrome journeys; selected treasure cells use this test map.
// No player URL, shared builds, fabricated game responses or clock changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-abandon-progress-'));
const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const starts = { stars: 'play', tiles: 'play-tiles', snake: 'play-snake', tetris: 'play-tetris', fishing: 'play-fishing', walk: 'play-walk', treasure: 'play-treasure' };
const titles = ['接星星', '连连看', '贪吃蛇', '俄罗斯方块', '池塘钓鱼', '公园散步', '森林寻宝'];
const results = [];
let server, browser, startupError, log = '';
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  const button = page.locator(`.button-${letter}:not(:disabled)`); await button.waitFor();
  if (page.viewportSize().width < 700) await button.tap(); else await page.keyboard.press(letter);
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function confirmation(page, kind) {
  if (kind === 'stars' || kind === 'tiles') await key(page, 'c');
  else if (kind === 'snake') await key(page, 'b');
  else { for (let i = 0; i < (kind === 'tetris' ? 3 : 2); i++) await key(page, 'a'); await key(page, 'b'); }
  await page.locator('.game-abandon').waitFor();
}
function expected(game) {
  switch (game.kind) {
    case 'tiles': return `已配对 ${game.tiles.pairs} / 8 对`;
    case 'snake': return `已吃 ${game.snake.eaten} / 8 颗果子`;
    case 'tetris': return `已消除 ${game.tetris.lines} / 8 行 · 放下 ${game.tetris.pieces} 块`;
    case 'fishing': return `已使用 ${game.fishing.casts} / 3 竿 · 钓到 ${game.fishing.catches?.length ?? 0} 条鱼`;
    case 'walk': return `已走 ${game.walking.beat} / 72 步 · 已遇见 ${Math.floor(game.walking.beat / 24)} / 3 次发现`;
    case 'treasure': return `已探索 ${game.treasure.opened.length} / 6 格 · 实际找到 ${game.treasure.opened.filter(at => game.treasure.layout[at] > 0).length} / 3 件`;
    default: return `已完成 ${game.round} / 5 轮 · 接住 ${game.score} 颗`;
  }
}
async function selectTreasure(page, index) {
  for (let i = 0; i < 9; i++) {
    if ((await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label')).startsWith(`${index + 1}号格`)) return;
    await key(page, 'a');
  }
  assert.fail('could not select test cell');
}
async function inspect(page, name, game, title) {
  const note = page.getByLabel('本局已保存进度');
  assert.match(await note.textContent(), new RegExp(title));
  assert.equal(await note.locator('p').textContent(), expected(game));
  const layout = await page.locator('.game-abandon').evaluate(el => {
    const clipped = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), range = document.createRange();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > footer.top + 1) clipped.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), bounds = p.getBoundingClientRect();
          if (/hidden|clip/.test(style.overflowY) && (box.top < bounds.top - 2 || box.bottom > bounds.bottom + 2)) clipped.push(node.textContent);
        }
      }
    }
    return { clipped, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(el.querySelector('.abandon-progress p')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow); assert(layout.font >= .85 * layout.rootFont);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const button of await page.locator('.physical-button').all()) {
    await button.scrollIntoViewIfNeeded();
    assert(await button.evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width >= 44 && r.height >= 44 && hit !== null && el.contains(hit); }));
  }
  await note.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
  return layout;
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 }, { name: 'phone-large', width: 320, height: 380, font: 28 }]) {
    for (const [index, [kind, start]] of Object.entries(starts).entries()) {
      const now = Date.now();
      await api('import', { schema: 1, revision: 1, species: 2, name: '确认前看看', createdAt: now - 3600000,
        hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
      const initial = (await api('action', { kind: start })).state;
      const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
        isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.width < 700 ? 'active' : 'none' });
      const page = await context.newPage(), writes = [], errors = [];
      try {
        await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
        page.on('pageerror', e => errors.push(String(e)));
        page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
        await page.goto(base); await page.locator('.content-game').waitFor();
        // Zero-progress coverage for tiles/snake/tetris; genuine partial progress
        // for stars, fishing, walk and treasure, exclusively via the three keys.
        if (kind === 'stars') { await key(page, 'b'); await wait(1200); await key(page, 'b'); }
        if (kind === 'fishing') {
          // On refresh, ready fishing is locally paused until explicit resume.
          if (await page.locator('.fishing-pause').count()) await key(page, 'c');
          await key(page, 'b'); await key(page, 'b'); await key(page, 'c'); await page.locator('.fishing-pause').waitFor();
        }
        if (kind === 'walk') {
          await key(page, 'c');
          await page.waitForFunction(() => Number(document.querySelector('.walking-game header span')?.textContent.split('/')[0]) >= 24, null, { timeout: 45000 });
          await key(page, 'c'); await page.locator('.walk-pause').waitFor();
        }
        if (kind === 'treasure') {
          await key(page, 'c');
          const layout = initial.game.treasure.layout;
          for (const at of [layout.findIndex(v => v > 0), layout.findIndex(v => v === 0)]) { await selectTreasure(page, at); await key(page, 'b'); }
          await key(page, 'c'); await page.locator('.treasure-pause').waitFor();
        }
        const before = (await api('state')).state, count = writes.length;
        if (kind === 'stars') assert.equal(before.game.round, 2);
        if (kind === 'fishing') { assert.equal(before.game.fishing.casts, 1); assert.equal(before.game.fishing.outcome, 'early'); }
        if (kind === 'walk') { assert(before.game.walking.beat >= 24); assert.equal(before.park.finds.length, 1); }
        if (kind === 'treasure') assert.equal(before.game.treasure.opened.length, 2);
        await confirmation(page, kind); const layout = await inspect(page, `${mode.name}-${kind}`, before.game, titles[index]);
        await wait(1200); assert.equal(writes.length, count);
        await key(page, 'a'); await page.locator('.game-abandon').waitFor({ state: 'detached' });
        await confirmation(page, kind); await key(page, 'c'); await page.locator('.game-abandon').waitFor({ state: 'detached' });
        assert.equal(writes.length, count); assert.deepEqual((await api('state')).state.game, before.game);
        await confirmation(page, kind); await page.reload(); await page.locator('.content-game').waitFor();
        assert.equal(await page.locator('.game-abandon').count(), 0); await wait(1200);
        assert.equal(writes.length, count); assert.deepEqual((await api('state')).state.game, before.game);
        await confirmation(page, kind); assert.equal(await page.getByLabel('本局已保存进度').locator('p').textContent(), expected(before.game));
        await key(page, 'b'); await page.locator('.content-home').waitFor(); const after = (await api('state')).state;
        assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
        assert.deepEqual(after.park, before.park); assert.deepEqual(after.pond, before.pond);
        assert.equal(writes.length, count + 1); assert.equal(writes.at(-1).kind, 'cancel-play'); assert.equal(writes.at(-1).gameId, before.game.id);
        assert.deepEqual(errors, []); results.push({ mode: mode.name, kind, progress: expected(before.game), layout, writes });
      } catch (error) { await page.screenshot({ path: join(dir, `${mode.name}-${kind}-failure.png`), fullPage: true }).catch(() => {}); throw error;
      } finally { await context.close(); }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited; }
}
