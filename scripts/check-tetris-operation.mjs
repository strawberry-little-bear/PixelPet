// Selected pause operations explain their consequences before a real A/B/C action.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { inspectBoardDescription } from './inspect-board-description.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-tetris-operation-'));
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const hints = ['B / C 继续下落', '旋转一次后继续下落', '放到底并固定', '再次确认前不会丢掉本局', '返回后仍暂停'];
const results = [], journeys = [], endResults = [];
let server, browser, startupError, log = '';
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  await page.locator(`.button-${letter.toLowerCase()}:not(:disabled)`).waitFor();
  await page.keyboard.press(letter);
}
// Measure rendered geometry, so CSS regressions cannot pass by matching source text.
async function inspectGeometry(page, reading) {
  const geometry = await page.locator('.tetris-field > svg').evaluate(svg => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; };
    return { board: rect(svg), field: rect(svg.parentElement), lcd: rect(svg.closest('.lcd-content')),
      playfield: rect(svg.closest('.tetris-playfield')), root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      reading: !!svg.closest('.reading-mode'), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(geometry.reading, reading); assert(!geometry.overflow);
  const { board, field, lcd, playfield, root } = geometry;
  assert(board.x >= lcd.x - 1 && board.right <= lcd.right + 1, 'board escapes LCD');
  assert(Math.abs(board.height / board.width - 1.5) < .01, 'board cells lose their aspect ratio');
  if (reading) {
    assert(board.width > 120, 'reading board still uses tiny live dimensions');
    assert(Math.abs(field.width - Math.min(playfield.width, root * 12)) < 1, 'board ignores root size or LCD width');
    assert(Math.abs(field.height - board.height - 2) < 1, 'board is vertically clipped');
  } else {
    assert.equal(board.width, 80); assert.equal(board.height, 120); assert.equal(playfield.height, 126);
  }
  return geometry;
}
async function inspectReadability(page) {
  const layout = await page.locator('.tetris-game').evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) clipped.push(node.textContent);
        let passedScrollport = false;
        for (let p = node.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          const scrollable = ['auto', 'scroll'].includes(css.overflowY) && p.scrollHeight > p.clientHeight;
          if (scrollable) { passedScrollport = true; continue; }
          const horizontalClip = box.left < rect.left - 2 || box.right > rect.right + 2;
          const verticalClip = box.top < rect.top - 2 || box.bottom > rect.bottom + 2;
          if (horizontalClip || (!passedScrollport && verticalClip && (['hidden', 'clip'].includes(css.overflowY) || ['auto', 'scroll'].includes(css.overflowY)))) {
            clipped.push(node.textContent);
          }
        }
      }
    }
    return { clipped, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(el.querySelector('.tetris-operation-hint, .tetris-overlay > span')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow);
  assert(layout.font >= layout.rootFont * .85, 'reading text ignores enlarged size');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const box of await page.locator('.physical-button').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect(); return { width: r.width, height: r.height };
  }))) assert(box.width >= 44 && box.height >= 44);
  return layout;
}
async function inspect(page, mode, choice) {
  const board = await inspectBoardDescription(page, "tetris", (await api("state")).state.game.tetris);
  const geometry = await inspectGeometry(page, true);
  const note = page.locator('.tetris-operation-hint'); await note.waitFor();
  assert.match(await note.textContent(), new RegExp(hints[choice]));
  assert.equal(await note.getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('.tetris-drop-preview').count(), choice === 2 ? 1 : 0);
  if (choice === 2) {
    assert.match(await page.locator('.tetris-drop-preview').textContent(), /本块落下后暂不消行。按 B 才固定/);
    assert.equal(await page.locator('.tetris-preview-row').count(), 0);
  }
  const layout = await inspectReadability(page);
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${mode.name}-choice-${choice}.png`), fullPage: true });
  results.push({ mode: mode.name, choice, text: await note.textContent(), layout, board, geometry });
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
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-large', width: 320, height: 480, font: 28, contrast: true }]) {
    const now = Date.now();
    await api('import', { schema: 1, revision: 1, species: 2, name: '积木伙伴', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-tetris', requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.tetris-operation-hint').waitFor();
      const before = (await api('state')).state;
      for (let choice = 0; choice < 5; choice++) { await inspect(page, mode, choice); if (choice < 4) await key(page, 'a'); }
      await wait(1200); assert.deepEqual(writes, []);
      assert.deepEqual((await api('state')).state.game, before.game);
      // Looking at both rule pages does not resume, write or award anything.
      await key(page, 'b'); await page.locator('.game-guide').waitFor(); await key(page, 'b');
      assert.match(await page.locator('.game-guide').textContent(), /2 \/ 2/);
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      assert.match(await page.locator('.tetris-operation-hint').textContent(), /返回后仍暂停/);
      assert.deepEqual(writes, []); assert.deepEqual((await api('state')).state.game, before.game);
      // Rotate really resumes; immediately pause again before the first gravity tick.
      await key(page, 'a'); await key(page, 'a'); await key(page, 'b');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await inspectGeometry(page, false);
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      const rotated = (await api('state')).state.game.tetris;
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause']);
      assert(rotated.paused); assert.equal(rotated.active.rotation, (before.game.tetris.active.rotation + 1) % 4);
      assert.deepEqual(rotated.board, before.game.tetris.board); assert.equal(rotated.pieces, 0);
      const rotatedBoard = await inspectBoardDescription(page, "tetris", rotated);
      // Drop really locks one piece and resumes, without awarding care or coins.
      await key(page, 'a'); await key(page, 'a');
      assert.match(await page.locator('.tetris-drop-preview').textContent(), /暂不消行/);
      const unchanged = await page.locator('.tetris-drop-preview').textContent();
      // Resize a paused preview without changing its selection or saved board.
      await page.setViewportSize({ width: mode.width < 700 ? 390 : 700, height: mode.height });
      const resized = await inspectGeometry(page, true);
      assert.match(await page.locator('.tetris-drop-preview').textContent(), /暂不消行/);
      assert.deepEqual((await api('state')).state.game, { ...before.game, tetris: rotated });
      assert.equal(writes.length, 2);
      await page.setViewportSize({ width: mode.width, height: mode.height });
      await page.evaluate(() => {
        window.dropPreviewMutations = [];
        new MutationObserver(records => window.dropPreviewMutations.push(...records.map(r => r.type)))
          .observe(document.querySelector('.tetris-operation-hint'), { subtree: true, childList: true, characterData: true });
      });
      // An ordinary state read must not rewrite the unchanged announcement.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await wait(1200);
      assert.deepEqual(await page.evaluate(() => window.dropPreviewMutations), []);
      assert.equal(await page.locator('.tetris-drop-preview').textContent(), unchanged);
      await key(page, 'b');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await inspectGeometry(page, false);
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      const dropped = (await api('state')).state;
      assert.equal(dropped.game.tetris.pieces, 1); assert.equal(dropped.game.tetris.board.filter(Boolean).length, 4);
      assert(dropped.game.tetris.paused); assert.equal(dropped.economy.coins, 0); assert.equal(dropped.careCount, 0);
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause', 'tetris-drop', 'tetris-pause']);
      const droppedBoard = await inspectBoardDescription(page, "tetris", dropped.game.tetris);
      // Cancel discard, refresh and C from the drop selection retain existing mappings.
      for (let i = 0; i < 3; i++) await key(page, 'a');
      await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'c');
      await page.locator('.tetris-operation-hint').waitFor(); assert.equal(writes.length, 4);
      await page.reload(); await page.locator('.tetris-operation-hint').waitFor(); await wait(1200);
      assert.deepEqual((await api('state')).state.game, dropped.game); assert.equal(writes.length, 4);
      assert.deepEqual(await inspectBoardDescription(page, 'tetris', dropped.game.tetris), droppedBoard);
      await inspectGeometry(page, true);
      await key(page, 'a'); await key(page, 'a');
      await page.locator('.tetris-drop-preview').waitFor();
      assert.equal((await api('state')).state.game.tetris.pieces, dropped.game.tetris.pieces);
      await key(page, 'c');
      await page.locator('.tetris-operation-hint').waitFor({ state: 'detached' });
      await inspectGeometry(page, false);
      await key(page, 'c'); await page.locator('.tetris-operation-hint').waitFor();
      assert.equal((await api('state')).state.game.tetris.pieces, dropped.game.tetris.pieces, 'C from preview resumes without locking');
      for (let i = 0; i < 3; i++) await key(page, 'a');
      await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'b');
      await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
      assert.deepEqual(writes.map(w => w.kind), ['tetris-rotate', 'tetris-pause', 'tetris-drop', 'tetris-pause', 'tetris-resume', 'tetris-pause', 'cancel-play']);
      assert.deepEqual(errors, []); journeys.push({ mode: mode.name, rotatedBoard, droppedBoard, resized, writes, coins: after.economy.coins, careCount: after.careCount });
      // Prepare a genuine stacked end through legal isolated API commands. Keep
      // this separate from the keyboard journey and its write-count assertions.
      await page.close();
      let ended = (await api('action', { kind: 'play-tetris', requestId: crypto.randomUUID() })).state;
      for (let i = 0; i < 30 && !ended.game.tetris.end; i++) {
        const command = async kind => (await api('action', { kind, gameId: ended.game.id, step: ended.game.tetris.step })).state;
        ended = await command('tetris-drop');
        if (!ended.game.tetris.end) ended = await command('tetris-pause');
      }
      assert(ended.game.tetris.end); assert.equal(ended.game.tetris.lines, 0);
      const endPage = await context.newPage();
      endPage.on('pageerror', e => errors.push(String(e)));
      await endPage.goto(base); await endPage.locator('.tetris-overlay').waitFor();
      assert.match(await endPage.locator('.tetris-overlay').textContent(), /B \/ C 收好本局成绩/);
      const geometry = await inspectGeometry(endPage, true);
      const layout = await inspectReadability(endPage);
      const board = await inspectBoardDescription(endPage, 'tetris', ended.game.tetris);
      assert.equal(await endPage.locator('.tetris-drop-preview').count(), 0);
      const endNote = endPage.locator('.tetris-overlay > span');
      await endNote.scrollIntoViewIfNeeded();
      assert(await endNote.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }), 'result controls cannot be reached by scrolling');
      await endPage.screenshot({ path: join(dir, `${mode.name}-result.png`), fullPage: true });
      assert.deepEqual((await api('state')).state.game, ended.game);
      await key(endPage, 'c'); await endPage.locator('.content-home').waitFor();
      const collected = (await api('state')).state;
      assert(!collected.game); assert.equal(collected.economy.coins, 0); assert.equal(collected.careCount, 0);
      assert.deepEqual(errors, []); endResults.push({ mode: mode.name, geometry, layout, board, pieces: ended.game.tetris.pieces });
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, journeys, endResults }, null, 2));
  console.log(JSON.stringify({ passed: results.length, journeys: journeys.length, endResults: endResults.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited;
  }
}
