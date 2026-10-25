// Read-only diagnostics; own temporary service, builds and database only.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-runtime-info-browser-')), results = [];
const port = await new Promise((resolve, reject) => {
 const socket = net.createServer(); socket.once('error', reject);
 socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
 const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
 }); assert(r.ok, `${path}: ${await r.clone().text()}`); return r.json();
}
async function fixture() {
 const now = Date.now();
 await api('import', { schema: 1, revision: 1, species: 2, name: '运行信息伙伴', createdAt: now - 3600000,
  hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
  needs: { hunger: 40, mood: 70, clean: 65, energy: 80 } });
}
async function open(page) {
 await page.getByRole('button', { name: '存档盒', exact: true }).click();
 await page.getByRole('button', { name: '运行信息 · 查看', exact: true }).click();
}
async function layout(page) {
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page horizontal overflow');
 assert.equal(await page.locator('.physical-button').count(), 3);
 assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
 const menu = page.locator('.tools-menu');
 assert(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'toolbox horizontal clipping');
 for (const node of await page.locator('.runtime-info-content dd,.runtime-info-content p,.runtime-info-content button,.tools-menu .reset-link').all()) {
  await node.scrollIntoViewIfNeeded();
  assert(await node.evaluate(el => {
   const box = el.getBoundingClientRect(), menu = el.closest('.tools-menu').getBoundingClientRect();
   const visibleTop = Math.max(0, menu.top), visibleBottom = Math.min(innerHeight, menu.bottom);
   if (box.bottom <= visibleTop || box.top >= visibleBottom) return false;
   const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
   while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) if (rect.width && (rect.left < Math.max(0, menu.left) - 1 || rect.right > Math.min(innerWidth, menu.right) + 1)) return false;
   }
   return true;
  }), 'tool text unreachable or horizontally clipped');
 }
}
async function context(size = { width: 1200, height: 820, font: 14 }) {
 const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: size.width < 700,
  reducedMotion: 'reduce', forcedColors: size.forced ? 'active' : 'none' });
 await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), size.font);
 const page = await ctx.newPage(), errors = [], actions = [], metadata = [];
 page.on('pageerror', e => errors.push(e.message));
 page.on('request', r => {
  const path = new URL(r.url()).pathname;
  if (path === '/api/action') actions.push(r.postDataJSON());
  if (path === '/api/runtime') metadata.push(r.method());
 });
 return { ctx, page, errors, actions, metadata };
}
try {
 server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_WEB: web,
  PIXELPET_DB: join(dir, 'test.db'), PIXELPET_ADDR: `127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
 server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
 let ready = false;
 for (let i = 0; i < 100; i++) {
  if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
  try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
  await wait(100);
 }
 assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
 const actual = await api('runtime'); assert(Number.isSafeInteger(actual.schema));
 for (const size of [{ width: 1200, height: 820, font: 14 }, { width: 320, height: 700, font: 14 }, { width: 320, height: 380, font: 28, forced: true }]) {
  await fixture(); const { ctx, page, errors, actions, metadata } = await context(size);
  try {
   await page.goto(base); await page.locator('.home-caption').waitFor(); assert.equal(metadata.length, 0);
   await open(page); await page.getByText(`schema ${actual.schema}`, { exact: true }).waitFor();
   const region = page.getByRole('region', { name: '运行信息' });
   assert.match(await region.innerText(), /最近同步正常/);
   assert.equal(await region.locator('time').count(), 1);
   const backend = region.locator('dd').filter({ has: page.locator('code') });
   assert(await backend.count() >= 3);
   if (actual.build.revision) assert(await region.locator(`code[title="${actual.build.revision}"]`).count() >= 1);
   assert.match(await region.innerText(), /网页构建/); assert.match(await region.innerText(), /API 入口/);
   assert.deepEqual(metadata, ['GET']); await layout(page);
   await page.locator('.runtime-info-content').evaluate(el => el.closest('.tools-menu').scrollTop = 0);
   await page.screenshot({ path: join(dir, `${size.width}-${size.height}-${size.font}.png`), fullPage: true });
   // External Enter/Space remain native and cannot also operate gameplay B/A.
   const toggle = page.getByRole('button', { name: '运行信息 · 收起', exact: true });
   await toggle.focus(); await page.keyboard.press('Enter');
   await page.getByRole('button', { name: '运行信息 · 查看', exact: true }).waitFor();
   await page.keyboard.press('Space'); await page.getByText(`schema ${actual.schema}`, { exact: true }).waitFor();
   assert.deepEqual(metadata, ['GET', 'GET']); assert.deepEqual(actions, []);
   await page.keyboard.press('c'); assert.equal(await page.locator('.tools-menu').count(), 0);
   await page.keyboard.press('a'); await page.locator('.content-menu').waitFor();
   assert.deepEqual(actions, []); assert.deepEqual(errors, []);
   results.push({ type: 'native-focus-layout-read-only', ...size });
  } finally { await ctx.close(); }
 }
 // A successful runtime GET must not masquerade as a successful save read.
 await fixture(); {
  const { ctx, page, errors, actions } = await context();
  try {
   await page.route(/\/api\/(state|visit)$/, r => r.abort('failed'));
   await page.goto(base); await page.locator('.save-recovery').waitFor(); await open(page);
   await page.getByText(`schema ${actual.schema}`, { exact: true }).waitFor();
   const region = page.getByRole('region', { name: '运行信息' });
   assert.match(await region.innerText(), /暂时连接不上/); assert.match(await region.innerText(), /本页还没有成功同步/);
   await page.unroute(/\/api\/(state|visit)$/); await page.keyboard.press('c'); await page.keyboard.press('b');
   await page.locator('.home-caption').waitFor(); await open(page);
   await page.getByText('最近同步正常', { exact: true }).waitFor(); assert.deepEqual(actions, []); assert.deepEqual(errors, []);
   results.push({ type: 'save-offline-is-independent-from-runtime' });
  } finally { await ctx.close(); }
 }
 // Real committed action with lost reply; diagnostics do not retry the write.
 await fixture(); {
  const { ctx, page, errors, actions } = await context();
  try {
   await page.goto(base); await page.locator('.home-caption').waitFor();
   await page.route('**/api/action', async route => { const reply = await route.fetch(); assert(reply.ok()); await route.abort('failed'); });
   await page.keyboard.press('a'); await page.locator('.content-menu').waitFor(); await page.keyboard.press('b');
   await page.locator('.save-recovery h2').filter({ hasText: '先核对，再继续' }).waitFor(); await open(page);
   await page.getByText(`schema ${actual.schema}`, { exact: true }).waitFor();
   assert.match(await page.getByRole('region', { name: '运行信息' }).innerText(), /保存结果待核对/);
   assert.equal(await page.locator('.runtime-info time').count(), 1); assert.equal(actions.length, 1);
   const committed = await api('state'); assert.equal(committed.state.careCount, 1);
   await page.keyboard.press('c'); await page.keyboard.press('b'); await page.locator('.home-caption').waitFor();
   assert.equal(actions.length, 1); assert.equal((await api('state')).state.careCount, 1); assert.deepEqual(errors, []);
   results.push({ type: 'lost-committed-reply-reconciles-without-resend' });
  } finally { await ctx.close(); }
 }
 await fixture(); {
  const { ctx, page, errors, actions } = await context(); let mode = 'old', release, started;
  try {
   await page.route('**/api/runtime', async route => {
    if (mode === 'old') return route.fulfill({ status: 404, body: 'old backend' });
    if (mode === 'invalid') return route.fulfill({ json: { schema: 'bad', build: {} } });
    started(); await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { schema: 999, build: {} } }).catch(() => {});
   });
   await page.goto(base); await page.locator('.home-caption').waitFor(); await open(page);
   await page.getByText(/这版服务未提供运行版本信息/).waitFor(); await page.getByText('最近同步正常', { exact: true }).waitFor();
   mode = 'invalid'; await page.getByRole('button', { name: '重新读取运行版本' }).click(); await page.getByText(/无法识别运行信息/).waitFor();
   mode = 'late'; const pending = new Promise(resolve => { started = resolve; });
   await page.getByRole('button', { name: '重新读取运行版本' }).click(); await pending;
   await page.keyboard.press('c'); release(); await wait(150); assert.equal(await page.locator('.tools-menu').count(), 0);
   mode = 'old'; await open(page); await page.getByText(/这版服务未提供运行版本信息/).waitFor();
   assert.equal(await page.getByText('schema 999', { exact: true }).count(), 0);
   assert.deepEqual(actions, []); assert.deepEqual(errors, []);
   results.push({ type: 'legacy-invalid-and-late-metadata' });
  } finally { release?.(); await ctx.close(); }
 }
 await fixture(); await api('action', { kind: 'play-walk' }); {
  const { ctx, page, errors, actions } = await context();
  try {
   await page.goto(base); await page.locator('.walk-pause').waitFor(); await page.keyboard.press('c');
   await page.locator('.walk-pause').waitFor({ state: 'hidden' }); await open(page);
   await page.getByText(`schema ${actual.schema}`, { exact: true }).waitFor();
   await page.keyboard.press('c'); await page.locator('.walk-pause').waitFor();
   const before = (await api('state')).state.game, count = actions.length;
   await wait(1200); const after = (await api('state')).state.game;
   assert.equal(after.walking.beat, before.walking.beat); assert.equal(after.walking.step, before.walking.step);
   assert.equal(actions.length, count, 'toolbox closure must not send resume or steps');
   assert.deepEqual(errors, []); results.push({ type: 'toolbox-locally-pauses-and-does-not-auto-resume-walk' });
  } finally { await ctx.close(); }
 }
 await writeFile(join(dir, 'report.json'), JSON.stringify({ results, actual }, null, 2)); console.log(JSON.stringify({ dir, passed: results.length, results }, null, 2));
} finally {
 await browser?.close();
 if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
 await writeFile(join(dir, 'server.log'), log);
}
