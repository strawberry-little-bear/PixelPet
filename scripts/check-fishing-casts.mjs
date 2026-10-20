// Used fishing casts through physical A/B/C; private build, random port and temporary save.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-fishing-casts-'));
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
const results = [], pauseChecks = [];
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
  const clipped = await page.locator('.fishing-game').evaluate(el => {
    const errors = [];
    for (const part of el.querySelectorAll('header strong, header span, .fishing-status, .fishing-comment, .fishing-rule, .fishing-pause strong, .fishing-pause li, .fishing-pause small')) {
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
    const footer = document.querySelector('.lcd-bottom')?.getBoundingClientRect();
    if (footer && el.getBoundingClientRect().bottom > footer.top + 1) errors.push('game overlaps LCD key footer');
    return errors;
  });
  assert.deepEqual(clipped, [], 'cast instructions clipped');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
async function count(page, used, fish, remaining) {
  assert.equal(await page.locator('.fishing-game header span').textContent(), `已抛 ${used} / 3 竿 · ${fish} 鱼`);
  const rule = await page.locator('.fishing-rule').textContent();
  if (remaining === undefined) assert(!rule.includes('还可抛'));
  else assert(rule.includes(`还可抛 ${remaining} 竿`));
  await readable(page);
}
// Read every selected consequence before entering a reader/confirmation. These
// are navigation only: the saved phase, step and opportunity must not change.
async function pauseAdvice(page, phase, readers = false) {
  const initial = (await api('state')).state.game.fishing;
  assert(initial.paused, 'expected an explicit persisted pause');
  const expected = phase === 'bite' ? '继续后仍在咬钩阶段' : phase === 'wait' ? '继续后接着等咬钩' : '不会自动抛竿';
  assert((await page.locator('.fishing-rule').textContent()).includes(expected), 'paused advice must describe resume, not cast/reel/pause controls');
  await readable(page);
  if (readers) {
    for (const [choice, text, destination] of [
      [1, '查看累计鱼图鉴', '.fish-album'],
      [2, '先打开确认页', '.game-abandon'],
      [3, '查看风景手记', '.album-panel'],
      [4, '查看玩法说明', '.game-guide'],
    ]) {
      for (let i = 0; i < choice; i++) await key(page, 'a');
      assert((await page.locator('.fishing-rule').textContent()).includes(text), 'selected option advice');
      await readable(page);
      await page.screenshot({ path: join(dir, `${page.viewportSize().width}-${phase}-choice-${choice}.png`), fullPage: true });
      await key(page, 'b'); await page.locator(destination).waitFor();
      await key(page, 'c'); await page.locator('.fishing-pause').waitFor();
      for (let i = 0; i < 5 && !(await page.locator('.fishing-pause li.selected').textContent()).includes('继续钓鱼'); i++) await key(page, 'a');
      assert((await page.locator('.fishing-rule').textContent()).includes(expected));
    }
  }
  await wait(1200);
  const after = (await api('state')).state.game.fishing;
  assert.deepEqual(after, initial, 'pause navigation must not change the fishing session');
  pauseChecks.push({ width: page.viewportSize().width, phase, readers,
    ruleFont: await page.locator('.fishing-rule').evaluate(el => getComputedStyle(el).fontSize) });
  await page.screenshot({ path: join(dir, `${page.viewportSize().width}-${phase}-resume.png`), fullPage: true });
}
async function naturalCatch(page) {
  await key(page, 'b'); const deadline = Date.now() + 75000; let resumes = 0;
  while (Date.now() < deadline) {
    if (await page.locator('.fishing-bite').count()) {
      await count(page, 2, 0); await key(page, 'c'); await pauseAdvice(page, 'bite'); await key(page, 'c'); await key(page, 'b');
      assert.equal((await api('state')).state.game.fishing.outcome, 'caught'); return resumes;
    }
    if (await page.locator('.fishing-pause').count()) {
      assert(++resumes <= 5, 'host repeatedly suspended'); await key(page, 'c');
    }
    await wait(150);
  }
  throw Error('no real-clock bite within deadline');
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
  for (const mode of [{ name: 'desktop-catch', width: 1200, height: 850, font: 14, catch: true },
    { name: 'phone-large-early', width: 320, height: 480, font: 28, catch: false }]) {
    // Healthy old-format pet only; no imported fish, coins, completed game or clock changes.
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '池塘三竿',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    await api('action', { kind: 'play-fishing' });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await page.locator('.fishing-game').waitFor(); await count(page, 0, 0, 3);
      await page.screenshot({ path: join(dir, `${mode.name}-ready.png`), fullPage: true });
      await key(page, 'c'); await pauseAdvice(page, 'ready', true); await key(page, 'c');
      await key(page, 'b'); await count(page, 1, 0);
      await key(page, 'c'); await pauseAdvice(page, 'wait'); await key(page, 'c');
      await key(page, 'b'); await count(page, 1, 0, 2);
      assert((await page.locator('.fishing-status').textContent()).includes('这一竿已用掉'));
      await key(page, 'c'); await count(page, 1, 0); await page.reload();
      await page.locator('.fishing-pause').waitFor(); await count(page, 1, 0);
      await pauseAdvice(page, 'result', true);
      const paused = (await api('state')).state.game.fishing; assert.equal(paused.casts, 1); assert.equal(paused.paused, true);
      const before = writes.length; await wait(1200); assert.equal(writes.length, before, 'reload auto-played');
      await page.screenshot({ path: join(dir, `${mode.name}-paused.png`), fullPage: true });
      await key(page, 'c'); await count(page, 1, 0, 2);
      let resumes = 0;
      if (mode.catch) resumes = await naturalCatch(page);
      else { await key(page, 'b'); await count(page, 2, 0); await key(page, 'c'); await pauseAdvice(page, 'wait'); await key(page, 'c'); await key(page, 'b'); }
      const fish = mode.catch ? 1 : 0; await count(page, 2, fish, 1);
      await page.screenshot({ path: join(dir, `${mode.name}-result.png`), fullPage: true });
      await key(page, 'b'); await count(page, 3, fish); await key(page, 'c');
      await count(page, 3, fish); await key(page, 'c'); await key(page, 'b');
      await count(page, 3, fish);
      assert((await page.locator('.fishing-status').textContent()).includes('B / C 收好'));
      assert((await page.locator('.fishing-rule').textContent()).includes(mode.catch ? '完成可计陪伴' : '至少钓到一条'));
      await page.reload(); await page.locator('.fishing-catches').waitFor(); await count(page, 3, fish);
      const done = (await api('state')).state; assert.equal(done.game.fishing.casts, 3);
      assert.equal(done.game.fishing.catches?.length ?? 0, fish); assert.equal(done.careCount, 0); assert.equal(done.economy.coins, 0);
      await page.screenshot({ path: join(dir, `${mode.name}-done.png`), fullPage: true });
      await key(page, 'b'); await page.locator('.fishing-game').waitFor({ state: 'detached' });
      await page.reload(); await page.locator('.home-caption').waitFor();
      const settled = (await api('state')).state;
      assert(!settled.game); assert.equal(settled.careCount, fish); assert.equal(settled.economy.coins, fish ? 3 : 0);
      assert.equal(writes.filter(w => w.kind === 'fish-cast').length, 3);
      assert.equal(writes.filter(w => w.kind === 'fish-reel').length, 3);
      assert.equal(writes.filter(w => w.kind === 'fish-finish').length, 1);
      assert.deepEqual(errors, []); results.push({ mode: mode.name, pauseChecks: pauseChecks.filter(check => check.width === mode.width), resumes, writes, coins: settled.economy.coins, careCount: settled.careCount });
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
