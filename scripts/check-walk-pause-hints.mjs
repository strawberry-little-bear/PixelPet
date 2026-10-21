// Real A/B/C journeys on a private database/build. No player service URL.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-walk-pause-hints-'));
const listener = createServer();
await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const hints = ['继续自动前进，不补走', '永久沿途图鉴', '先打开放弃确认', '已保存的风景手记', '本局两页玩法'];
const results = [], journeys = [];
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
async function choose(page, index) {
  await page.locator('.walk-pause-hint').waitFor();
  const selected = await page.locator('.walk-pause span').evaluateAll(els => els.findIndex(el => el.dataset.selected === 'true'));
  assert(selected >= 0);
  for (let i = 0; i < (index - selected + 5) % 5; i++) await key(page, 'a');
  assert.match(await page.locator('.walk-pause-hint').textContent(), new RegExp(hints[index]));
}
async function inspect(page, mode, choice) {
  const note = page.locator('.walk-pause-hint'); await note.waitFor();
  assert.match(await note.textContent(), new RegExp(hints[choice]));
  assert.equal(await note.getAttribute('aria-live'), 'polite');
  assert.equal(await note.getAttribute('aria-atomic'), 'true');
  const layout = await page.locator('.walking-game').evaluate(el => {
    const clipped = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > footer.top + 1) clipped.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 2 || box.bottom > rect.bottom + 2)) clipped.push(node.textContent);
        }
      }
    }
    return { clipped, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(el.querySelector('.walk-pause-hint')).fontSize),
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  assert.deepEqual(layout.clipped, []); assert(!layout.overflow);
  assert(layout.font >= layout.rootFont * .85, 'pause hint ignores enlarged text');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  for (const button of await page.locator('.physical-button').all()) {
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate(el => {
      const r = el.getBoundingClientRect(), target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { width: r.width, height: r.height, self: el === target,
        contains: target !== null && el.contains(target), target: target?.outerHTML };
    });
    assert(hit.width >= 44 && hit.height >= 44 && hit.contains, JSON.stringify(hit));
  }
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${mode.name}-choice-${choice}.png`), fullPage: true });
  results.push({ mode: mode.name, choice, text: await note.textContent(), layout });
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
  for (const mode of [{ name: 'desktop', width: 1200, height: 850, font: 14, species: 2 },
    { name: 'phone-large', width: 320, height: 700, font: 28, contrast: true, species: 3 },
    { name: 'phone-short', width: 320, height: 380, font: 28, contrast: true, species: 3 }]) {
    const now = Date.now();
    await api('import', { schema: 1, revision: 1, species: mode.species, name: '散步伙伴', createdAt: now - 3600000,
      hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-walk', requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.walk-pause-hint').waitFor();
      const before = (await api('state')).state;
      assert.match(await page.locator('.walk-pause-hint').textContent(), /从第 1 步/);
      for (let choice = 0; choice < 5; choice++) { await choose(page, choice); await inspect(page, mode, choice); }
      // Rule pages, permanent discovery album and saved scenery are read-only.
      await key(page, 'b'); await page.locator('.game-guide').waitFor(); await key(page, 'b');
      assert.match(await page.locator('.game-guide').textContent(), /2 \/ 2/);
      await key(page, 'c'); await choose(page, 1); await key(page, 'b');
      await page.locator('.park-album').waitFor(); await key(page, 'c');
      await choose(page, 3); await key(page, 'b'); await page.locator('.album-panel').waitFor(); await key(page, 'c');
      await choose(page, 2); await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'c');
      await page.locator('.walk-pause-hint').waitFor(); await wait(1200);
      assert.deepEqual(writes, []); assert.deepEqual((await api('state')).state.game, before.game);
      await page.reload(); await page.locator('.walk-pause-hint').waitFor(); await wait(1200);
      assert.deepEqual(writes, []); assert.deepEqual((await api('state')).state.game, before.game);
      // C continues even on a non-continue selection. Walk real server steps to
      // the first discovery, then pause. No fabricated route history or clock.
      await choose(page, 2); await key(page, 'c');
      await page.locator('.walk-pause-hint').waitFor({ state: 'detached' });
      await page.waitForFunction(() => Number(document.querySelector('.walking-game header span')?.textContent.split('/')[0]) >= 24, null, { timeout: 45000 });
      await key(page, 'c'); await page.locator('.walk-pause-hint').waitFor();
      const paused = (await api('state')).state, count = writes.length;
      assert(paused.game.walking.beat >= 24 && paused.game.walking.beat < 48);
      assert.match(await page.locator('.walk-pause-hint').textContent(), new RegExp(`从第 ${paused.game.walking.beat + 1} 步`));
      assert.equal(paused.park.finds.length, 1); assert.equal(paused.economy.coins, 0); assert.equal(paused.careCount, 0);
      assert.equal(await page.locator('.walk-discoveries li').count(), 1);
      await choose(page, 1); await key(page, 'b'); await page.locator('.park-album').waitFor(); await key(page, 'c');
      await choose(page, 3); await key(page, 'b'); await page.locator('.album-panel').waitFor(); await key(page, 'c');
      await page.reload(); await page.locator('.walk-pause-hint').waitFor(); await wait(1200);
      assert.equal(writes.length, count); assert.deepEqual((await api('state')).state.game, paused.game);
      // B on discard only opens confirmation; cancel keeps progress. Only the
      // second B actually discards; actual discoveries remain, with no reward.
      await choose(page, 2); await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'c');
      await page.locator('.walk-pause-hint').waitFor(); assert.equal(writes.length, count);
      await choose(page, 2); await inspect(page, { ...mode, name: `${mode.name}-discovered` }, 2);
      await key(page, 'b'); await page.locator('.game-abandon').waitFor(); await key(page, 'b');
      await page.locator('.content-home').waitFor(); const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins, 0); assert.equal(after.careCount, 0);
      assert.deepEqual(after.park, paused.park);
      assert.deepEqual(writes.filter(w => w.kind !== 'walk-step').map(w => w.kind), ['walk-resume', 'walk-pause', 'cancel-play']);
      assert.deepEqual(errors, []); journeys.push({ mode: mode.name, beat: paused.game.walking.beat,
        writes, retainedFinds: after.park.finds, coins: after.economy.coins });
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, journeys }, null, 2));
  console.log(JSON.stringify({ passed: results.length, journeys: journeys.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exited;
  }
}
