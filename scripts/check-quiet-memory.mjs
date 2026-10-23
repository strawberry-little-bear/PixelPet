// Real HTTP/Chrome memory chat. Fixture ages are controlled, actions use a temporary save.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-quiet-memory-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function appearance(page, selector) {
  return page.locator(selector).evaluate(panel => {
    const rig = panel.querySelector('.growth-size'), box = rig.getBoundingClientRect();
    const outfit = panel.querySelector('.growth-outfit'), outfitBox = outfit?.getBoundingClientRect();
    return {
      rig: rig.className,
      outfit: outfit?.outerHTML ?? null,
      emblem: panel.querySelector('.growth-form-emblem')?.outerHTML ?? null,
      accessory: panel.querySelector('.equipped-accessory')?.outerHTML ?? null,
      geometry: outfitBox ? [box.width, box.height, outfitBox.x - box.x, outfitBox.y - box.y, outfitBox.width, outfitBox.height] : [box.width, box.height],
    };
  });
}
async function sameAppearance(page, expected, saved) {
  assert.deepEqual(await appearance(page, '.quiet-moment-pet'), expected, 'Quiet company must preserve the home rig, outfit placement, form and accessory');
  const stageNames = { baby: '幼年期', growing: '成长期', adult: '成年期' };
  const formNames = { balanced: '均衡型', lively: '活力型', gentle: '恬静型', easygoing: '自在型' };
  assert.equal(await page.locator('.quiet-growth-label').innerText(), stageNames[saved.growth.stage] + (saved.growth.stage === 'adult' ? ` · ${formNames[saved.growth.form]}` : ''));
}
async function responseVisible(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await page.locator('.quiet-moment-copy').boundingBox(), height = page.viewportSize().height;
  assert(box && box.y >= -1 && (box.height > height - 24 ? box.y <= 13 : box.y + box.height <= height + 1),
    `Current choice and response must be in view: ${JSON.stringify(box)}, viewport=${height}`);
}
async function physical(page, key) {
  const button = page.locator(`.button-${key}`);
  const previous = key === 'a' ? await page.locator('.quiet-moment-copy > strong').innerText() : null;
  await button.tap();
  await responseVisible(page);
  if (key === 'a') {
    const titles = await page.locator('.quiet-moment').getAttribute('data-sleeping') === 'true'
      ? ['轻轻摸摸', '守着它睡', '轻声道晚安'] : ['摸摸它', '陪它发呆', '说声你好'];
    assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), titles[(titles.indexOf(previous) + 1) % 3], 'Each tap must change the choice once');
  }
  assert(await button.evaluate(el => document.activeElement === el), 'Reading navigation must preserve physical button focus');
}
async function open(page) {
  await page.keyboard.press('a');
  for (let i = 0; i < 12; i++) await page.keyboard.press('a');
  await physical(page, 'b'); await page.locator('.quiet-moment').waitFor();
  await physical(page, 'a'); await physical(page, 'a');
}
async function readable(page) {
  const problems = await page.locator('.quiet-moment').evaluate(panel => {
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), problems = [];
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (box.left < -1 || box.right > innerWidth + 1) problems.push('horizontal: ' + text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1))
            problems.push('clipped: ' + text.textContent);
        }
      }
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'Chat text must remain readable');
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
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
  // Controlled save fixtures verify rendering; these are not natural growth journeys.
  for (const fixture of [
    { stage: 'baby', species: 2, age: 1 },
    { stage: 'growing', species: 3, age: 30 },
    { stage: 'adult', species: 9, age: 80 },
    { stage: 'adult', species: 7, age: 80, form: 'gentle', accessory: 'leaf-pin' },
  ]) for (const mode of [
    { width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 14 }, { width: 320, height: 380, font: 28 },
  ]) {
    const { stage } = fixture, at = Date.now(), age = fixture.age * 3600000;
    const seeded = await api('import', { schema: 1, revision: 1, species: fixture.species, name: '回忆伙伴',
      createdAt: at - age, hatchedAt: at - age, lastTick: at, sleeping: false,
      needs: { hunger: 50, mood: 70, clean: 50, energy: 80 }, careCount: 0, logs: [] });
    if (fixture.form) {
      seeded.state.growth.form = fixture.form;
      seeded.state.album.entries.find(memory => memory.kind === 'adult').form = fixture.form;
      seeded.state.economy.owned.push(fixture.accessory);
      seeded.state.economy.equipped.accessory = fixture.accessory;
      await api('import', seeded.state);
    }
    await api('action', { kind: 'feed' }); await api('action', { kind: 'clean' });
    const before = (await api('state')).state;
    assert.equal(before.growth.stage, stage);
    assert.deepEqual(before.album.entries.filter(m => m.source === 'shared').map(m => m.kind).sort(), ['bath', 'meal']);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width < 700, reducedMotion: mode.font === 28 ? 'reduce' : 'no-preference', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [], label = `${stage}${fixture.accessory ? '-equipped' : ''}-${mode.width}-${mode.height}`;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(req.url()); });
    await page.addInitScript(font => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; });
      const original = window.scrollBy.bind(window);
      window.__quietScrollCalls = 0;
      window.scrollBy = (...args) => { window.__quietScrollCalls++; return original(...args); };
    }, mode.font);
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const homeAppearance = await appearance(page, '.pet-scene');
      await open(page);
      await sameAppearance(page, homeAppearance, before);
      await page.locator('.quiet-moment-pet').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `${label}-appearance.png`) });
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await physical(page, 'b'); const first = await page.locator('.quiet-memory-source').innerText();
      await physical(page, 'b'); const second = await page.locator('.quiet-memory-source').innerText();
      assert.notEqual(first, second);
      assert([first, second].some(t => t.includes('泡泡里的小陪伴')));
      assert([first, second].some(t => t.includes('一份暖暖的小饭团')));
      await physical(page, 'b'); assert.equal(await page.locator('.quiet-memory-source').innerText(), first);
      await readable(page);
      await page.screenshot({ path: join(dir, `${label}-reply-viewport.png`) });
      await physical(page, 'b');
      const panel = page.getByRole('region', { name: '无目的互动阅读区' });
      for (let i = 0; i < 12 && !await panel.evaluate(el => document.activeElement === el); i++) await page.keyboard.press('Shift+Tab');
      assert(await panel.evaluate(el => document.activeElement === el), 'Native Tab must reach the reading region');
      const current = await page.locator('.quiet-memory-source').innerText();
      await page.keyboard.press('Enter'); assert.equal(await page.locator('.quiet-memory-source').innerText(), current);
      await page.keyboard.press('b'); assert.notEqual(await page.locator('.quiet-memory-source').innerText(), current);
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded(); await readable(page);
      const box = await page.locator('.quiet-moment-note').boundingBox();
      assert(box && box.y >= -1 && box.y + box.height <= mode.height + 1, 'Final note must be reachable');
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      await physical(page, 'a'); assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await page.keyboard.press('c'); await page.locator('.home-caption').waitFor();
      await open(page); assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await page.reload(); await page.locator('.home-caption').waitFor();
      await open(page); await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').innerText(), first, 'Reload starts a new conversation');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      for (const field of ['album', 'careCount', 'economy']) assert.deepEqual(after[field], before[field], `${field} changed during read-only chat`);
      // Ordinary reads and sleep/wake must not replay a prior explicit reading jump.
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const scrollCalls = await page.evaluate(() => window.__quietScrollCalls);
      const polled = page.waitForResponse(response => /\/api\/(state|visit)$/.test(response.url()));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await polled; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), scrollCalls, 'Ordinary read must not reposition the response');
      // Sleep/wake happens through a separate client; this page stays read-only.
      await api('action', { kind: 'sleep' });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'true');
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), scrollCalls, 'Sleep sync must not reposition the response');
      const sleepingBefore = (await api('state')).state;
      await sameAppearance(page, homeAppearance, before);
      if (stage === 'adult') assert.equal(await page.locator('.quiet-moment .growth-form-emblem').evaluate(el => getComputedStyle(el).opacity), '0.4');
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
      assert((await page.locator('.lcd-bottom').innerText()).includes('B 安静陪着'));
      // Selection is still the third option; wrap through all bedside interactions.
      for (const title of ['轻声道晚安', '轻轻摸摸', '守着它睡']) {
        assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), title);
        await physical(page, 'b');
        assert.equal(await page.locator('.quiet-memory-source').count(), 0);
        assert.equal(await page.locator('.quiet-moment .expression-asleep.rig-motion-sleeping').count(), 1);
        assert.equal(await page.locator('.quiet-moment-pet').evaluate(el => getComputedStyle(el).animationName), 'none');
        assert.equal(await page.locator('.quiet-moment .sprite-eyes-open').evaluate(el => getComputedStyle(el).opacity), '0');
        assert.equal(await page.locator('.quiet-moment .sprite-eyes-closed').evaluate(el => getComputedStyle(el).opacity), '1');
        await readable(page);
        if (title === '轻声道晚安') await page.screenshot({ path: join(dir, `${label}-sleep-reply-viewport.png`) });
        await physical(page, 'a');
      }
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const sleepBox = await page.locator('.quiet-moment-note').boundingBox();
      assert(sleepBox && sleepBox.y >= -1 && sleepBox.y + sleepBox.height <= mode.height + 1, 'Bedside note must be reachable');
      await page.screenshot({ path: join(dir, `${label}-sleeping.png`), fullPage: true });
      const sleepingAfter = (await api('state')).state;
      assert.equal(sleepingAfter.sleeping, true, 'Quiet company must not wake the pet');
      for (const field of ['album', 'careCount', 'economy']) assert.deepEqual(sleepingAfter[field], sleepingBefore[field]);
      await page.reload(); await page.locator('.home-caption').waitFor(); await open(page);
      assert.equal(await page.locator('.quiet-moment-copy > strong').innerText(), '轻声道晚安');
      await sameAppearance(page, homeAppearance, before);
      await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      await page.locator('.quiet-moment-note').scrollIntoViewIfNeeded();
      const wakeScrollCalls = await page.evaluate(() => window.__quietScrollCalls);
      await api('action', { kind: 'sleep' });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('.quiet-moment')?.dataset.sleeping === 'false');
      assert.equal(await page.evaluate(() => window.__quietScrollCalls), wakeScrollCalls, 'Wake sync must not reposition the response');
      assert.equal(await page.locator('.quiet-moment').getAttribute('data-replied'), 'false');
      await sameAppearance(page, homeAppearance, before);
      assert.equal(await page.locator('.quiet-memory-source').count(), 0);
      assert((await page.locator('.lcd-bottom').innerText()).includes('B 聊聊回忆'));
      await page.keyboard.press('b');
      assert.equal(await page.locator('.quiet-memory-source').innerText(), '从纪念册想起：轻轻说一声晚安', 'Waking starts with the latest real memory, including the separate client’s bedtime');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ label, first, second, sleeping: true, writes, errors }); console.log('PASS', label);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log);
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ dir, groups: results.length, serviceExited: server?.exitCode !== null || server?.signalCode !== null }));
}
