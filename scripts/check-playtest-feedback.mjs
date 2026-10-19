// Real Chrome, own temporary save/port/build. Never accepts a player URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-playtest-entry-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
const games = ['stars', 'tiles', 'snake', 'tetris', 'fishing', 'walk'];
const actions = ['play', 'play-tiles', 'play-snake', 'play-tetris', 'play-fishing', 'play-walk'];
const wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed() {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '试玩伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function enter(page, index) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B']) await key(page, k);
  await page.locator('.arcade-panel').waitFor();
  for (let i = 0; i < index; i++) await key(page, 'A');
  assert.equal(await page.locator('.arcade-card.selected').getAttribute('data-game'), games[index]);
}
async function readable(page, selector) {
  const failures = await page.locator(selector).evaluate(el => {
    const failures = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if ((['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) &&
            (box.left < clip.left - 1 || box.right > clip.right + 1)) ||
            (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
            (box.top < clip.top - 1 || box.bottom > clip.bottom + 1))) {
            failures.push({ text: node.textContent, parent: parent.className }); break;
          }
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal page overflow');
    return failures;
  });
  assert.deepEqual(failures, [], `${selector}: clipped text`);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,[data-guide] [tabindex]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const font of [14, 28]) for (const [index, id] of games.entries()) {
    await seed();
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
      isMobile: width < 700, reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
    let page; const errors = [], writes = [];
    try {
      console.log('RUN', width, font, id);
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), font);
      page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON());
      });
      await page.goto(base); await enter(page, index); await readable(page, '.arcade-panel');
      const icons = await page.locator('.arcade-card > span').allTextContents();
      assert.equal(new Set(icons).size, 6);
      if (id === 'fishing') await page.screenshot({ path: join(dir, `icons-${width}-${font}.png`), fullPage: true });
      await key(page, 'B'); await page.locator('.game-guide:not(.game-quick-start)').waitFor();
      assert((await page.locator('.game-guide header').innerText()).includes('1 / 2'));
      await readable(page, '.game-guide');
      if (id === 'fishing') assert((await page.locator('.guide-steps').innerText()).includes('提前提竿也会用掉这一竿'));
      if (id === 'tetris') assert((await page.locator('.guide-steps').innerText()).includes('按 C 打开旋转、落底等操作'));
      await key(page, 'A'); assert((await page.locator('.game-guide header').innerText()).includes('2 / 2'));
      await readable(page, '.game-guide');
      await key(page, 'C'); await page.locator('.arcade-panel').waitFor();
      assert.equal(await page.locator('.arcade-card.selected').getAttribute('data-game'), id);
      assert.equal(writes.length, 0); assert(!(await api('state')).state.game);
      await key(page, 'B'); await key(page, 'B');
      await page.locator('.content-game').waitFor();
      await page.waitForFunction(id => localStorage.getItem(`pixelpet-guide-v1-${id}`) === 'seen', id);
      assert.deepEqual(writes.map(a => a.kind), [actions[index]]);
      const first = (await api('state')).state;
      if (index >= 2) {
        const n = first.game.snake ?? first.game.tetris ?? first.game.fishing ?? first.game.walking;
        if (id === 'fishing') { assert.equal(n.phase, 'ready'); assert.equal(n.casts, 0); }
        else assert.equal(n.paused, true);
        await wait(1200);
        const after = (await api('state')).state;
        assert.deepEqual(after.game, first.game, 'Safety pause must not auto-run');
        assert.equal(writes.length, 1);
      }
      // Keep browser preferences, replace only our own isolated save to revisit.
      await seed(); await page.reload(); await enter(page, index);
      await key(page, 'B'); await page.locator('.game-quick-start').waitFor();
      assert.equal(await page.locator('.guide-steps').count(), 0);
      assert((await page.locator('.game-guide').innerText()).includes('A 重看规则 · B 开始'));
      await readable(page, '.game-quick-start');
      if (id === 'walk') await page.screenshot({ path: join(dir, `repeat-${width}-${font}.png`), fullPage: true });
      await key(page, 'A'); await page.locator('.guide-steps').waitFor();
      assert((await page.locator('.game-guide header').innerText()).includes('1 / 2'));
      await readable(page, '.game-guide'); await key(page, 'A');
      assert((await page.locator('.game-guide header').innerText()).includes('2 / 2'));
      await readable(page, '.game-guide'); await key(page, 'C');
      assert.equal(await page.locator('.arcade-card.selected').getAttribute('data-game'), id);
      await key(page, 'B'); await page.locator('.game-quick-start').waitFor();
      assert.equal(writes.length, 1); assert(!(await api('state')).state.game);
      await key(page, 'B'); await page.locator('.content-game').waitFor();
      assert.deepEqual(writes.map(a => a.kind), [actions[index], actions[index]]);
      if (id === 'tetris') {
        assert((await page.locator('.tetris-game header').innerText()).includes('消除 0/8'));
        await readable(page, '.tetris-game');
      }
      if (id === 'fishing') {
        assert.equal((await api('state')).state.game.fishing.phase, 'ready');
        for (let cast = 1; cast <= 3; cast++) {
          await key(page, 'B'); assert.equal((await api('state')).state.game.fishing.phase, 'wait');
          await key(page, 'B');
          const n = (await api('state')).state.game.fishing;
          assert.equal(n.casts, cast); assert.equal(n.outcome, 'early'); assert.equal(n.catches.length, 0);
          assert.equal(n.phase, cast === 3 ? 'done' : 'result');
          assert((await page.locator('.fishing-status').innerText()).includes('提前提竿，这一竿已用掉'));
          await readable(page, '.fishing-game');
          if (cast === 3) await page.screenshot({ path: join(dir, `early-done-${width}-${font}.png`), fullPage: true });
        }
        await key(page, 'B'); await page.locator('.home-caption').waitFor();
        assert(!(await api('state')).state.game);
      }
      assert.deepEqual(errors, []);
      results.push({ width, font, id, writes: writes.map(a => a.kind), errors });
    } catch (e) {
      if (page) {
        await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
        await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, font, id, writes, errors,
          state: await api('state'), dom: await page.locator('.device').innerText() }, null, 2));
      }
      console.error('Artifacts:', dir); throw e;
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
