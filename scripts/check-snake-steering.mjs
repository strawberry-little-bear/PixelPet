// Real isolated HTTP sessions: paused reminders reflect saved relative turns.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-snake-steering-'));
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const directions = ['右', '下', '左', '上'], results = [], journeys = [];
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
async function inspect(page, mode, tag, heading) {
  const guide = page.getByRole('region', { name: '继续后的转弯方向' });
  await guide.waitFor();
  const board = await inspectBoardDescription(page, "snake", (await api("state")).state.game.snake);
  const text = await guide.textContent();
  assert(text.includes(`蛇头现在朝${directions[heading]}`));
  assert(text.includes(`A 左转：朝${directions[(heading + 3) % 4]}`));
  assert(text.includes(`B 右转：朝${directions[(heading + 1) % 4]}`));
  assert.match(await page.locator('.snake-overlay').textContent(), /A \/ C 继续 · B 放弃确认/);
  const layout = await guide.evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) clipped.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) clipped.push(node.textContent);
        }
      }
    }
    return { clipped, font: parseFloat(getComputedStyle(el.querySelector('li')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow);
  assert(layout.font >= layout.rootFont * .85, 'reminder ignores enlarged root text');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const rect of await page.locator('.physical-button').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect(); return { width: box.width, height: box.height };
  }))) assert(rect.width >= 44 && rect.height >= 44);
  await guide.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${mode.name}-${tag}.png`), fullPage: true });
  results.push({ mode: mode.name, tag, heading, text, layout, board });
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
    { name: 'phone-large', width: 320, height: 480, font: 28, contrast: true }]) for (const turn of [-1, 1]) {
    const now = Date.now(), tag = turn < 0 ? 'left' : 'right';
    // Construct an ordinary healthy baby in this private database, then start a real game.
    await api('import', { schema: 1, revision: 1, species: 2, name: '转弯伙伴', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-snake', requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    let held = null;
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON());
      });
      await page.route('**/api/action', async route => {
        if (route.request().postDataJSON().kind !== 'snake-step' || !held) return route.continue();
        const current = held, response = await route.fetch({ maxRetries: 0 });
        current.result = await response.json(); current.request = route.request().postDataJSON();
        await current.releasePromise; await route.fulfill({ response });
      });
      await page.goto(base); await inspect(page, mode, `${tag}-0`, 0);
      for (let move = 1; move <= 3; move++) {
        let release;
        held = { releasePromise: new Promise(r => { release = r; }), release };
        await key(page, 'c'); await page.locator('.snake-overlay').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.snake-steering-guide').count(), 0);
        const previousDescription = await page.locator(".snake-field desc").textContent();
        await key(page, turn < 0 ? 'a' : 'b');
        for (let i = 0; !held.result && i < 120; i++) await wait(25);
        assert(held.result, 'automatic step did not arrive'); assert.equal(held.request.turn, turn);
        const heading = (turn * move + 4) % 4;
        assert.equal(held.result.state.game.snake.direction, heading);
        assert.equal(await page.locator(".snake-field desc").textContent(), previousDescription, "unacknowledged movement changed the board description");
        // Pause during a real persisted step whose acknowledgement is held in transit.
        await key(page, 'c');
        held.release(); held = null;
        await page.waitForFunction(heading => document.querySelector('.snake-steering-guide strong')?.textContent === `蛇头现在朝${heading}`,
          directions[heading]);
        for (let i = 0; !(await api('state')).state.game.snake.paused && i < 100; i++) await wait(20);
        const before = (await api('state')).state;
        assert(before.game.snake.paused); assert.equal(before.game.snake.step, move);
        await inspect(page, mode, `${tag}-${move}`, heading);
        const written = writes.length;
        await page.locator('.button-b:not(:disabled)').tap(); await page.locator('.game-abandon').waitFor();
        await key(page, 'c'); await page.locator('.snake-steering-guide').waitFor();
        await page.reload(); await page.locator('.snake-steering-guide').waitFor();
        await wait(800);
        assert.equal(writes.length, written, 'reminder, cancel confirmation or reload sent an action');
        assert.equal((await api('state')).state.game.snake.direction, heading);
        assert.deepEqual((await api('state')).state.game, before.game);
        await inspectBoardDescription(page, "snake", before.game.snake);
      }
      assert.deepEqual(writes.map(w => w.kind), Array.from({ length: 3 }, () => ['snake-resume', 'snake-step', 'snake-pause']).flat());
      // B still means abandon confirmation while paused, not a right turn.
      await key(page, 'b'); await page.locator('.game-abandon').waitFor();
      await key(page, 'b'); await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
      assert.equal(writes.at(-1).kind, 'cancel-play'); assert.deepEqual(errors, []);
      journeys.push({ mode: mode.name, turn, writes, coins: after.economy.coins, careCount: after.careCount });
    } finally { held?.release(); await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, journeys }, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited;
  }
}
