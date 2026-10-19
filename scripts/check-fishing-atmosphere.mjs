// Waiting atmosphere: real server clock, own save/port/build/browser only.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-fishing-atmosphere-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
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
async function readable(page, selector) {
  const failures = await page.locator(selector).evaluate(el => {
    const bounds = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const failures = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.top < bounds.top - 1 || box.bottom > Math.min(bounds.bottom, footer.top) + 1 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({ text: node.textContent, reason: 'outside game content / overlaps footer' });
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
  for (const width of [1200, 320]) for (const font of [14, 28]) for (const motion of ['no-preference', 'reduce']) {
    await seed();
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width < 700,
      reducedMotion: motion, forcedColors: width === 320 ? 'active' : 'none' });
    let page; const errors = [], writes = [], notes = new Set();
    const tag = `${width}-${font}-${motion}`;
    try {
      console.log('RUN', tag);
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
      page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON());
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      for (const k of ['A', 'A', 'B', 'A', 'A', 'A', 'A', 'B', 'B']) await key(page, k);
      await page.locator('.fishing-game').waitFor();
      assert.equal((await api('state')).state.game.fishing.phase, 'ready');
      const sceneryKey = await page.locator('.outing-caption').getAttribute('data-scenery');
      assert(sceneryKey); await readable(page, '.fishing-game');
      for (let spot = 0; spot < 3; spot++) {
        await key(page, 'A');
        assert.equal(await page.locator('.outing-caption').getAttribute('data-scenery'), sceneryKey);
      }
      assert.equal((await api('state')).state.game.fishing.spot, 0);
      assert.equal(await page.locator('.fishing-ripples').count(), 0);
      await key(page, 'B'); await page.locator('.pond-scene[data-motion="waiting"]').waitFor();
      notes.add(await page.locator('.fishing-wait-note').innerText());
      await readable(page, '.fishing-game');
      assert((await page.locator('.fishing-status').innerText()).includes('还没咬钩'));
      assert.equal(await page.locator('.fishing-bite').count(), 0);
      assert.equal(await page.locator('.fishing-wait-note').evaluate(el => el.closest('[aria-live],[role="status"]') === null), true);
      const snapshot = () => page.locator('.pond-scene').evaluate(el => ({
        motion: el.dataset.motion,
        animations: el.getAnimations({ subtree: true }).map(a => ({ name: a.animationName, state: a.playState })),
        ripple: getComputedStyle(el.querySelector('.ripple-near')).transform,
        rippleAnimation: getComputedStyle(el.querySelector('.ripple-near')).animationName,
        bobberAnimation: getComputedStyle(el.querySelector('.fishing-bobber')).animationName,
      }));
      const moving = await snapshot(); await wait(900); const moved = await snapshot();
      if (motion === 'reduce') {
        assert.deepEqual(moving.animations, []); assert.deepEqual(moved.animations, []);
        assert.equal(moving.ripple, moved.ripple);
      } else {
        assert.equal(moving.rippleAnimation, 'pond-ripple'); assert.equal(moving.bobberAnimation, 'pond-drift');
        assert.notEqual(moving.ripple, moved.ripple, 'Ripples should visibly move, not just have a CSS name');
      }
      await page.screenshot({ path: join(dir, `waiting-${tag}.png`), fullPage: true });
      // Pause midway, then help and reload must never create an auto-resume.
      await key(page, 'C'); await page.locator('.fishing-pause').waitFor();
      const paused = (await api('state')).state.game.fishing, count = writes.length;
      assert.equal(await page.locator('.outing-caption').getAttribute('data-scenery'), sceneryKey);
      assert.equal(paused.paused, true); assert.equal(await page.locator('.fishing-wait-note').count(), 0);
      assert.deepEqual((await snapshot()).animations, []);
      await readable(page, '.fishing-game');
      await wait(1200); assert.deepEqual((await api('state')).state.game.fishing, paused); assert.equal(writes.length, count);
      await page.getByRole('button', { name: '玩法说明' }).click(); await page.getByRole('dialog').waitFor();
      assert.deepEqual((await snapshot()).animations, []);
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.reload(); await page.locator('.fishing-pause').waitFor();
      assert.equal(await page.locator('.outing-caption').getAttribute('data-scenery'), sceneryKey);
      assert.deepEqual((await snapshot()).animations, []); await wait(1200);
      assert.deepEqual((await api('state')).state.game.fishing, paused); assert.equal(writes.length, count);
      await key(page, 'C'); await page.locator('.pond-scene[data-motion="waiting"]').waitFor();
      // Wait for a genuine server bite, no injected clock or mocked result.
      const deadline = Date.now() + 65000;
      while (Date.now() < deadline) {
        const visible = await page.locator('.fishing-game').evaluate(el => ({
          motion: el.querySelector('.pond-scene').dataset.motion,
          note: el.querySelector('.fishing-wait-note')?.textContent,
          bite: !!el.querySelector('.fishing-bite'),
        }));
        if (visible.motion === 'bite') break;
        assert.equal(visible.motion, 'waiting');
        assert(visible.note); notes.add(visible.note); assert.equal(visible.bite, false);
        await readable(page, '.fishing-game');
        await wait(850);
      }
      await page.locator('.fishing-bite').waitFor({ timeout: 2000 });
      assert.equal(await page.locator('.outing-caption').getAttribute('data-scenery'), sceneryKey);
      assert.equal(await page.locator('.outing-compact:visible').count(), 0, 'Real bite gets priority over the scenery label');
      const bite = (await api('state')).state.game.fishing;
      assert.equal(bite.phase, 'bite'); assert(bite.waitMs >= 32000 && bite.waitMs <= 40000);
      assert(bite.elapsedMs < 10000, 'Original reaction window is still open');
      assert.equal(notes.size, 4, 'All four unhurried notes should be visible during a natural wait');
      assert.equal(await page.locator('.fishing-wait-note').count(), 0);
      assert.equal((await snapshot()).bobberAnimation, motion === 'reduce' ? 'none' : 'pond-nod');
      assert.equal((await snapshot()).rippleAnimation, 'none', 'Bite is not a faster ambient ripple');
      await readable(page, '.fishing-game');
      await page.screenshot({ path: join(dir, `bite-${tag}.png`), fullPage: true });
      await key(page, 'B');
      const caught = (await api('state')).state;
      assert.equal(caught.game.fishing.outcome, 'caught'); assert.equal(caught.game.fishing.catches.length, 1);
      assert.equal(caught.pond.fish.length, 1); assert.equal(caught.economy.coins, 0, 'No reward before collecting three casts');
      assert.equal(await page.locator('.fishing-ripples').count(), 0);
      assert.equal(await page.locator('.fishing-wait-note').count(), 0);
      assert.equal(await page.locator('.fishing-bite').count(), 0);
      // An early next cast remains an ordinary consumed chance, not a fake catch.
      await key(page, 'B'); await key(page, 'B');
      const early = (await api('state')).state.game.fishing;
      assert.equal(early.casts, 2); assert.equal(early.outcome, 'early'); assert.equal(early.catches.length, 1);
      assert((await page.locator('.fishing-status').innerText()).includes('这一竿已用掉'));
      assert.equal(await page.locator('.fishing-wait-note').count(), 0);
      assert.deepEqual(errors, []);
      results.push({ width, font, motion, sceneryKey, waitMs: bite.waitMs, notes: [...notes], moving, moved, writes: writes.map(a => a.kind), errors });
    } catch (e) {
      if (page) {
        await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
        await writeFile(join(dir, 'failure.json'), JSON.stringify({ tag, writes, errors, notes: [...notes], state: await api('state'), dom: await page.locator('.device').innerText() }, null, 2));
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
