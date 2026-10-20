// Walking action timing through physical A/B/C; private build, random port and temporary save.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-walk-timing-'));
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
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const clipped = await page.locator('.walking-game').evaluate(el => {
    const errors = [];
    for (const part of el.querySelectorAll('header strong, header span, .walk-warning, .walk-find, .walk-method')) {
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode; if (!text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const box of range.getClientRects()) {
          if (!box.width || !box.height) continue;
          const bounds = part.getBoundingClientRect();
          if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) errors.push(text.textContent);
          for (let parent = part; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), b = parent.getBoundingClientRect();
            if (/hidden|clip|auto|scroll/.test(style.overflowY) && (box.top < b.top - 1 || box.bottom > b.bottom + 1)) errors.push('vertical: ' + text.textContent);
            if (/hidden|clip|auto|scroll/.test(style.overflowX) && (box.left < b.left - 1 || box.right > b.right + 1)) errors.push('horizontal: ' + text.textContent);
          }
        }
      }
    }
    const title = el.querySelector('header strong').getBoundingClientRect(), count = el.querySelector('header span').getBoundingClientRect();
    if (title.right > count.left + 1 && title.bottom > count.top + 1 && count.bottom > title.top + 1) errors.push('overlapping header');
    return errors;
  });
  assert.deepEqual(clipped, [], 'walking instructions clipped');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
async function beat(page) { return Number((await page.locator('.walking-game header span').textContent()).split('/')[0].trim()); }
async function atBeat(page, target) {
  await page.waitForFunction(target => Number(document.querySelector('.walking-game header span')?.textContent.split('/')[0]) >= target, target, { timeout: 15000 });
}
async function required(page) {
  const warning = await page.locator('.walk-warning').textContent(), match = warning.match(/ · ([AB]) /);
  assert(match, warning); return match[1].toLowerCase();
}
async function hint(page, part) {
  const actual = await page.locator('.walk-find').textContent();
  assert(actual.includes(part), `${actual} does not include ${part}`); await readable(page);
}
async function paused(page) {
  await page.locator('.walk-pause').waitFor();
  assert(!(await page.locator('.walk-find').textContent()).includes('现在按'));
  await readable(page);
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
  for (const mode of [{ name: 'desktop-rabbit', width: 1200, height: 850, font: 14, species: 2 },
    { name: 'phone-large-dolphin', width: 320, height: 480, font: 28, species: 3 }]) {
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: mode.species, name: '慢慢过障碍',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-walk' });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await paused(page); assert.equal(await beat(page), 0);
      await key(page, 'c'); await hint(page, '近 3 步再按');
      const first = await required(page); await key(page, first); await hint(page, '动作会先结束');
      await page.screenshot({ path: join(dir, `${mode.name}-early.png`), fullPage: true });
      await atBeat(page, 4); assert((await beat(page)) < 6); await hint(page, '现在按');
      await key(page, 'c'); await paused(page); const firstPause = await beat(page);
      await page.reload(); await paused(page); await wait(1200); assert.equal(await beat(page), firstPause);
      await key(page, 'c'); await atBeat(page, 6);
      assert.equal((await api('state')).state.game.walking.cleared, 0, 'early action unexpectedly cleared first obstacle');
      await atBeat(page, 9); assert((await beat(page)) < 12);
      const second = await required(page); await key(page, second === 'a' ? 'b' : 'a'); await hint(page, '现在按');
      await wait(250); await key(page, second); await hint(page, '可覆盖本处');
      await page.screenshot({ path: join(dir, `${mode.name}-covered.png`), fullPage: true });
      await key(page, 'c'); await paused(page); const secondPause = await beat(page);
      assert(secondPause < 12); await page.reload(); await paused(page); const count = writes.length;
      await wait(1200); assert.equal(writes.length, count); assert.equal(await beat(page), secondPause);
      await page.screenshot({ path: join(dir, `${mode.name}-paused.png`), fullPage: true });
      await key(page, 'c'); await hint(page, '可覆盖本处'); await atBeat(page, 12);
      assert.equal((await api('state')).state.game.walking.cleared, 1, 'timely action did not clear second obstacle');
      // Play the rest from the visible warning only. Never inspect hidden route or souvenirs to select an action.
      const acted = new Set([0, 1]), deadline = Date.now() + 100000; let resumes = 0;
      while (await beat(page) < 72 && Date.now() < deadline) {
        if (await page.locator('.walk-pause').count()) {
          assert(++resumes <= 5, 'host repeatedly suspended'); await key(page, 'c');
        }
        const current = await beat(page), obstacle = Math.floor(current / 6);
        if (current < 72 && 6 - current % 6 <= 3 && !acted.has(obstacle)) {
          await key(page, await required(page)); acted.add(obstacle);
        }
        await wait(120);
      }
      assert.equal(await beat(page), 72); await readable(page);
      const done = (await api('state')).state; assert.equal(done.game.walking.cleared, 11);
      assert.equal(done.careCount, 0); assert.equal(done.economy.coins, 0);
      await page.screenshot({ path: join(dir, `${mode.name}-done.png`), fullPage: true });
      await page.reload(); await page.locator('.walk-discoveries').waitFor();
      assert((await page.locator('.walk-warning').textContent()).includes('B / C 收好'));
      await key(page, 'b'); await page.locator('.walking-game').waitFor({ state: 'detached' });
      await page.reload(); await page.locator('.home-caption').waitFor(); const settled = (await api('state')).state;
      assert(!settled.game); assert.equal(settled.careCount, 1); assert.equal(settled.economy.coins, 5); assert.equal(settled.park.walks, 1);
      assert.equal(settled.park.finds.reduce((sum, item) => sum + item.count, 0), 3);
      assert.equal(writes.filter(w => w.kind === 'walk-step').length, 72);
      assert.equal(writes.filter(w => w.kind === 'walk-jump' || w.kind === 'walk-duck').length, 13);
      assert.equal(writes.filter(w => w.kind === 'walk-finish').length, 1);
      assert.deepEqual(errors, []); results.push({ mode: mode.name, first, second, firstPause, secondPause, resumes, writes, cleared: 11, coins: settled.economy.coins });
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
