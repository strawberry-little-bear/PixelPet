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
const results = [], runningHeights = new WeakMap();
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
async function watchNavigation(page) {
  await page.evaluate(() => {
    window.walkNavigation = [];
    const live = document.querySelector('.walk-navigation-announcement');
    if (!live || live.textContent) throw new Error('expected a mounted empty running announcement while paused');
    new MutationObserver(() => window.walkNavigation.push({
      text: live.textContent, live: live.getAttribute('aria-live'),
      beat: Number(document.querySelector('.walking-game header span')?.textContent.split('/')[0]),
      warning: document.querySelector('.walk-warning')?.textContent,
    })).observe(live, { childList: true, characterData: true, subtree: true });
  });
}
async function navigationEvents(page) {
  const events = await page.evaluate(() => window.walkNavigation);
  for (const [index, event] of events.entries()) {
    assert.equal(event.live, 'polite');
    if (index) assert.notEqual(event.text, events[index - 1].text, 'unchanged navigation must not be rewritten');
    if (!event.text) continue;
    assert(event.text.startsWith(`第 ${Math.floor(event.beat / 6) + 1} 处 · `));
    assert(!event.text.includes('还有 '), 'live navigation must not count down every step');
    assert(event.text.includes(event.warning.split(' · 还有 ')[0]), 'live cue must match the visible obstacle');
  }
  return events;
}
async function readable(page) {
  if (!await page.locator('.device-stage.reading-mode').count()) {
    const height = await page.locator('.device').evaluate(el => el.getBoundingClientRect().height);
    if (runningHeights.has(page)) assert(Math.abs(height - runningHeights.get(page)) < 1, 'find changed the running shell height');
    else runningHeights.set(page, height);
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const clipped = await page.locator('.walking-game').evaluate(el => {
    if (el.closest('.device-stage')?.classList.contains('game-reading-mode')) return [];
    const errors = [], footer = el.closest('.lcd').querySelector('.lcd-bottom').getBoundingClientRect();
    for (const part of el.querySelectorAll('header strong, header span, .walk-warning, .walk-find, .walk-action-note, :scope > small')) {
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode; if (!text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const box of range.getClientRects()) {
          if (!box.width || !box.height) continue;
          const bounds = part.getBoundingClientRect();
          if (box.bottom > footer.top + 1) errors.push('footer overlap: ' + text.textContent);
          if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) errors.push(text.textContent);
          for (let parent = part; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), b = parent.getBoundingClientRect();
            if (/hidden|clip/.test(style.overflowY) && (box.top < b.top - 1 || box.bottom > b.bottom + 1)) errors.push('vertical: ' + text.textContent);
            if (/hidden|clip/.test(style.overflowX) && (box.left < b.left - 1 || box.right > b.right + 1)) errors.push('horizontal: ' + text.textContent);
          }
        }
      }
    }
    const title = el.querySelector('header strong').getBoundingClientRect(), count = el.querySelector('header span').getBoundingClientRect();
    if (title.right > count.left + 1 && title.bottom > count.top + 1 && count.bottom > title.top + 1) errors.push('overlapping header');
    return errors;
  });
  assert.deepEqual(clipped, [], 'walking instructions clipped');
  if (!await page.locator('.walk-pause').count() && await beat(page) < 72) {
    assert.equal(await page.locator('.walk-warning').getAttribute('aria-live'), 'off');
  }
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
  const actual = await page.locator(await page.locator('.walk-action-note').count() ? '.walk-action-note' : '.walk-find').textContent();
  assert(actual.includes(part), `${actual} does not include ${part}`);
  assert((await page.locator('.walk-navigation-announcement').textContent()).includes(part), 'timing advice missing from discrete announcement');
  await readable(page);
}
async function discoveryFeedback(page, milestone, expected, label) {
  const shown = await page.locator('.walking-game').evaluate(el => ({
    beat: Number(el.querySelector('header span').textContent.split('/')[0]),
    warning: el.querySelector('.walk-warning').textContent,
    discovery: el.querySelector('.walk-find').textContent,
    action: el.querySelector('.walk-action-note')?.textContent,
    actionFont: el.querySelector('.walk-action-note') && getComputedStyle(el.querySelector('.walk-action-note')).fontSize,
  }));
  assert(shown.beat >= milestone && shown.beat < milestone + 4, JSON.stringify(shown));
  assert.match(shown.discovery, /^发现了.+！已留在沿途发现。$/);
  assert(shown.action?.includes(expected), `discovery must not hide ${expected}: ${JSON.stringify(shown)}`);
  await readable(page);
  await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
  return shown;
}
async function paused(page) {
  await page.locator('.walk-pause').waitFor();
  assert.equal(await page.locator('.walk-navigation-announcement').textContent(), '', 'paused walk must clear timed instructions');
  assert.equal(await page.locator('.walk-action-note').count(), 0, 'paused game must not give timed action advice');
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
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], navigation = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.goto(base); await paused(page); assert.equal(await beat(page), 0);
      await watchNavigation(page);
      await key(page, 'c'); await hint(page, '近 3 步再按');
      const first = await required(page); await key(page, first); await hint(page, '动作会先结束');
      await page.screenshot({ path: join(dir, `${mode.name}-early.png`), fullPage: true });
      await atBeat(page, 4); assert((await beat(page)) < 6); await hint(page, '现在按');
      await key(page, 'c'); await paused(page); const firstPause = await beat(page);
      navigation.push(await navigationEvents(page));
      assert(navigation[0][0].text.startsWith('第 1 处 · '), 'first obstacle was not announced');
      assert(navigation[0].some(event => event.text.includes('近 3 步再按')));
      assert(navigation[0].some(event => event.text.includes('现在按')));
      await page.reload(); await paused(page); await watchNavigation(page);
      await wait(1200); assert.equal(await beat(page), firstPause);
      assert.deepEqual(await navigationEvents(page), [], 'refresh must not emit running cues before manual resume');
      await key(page, 'c'); await atBeat(page, 6);
      assert.equal((await api('state')).state.game.walking.cleared, 0, 'early action unexpectedly cleared first obstacle');
      await atBeat(page, 9); assert((await beat(page)) < 12);
      const second = await required(page); await key(page, second === 'a' ? 'b' : 'a'); await hint(page, '现在按');
      await wait(250); await key(page, second); await hint(page, '可覆盖本处');
      await page.screenshot({ path: join(dir, `${mode.name}-covered.png`), fullPage: true });
      await key(page, 'c'); await paused(page); const secondPause = await beat(page);
      assert(secondPause < 12); navigation.push(await navigationEvents(page));
      assert(navigation[1].some(event => event.text.startsWith('第 2 处 · ')), 'second obstacle was not announced');
      assert(navigation[1].some(event => event.text.includes('可覆盖本处')));
      await page.reload(); await paused(page); await watchNavigation(page); const count = writes.length;
      await wait(1200); assert.equal(writes.length, count); assert.equal(await beat(page), secondPause);
      await page.screenshot({ path: join(dir, `${mode.name}-paused.png`), fullPage: true });
      await key(page, 'c'); await hint(page, '可覆盖本处'); await atBeat(page, 12);
      assert.equal((await api('state')).state.game.walking.cleared, 1, 'timely action did not clear second obstacle');
      // Play the rest from the visible warning only. Never inspect hidden route or souvenirs to select an action.
      const acted = new Set([0, 1]), probed = new Set(), discoveries = [], deadline = Date.now() + 100000; let resumes = 0;
      while (await beat(page) < 72 && Date.now() < deadline) {
        if (await page.locator('.walk-pause').count()) {
          assert(++resumes <= 5, 'host repeatedly suspended'); await key(page, 'c');
        }
        const current = await beat(page), obstacle = Math.floor(current / 6);
        for (const milestone of [24, 48]) {
          if (current >= milestone && current < milestone + 3 && !probed.has(milestone)) {
            const right = await required(page);
            // Early correct input at the first find; wrong input at the second.
            // Both must retain the discovery AND say when to try the current obstacle.
            await key(page, milestone === 24 ? right : right === 'a' ? 'b' : 'a');
            discoveries.push(await discoveryFeedback(page, milestone,
              milestone === 24 ? '动作会先结束' : '近 3 步再按', `${mode.name}-find-${milestone}-early`));
            probed.add(milestone);
          }
        }
        if (current < 72 && 6 - current % 6 <= 3 && !acted.has(obstacle)) {
          await key(page, await required(page)); acted.add(obstacle);
          if (current === 27 || current === 51) discoveries.push(await discoveryFeedback(page, current - 3,
            '可覆盖本处', `${mode.name}-find-${current - 3}-covered`));
        }
        await wait(120);
      }
      assert.equal(await beat(page), 72); await readable(page);
      assert.equal(await page.locator('.walk-navigation-announcement').textContent(), '');
      navigation.push(await navigationEvents(page));
      assert(navigation[2].some(event => event.text.startsWith('第 12 处 · ')), 'last visible obstacle was not announced');
      assert.deepEqual([...probed], [24, 48]); assert.equal(discoveries.length, 4, 'both finds must show timely saved feedback');
      assert.equal(await page.locator('.walk-action-note').count(), 0);
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
      assert.equal(writes.filter(w => w.kind === 'walk-jump' || w.kind === 'walk-duck').length, 15);
      assert.equal(writes.filter(w => w.kind === 'walk-finish').length, 1);
      assert.deepEqual(errors, []); results.push({ mode: mode.name, first, second, firstPause, secondPause, resumes, discoveries, navigation, runningHeight: runningHeights.get(page), writes, cleared: 11, coins: settled.economy.coins });
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
