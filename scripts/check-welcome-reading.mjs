// First welcome in real Chrome with its own save/server; not a blind usability
// study, screen-reader certification, browser zoom or natural aging test.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-welcome-reading-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [], failures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
async function inspect(page, view) {
  return page.locator(`.content-${view}`).evaluate(el => {
    const area = el.getBoundingClientRect(), issues = [];
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || text.parentElement.closest('svg,.pixel-spark')) continue;
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
    const font = selector => {
      const node = el.querySelector(selector); return node ? parseFloat(getComputedStyle(node).fontSize) : null;
    };
    return { rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      captionFont: font('.screen-caption'), nameFont: font('.choose-name'), counterFont: font('.choose-name > span'),
      welcomeFont: font('.hatch-view strong'), instructionFont: font('.hatch-view small'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped: [...new Set(issues)] };
  });
}
async function record(page, mode, view) {
  const layout = await inspect(page, view); results.push({ mode: mode.name, view, ...layout });
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  await page.screenshot({ path: join(artifacts, `${mode.name}-${view}.png`), fullPage: true });
  if (layout.captionFont < layout.rootFont * .85) failures.push(`${mode.name}/${view}: caption does not scale (${layout.captionFont}px)`);
  if (view === 'choose' && layout.nameFont < layout.rootFont * 1.07) failures.push(`${mode.name}: partner name does not scale (${layout.nameFont}px)`);
  if (view === 'hatch' && Math.min(layout.welcomeFont, layout.instructionFont) < layout.rootFont * .85) failures.push(`${mode.name}: hatch text does not scale`);
  if (layout.overflow || layout.clipped.length) failures.push(`${mode.name}/${view}: ${JSON.stringify(layout)}`);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; if (server.exitCode !== null) throw Error(log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [
    { name: 'desktop', width: 1200, height: 900, font: 14 },
    { name: 'desktop-large', width: 1200, height: 900, font: 28 },
    { name: 'phone', width: 320, height: 480, font: 14 },
    { name: 'phone-large-contrast', width: 320, height: 480, font: 28, contrast: true },
  ]) {
    await api('reset', { confirm: true });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      forcedColors: mode.contrast ? 'active' : 'none', reducedMotion: 'reduce' });
    try {
      const page = await context.newPage(), actionWrites = [], errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/action') actionWrites.push(request.postDataJSON()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      await page.goto(base); await page.locator('.content-choose').waitFor();
      const fresh = (await api('state')).state;
      assert.equal(fresh.hatchedAt, 0); assert.equal(fresh.growth.stage, 'egg');
      // Selection and a rejected welcome are local: neither should hatch a pet.
      await key(page, 'a'); await key(page, 'a');
      assert.match(await page.locator('.choose-name').textContent(), /草莓兔.*03\s*\/\s*10/);
      const selected = (await page.locator('.choose-name').textContent()).replace(/\d+\s*\/\s*10/, '').trim();
      await record(page, mode, 'choose');
      await key(page, 'b'); await page.locator('.content-hatch').waitFor();
      assert((await page.locator('.hatch-view strong').textContent()).includes(selected));
      await record(page, mode, 'hatch');
      await key(page, 'a'); assert.equal(actionWrites.length, 0);
      await key(page, 'c'); await page.locator('.content-choose').waitFor();
      assert((await page.locator('.choose-name').textContent()).includes(selected));
      assert.equal(actionWrites.length, 0); assert.equal((await api('state')).state.hatchedAt, 0);
      await page.reload(); await page.locator('.content-choose').waitFor();
      assert.equal(actionWrites.length, 0); assert.equal((await api('state')).state.hatchedAt, 0);
      await key(page, 'a'); await key(page, 'a'); await key(page, 'b');
      // Explicit native keyboard confirmation; exactly one genuine hatch write.
      await page.locator('.button-b').focus(); await page.keyboard.press('Enter');
      await page.locator('.content-home').waitFor();
      assert.deepEqual(actionWrites.map(({ requestId, ...body }) => body), [{ kind: 'hatch', species: 2 }]);
      const hatched = (await api('state')).state;
      assert.equal(hatched.species, 2); assert(hatched.hatchedAt > 0); assert.equal(hatched.growth.stage, 'baby');
      await page.reload(); await page.locator('.content-home').waitFor();
      assert.equal(actionWrites.length, 1); assert.equal((await api('state')).state.hatchedAt, hatched.hatchedAt);
      // First care remains usable after welcome; check state, not just animation.
      await key(page, 'a'); await page.locator('.content-menu').waitFor(); await key(page, 'b');
      await page.locator('.pet-scene[data-motion="idle"]').waitFor();
      const cared = (await api('state')).state;
      assert(cared.needs.hunger > hatched.needs.hunger); assert.equal(cared.careCount, hatched.careCount + 1);
      assert.deepEqual(actionWrites.map(({ requestId, ...body }) => body), [{ kind: 'hatch', species: 2 }, { kind: 'feed' }]);
      assert(actionWrites.every(write => typeof write.requestId === 'string' && write.requestId.length > 0));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  for (const [normal, large] of [['desktop', 'desktop-large'], ['phone', 'phone-large-contrast']]) {
    for (const view of ['choose', 'hatch']) {
      const before = results.find(result => result.mode === normal && result.view === view);
      const after = results.find(result => result.mode === large && result.view === view);
      for (const field of ['captionFont', ...(view === 'choose' ? ['nameFont', 'counterFont'] : ['welcomeFont', 'instructionFont'])]) {
        if (Math.abs(after[field] - before[field] * 2) > .02) failures.push(`${normal}/${view}: ${field} did not double`);
      }
    }
  }
  assert.deepEqual(failures, [], 'welcome text must scale and stay inside the LCD');
  console.log(`Welcome reading and first-care flow: 4 modes passed. ${artifacts}`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await writeFile(join(artifacts, 'server.log'), log);
}
