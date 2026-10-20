// Actual HTTP greeting, refresh and read-only arcade browsing. Never uses the player server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set an absolute isolated PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set an absolute isolated PIXELPET_TEST_WEB');
// A clean checkout need not have shared build outputs at all.
async function sharedPath(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code === 'ENOENT') return resolve(path); throw error; }
}
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')));
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-daily-refresh-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed(stage) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const response = await api('import', { schema: 1, revision: 1, species: 2, name: '更新时间伙伴',
    createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  assert.equal(response.state.growth.stage, stage);
}
async function key(page, k) {
  await page.locator(`.button-${k}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function shop(page) {
  await page.locator('.home-caption').waitFor();
  await key(page, 'a'); for (let i = 0; i < 9; i++) await key(page, 'a'); await key(page, 'b');
  await page.locator('.shop-panel').waitFor();
}
async function refreshLabel(page, zone, kind) {
  const response = await api('state'), e = response.state.economy;
  const expected = (Math.floor(Math.max(response.serverTime, kind === 'shop' ? e.lastDailyAt : e.lastGameAt) / 86400000) + 1) * 86400000;
  const label = page.getByLabel('额度更新时间'), time = label.locator('time');
  assert.equal(await time.getAttribute('datetime'), new Date(expected).toISOString());
  assert.equal(await time.innerText(), new Intl.DateTimeFormat('zh-CN', { timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(expected));
  assert((await label.innerText()).includes('本地；UTC 0 点'));
  await readable(page, kind === 'shop' ? '.shop-panel' : '.arcade-panel');
  if (kind === 'shop') {
    const preview = await page.locator('.shop-preview small').boundingBox();
    const categories = await page.locator('.shop-sections').boundingBox();
    assert(preview && categories && preview.y + preview.height <= categories.y + 1,
      `preview overlaps categories: ${JSON.stringify({ preview, categories })}`);
  }
  await label.scrollIntoViewIfNeeded();
  const box = await label.boundingBox(); assert(box && box.y >= -1 && box.y + box.height <= await page.evaluate(() => innerHeight) + 1);
  return e;
}
async function readable(page, selector) {
  const result = await page.locator(selector).evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), failures = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) failures.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if ((/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) ||
            (/hidden|clip|auto|scroll/.test(css.overflowX) && (box.left < rect.left - 1 || box.right > rect.right + 1))) failures.push('clipped: ' + text.textContent);
        }
      }
    }
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minText = Math.min(...[el, ...el.querySelectorAll('p,small,dt,dd,strong')].map(e => parseFloat(getComputedStyle(e).fontSize)));
    return { failures, overflow: document.documentElement.scrollWidth > innerWidth + 1, rootSize, minText };
  });
  assert.deepEqual(result.failures, [], selector); assert.equal(result.overflow, false);
  assert(result.minText >= result.rootSize * .85, JSON.stringify(result));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const zones = ['Asia/Shanghai', 'America/Los_Angeles', 'Asia/Kathmandu', 'Pacific/Chatham', 'Australia/Adelaide', 'UTC'];
  const modes = [
    { label: 'desktop', width: 1200, height: 800, font: 14 },
    { label: 'phone-large', width: 320, height: 700, font: 28 },
    { label: 'short-contrast', width: 320, height: 380, font: 28, forcedColors: 'active' },
  ];
  for (const stage of ['baby', 'growing', 'adult']) for (const zone of zones) for (const mode of modes) {
    await seed(stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      timezoneId: zone, hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.forcedColors });
    await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = `${font}px`;
    }), mode.font);
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => { if (request.url().endsWith('/api/action')) writes.push(JSON.parse(request.postData())); });
    await page.goto(base); await shop(page);
    assert.equal((await refreshLabel(page, zone, 'shop')).coins, 0); assert.equal(writes.length, 0);
    await key(page, 'b');
    await page.waitForFunction(() => document.querySelector('.shop-decision')?.textContent.includes('今日已领取'));
    const claimed = await refreshLabel(page, zone, 'shop');
    assert.equal(claimed.coins, 10); assert(claimed.lastDailyAt > 0);
    assert.equal(writes.length, 1); assert.equal(writes[0].kind, 'daily');
    assert(!(await page.locator('.shop-decision').innerText()).includes('明天'));
    if (zone === zones[0]) await page.screenshot({ path: join(dir, `greeting-${stage}-${mode.label}.png`), fullPage: true });
    await page.reload(); await shop(page);
    const reloaded = await refreshLabel(page, zone, 'shop');
    assert.equal(reloaded.coins, 10); assert.equal(reloaded.lastDailyAt, claimed.lastDailyAt); assert.equal(writes.length, 1);
    await key(page, 'c'); for (const k of ['a', 'a', 'b']) await key(page, k);
    await page.locator('.arcade-panel').waitFor();
    const browsed = await refreshLabel(page, zone, 'arcade');
    assert.equal(browsed.coins, 10); assert.equal(browsed.gameCoins, 0); assert.equal(writes.length, 1);
    if (zone === zones[0]) await page.screenshot({ path: join(dir, `arcade-${stage}-${mode.label}.png`), fullPage: true });
    assert.deepEqual(errors, []); results.push({ stage, zone, mode: mode.label, claimedOnce: true, noReplay: true });
    console.log('PASS', stage, zone, mode.label); await context.close();
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`PASS ${results.length} real HTTP/browser cases; artifacts: ${dir}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(join(dir, 'server.log'), log);
}
