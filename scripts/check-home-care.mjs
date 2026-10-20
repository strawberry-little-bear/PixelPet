// A real care chain using its own SQLite/save and explicit isolated builds.
// Constructed needs and root-font scaling are not natural aging or human QA.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-home-care-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function key(page, name) {
  await page.locator(`.button-${name}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function menu(page, index, label) {
  await key(page, 'b');
  assert.match(await page.locator('.care-menu-advice').textContent(), new RegExp(label));
  assert.equal(await page.locator('[data-care-preview]').getAttribute('data-care-preview'), 'feed');
  for (let i = 0; i < index; i++) await key(page, 'a');
  await key(page, 'b');
}
async function record(page, mode, step, kind, label) {
  assert.equal(await page.locator('.pet-scene').getAttribute('data-need'), kind);
  const advice = page.getByRole('region', { name: '小窝中的照顾建议' });
  assert.equal(await advice.count(), 1, `${step}: body need must name the menu action on home`);
  assert((await advice.textContent()).includes(`从菜单选「${label}」`));
  const layout = await page.locator('.content-home').evaluate(el => {
    const area = el.getBoundingClientRect(), footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), issues = [];
    for (const region of el.querySelectorAll('.home-care-guidance,.care-outcome')) {
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT); let text;
      while ((text = walker.nextNode())) {
        if (!text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const box of range.getClientRects()) {
          if (!box.width || !box.height) continue;
          if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) issues.push(text.textContent);
          for (let parent = text.parentElement; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
            if (/hidden|clip/.test(css.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1)) issues.push('clipped: ' + text.textContent);
          }
        }
      }
    }
    const advice = el.querySelector('.home-care-guidance .care-advice');
    return { rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      adviceFont: parseFloat(getComputedStyle(advice).fontSize),
      clipped: [...new Set(issues)], overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(layout.clipped, [], `${mode.name}/${step}: advice and full receipt must not clip`);
  assert(!layout.overflow); assert(layout.adviceFont >= layout.rootFont * .85);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  await advice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, `${mode.name}-${step}.png`), fullPage: true });
  await page.screenshot({ path: join(artifacts, `${mode.name}-${step}-viewport.png`) });
  results.push({ mode: mode.name, step, kind, advice: await advice.textContent(), layout });
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
}
async function seed(needs) {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '照顾链路', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs, careCount: 0, logs: [] });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [
    { name: 'desktop', width: 1200, height: 900, font: 14 },
    { name: 'phone-large-contrast', width: 320, height: 480, font: 28, contrast: true },
  ]) {
    await seed({ hunger: 12, mood: 50, clean: 18, energy: 20 });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      reducedMotion: 'reduce', forcedColors: mode.contrast ? 'active' : 'none' });
    try {
      const page = await context.newPage(), writes = [], errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/action') writes.push(request.postDataJSON().kind);
      });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      await page.goto(base); await page.locator('.content-home').waitFor();
      await record(page, mode, 'hungry', 'hungry', '吃点东西'); assert.deepEqual(writes, []);
      const before = (await api('state')).state;
      await menu(page, 0, '吃点东西'); await page.locator('.pet-scene[data-motion=idle]').waitFor();
      const fed = (await api('state')).state;
      assert(fed.needs.hunger > before.needs.hunger + 19); assert(fed.needs.clean < before.needs.clean - 2);
      assert.equal(fed.careCount, before.careCount + 1);
      await record(page, mode, 'after-feed', 'dirty', '洗个澡澡');
      assert.equal(await page.locator('[data-feedback=credited]').count(), 1);
      const receipt = await page.getByRole('region', { name: '上次操作的即时变化' }).textContent();
      assert.match(receipt, /本次成长：\+0\.25 点/); assert.match(receipt, /喂食习惯：\+1/);
      assert.match(receipt, /\d+\.\d{2} → \d+\.\d{2}/);
      await wait(8500); assert.equal(await page.locator('[data-feedback=idle]').count(), 1);
      assert.equal(await page.getByRole('region', { name: '上次操作的即时变化' }).textContent(), receipt);
      await record(page, mode, 'after-feedback', 'dirty', '洗个澡澡');
      await menu(page, 2, '洗个澡澡'); await page.locator('.pet-scene[data-motion=idle]').waitFor();
      const cleaned = (await api('state')).state;
      assert(cleaned.needs.clean > fed.needs.clean + 34); assert.equal(cleaned.careCount, fed.careCount + 1);
      await record(page, mode, 'after-clean', 'tired', '睡个好觉');
      await menu(page, 3, '睡个好觉'); await page.locator('.pet-scene[data-motion=sleeping]').waitFor();
      assert.equal(await page.locator('.home-care-guidance').count(), 0);
      assert.equal(await page.getByLabel('照顾建议', { exact: true }).count(), 1);
      assert.match(await page.locator('.sleep-home-guidance').textContent(), /正在休息/);
      assert((await api('state')).state.sleeping);
      await wait(1200); await key(page, 'b'); for (let i = 0; i < 3; i++) await key(page, 'a');
      assert.match(await page.locator('.care-item.selected').textContent(), /起床啦/); await key(page, 'b');
      await page.locator('.pet-scene[data-motion=idle]').waitFor(); assert(!(await api('state')).state.sleeping);
      await record(page, mode, 'awake', 'tired', '睡个好觉');
      await page.reload(); await page.locator('.content-home').waitFor();
      await record(page, mode, 'refreshed', 'tired', '睡个好觉');
      assert.equal(await page.locator('.care-outcome').count(), 0, 'refresh must not reconstruct an old receipt');
      assert.deepEqual(writes, ['feed', 'clean', 'sleep', 'sleep']);
      await seed({ hunger: 80, mood: 80, clean: 80, energy: 80 }); await page.reload();
      await page.locator('.content-home').waitFor(); assert.equal(await page.locator('.home-care-guidance').count(), 0);
      assert.deepEqual(writes, ['feed', 'clean', 'sleep', 'sleep']); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  const first = results.find(result => result.mode === 'desktop'), large = results.find(result => result.mode === 'phone-large-contrast');
  assert(Math.abs(large.layout.adviceFont - first.layout.adviceFont * 2) < .02);
  console.log(`Home needs → menu → confirmed care: 2 modes passed. ${artifacts}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(join(artifacts, 'server.log'), log);
}
