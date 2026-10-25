// Focused real-HTTP acceptance: legacy fixture -> actual care -> interval hint
// -> refresh -> actual repeat care. No player services or shared build output.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-habit-interval-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(error => error ? reject(error) : resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
let server, browser, log = '', startupError;
async function key(page, key) {
  await page.locator(`.button-${key}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function menu(page, kind) {
  await key(page, 'a');
  if (kind === 'clean') { await key(page, 'a'); await key(page, 'a'); }
  await page.locator(`[data-care-preview="${kind}"]`).waitFor();
}
async function care(page, kind) {
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/action' && res.request().method() === 'POST');
  await key(page, 'b');
  const res = await response, reply = await res.json();
  assert(res.ok(), JSON.stringify(reply)); assert.equal(reply.careFeedback.kind, kind);
  await page.locator('.home-caption').waitFor();
  return reply;
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const clipped = await page.locator('.care-preview').evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) errors.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('clipped: ' + text.textContent);
        }
      }
    }
    return errors;
  });
  assert.deepEqual(clipped, [], 'interval text clipped');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const kind of ['feed', 'clean']) for (const mode of [
    { label: 'desktop', width: 1280, height: 900, font: 14 },
    { label: 'short-large', width: 320, height: 380, font: 28 },
  ]) {
    const at = Date.now();
    const imported = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      schema: 1, revision: 1, species: 2, name: '照顾间隔伙伴', createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at,
      sleeping: false, needs: { hunger: 20, clean: 20, mood: 80, energy: 80 }, careCount: 0, logs: [],
    }) });
    assert(imported.ok, await imported.text());
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: mode.width === 320, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      // Entry visits are expected; assert every other POST is explicit care.
      page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname !== '/api/visit') writes.push(new URL(req.url()).pathname); });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      await menu(page, kind);
      assert((await page.locator('.care-preview').innerText()).includes('符合记录习惯的条件'));
      const first = await care(page, kind);
      assert.equal(first.careFeedback.reason, 'credited'); assert.equal(first.careFeedback.habitGain, 1);
      await menu(page, kind);
      const text = await page.locator('.care-preview').innerText();
      assert(text.includes('最近读取时约还需 30 分钟')); assert(text.includes('照顾仍能改善状态'));
      await readable(page);
      await page.locator('.care-preview').screenshot({ path: join(dir, `${kind}-${mode.label}.png`) });
      await page.locator('.button-c').scrollIntoViewIfNeeded();
      assert.deepEqual(writes, ['/api/action'], 'reading/scrolling issued an extra write');
      await page.reload(); await page.locator('.home-caption').waitFor();
      await menu(page, kind);
      assert((await page.locator('.care-preview').innerText()).includes('最近读取时约还需 30 分钟'), 'refresh lost accepted history');
      await readable(page);
      const second = await care(page, kind), f = second.careFeedback;
      assert.equal(f.reason, 'cooldown'); assert.equal(f.habitGain, 0); assert.equal(f.points, 0);
      const need = kind === 'feed' ? 'hunger' : 'clean', habit = kind === 'feed' ? 'nutrition' : 'clean';
      assert(f.effect.after[need] > f.effect.before[need], 'interval prevented state improvement');
      assert.equal(second.state.growth.care[habit], first.state.growth.care[habit]);
      assert.equal(second.state.careCount, 2);
      assert((await page.locator('.care-learning').innerText()).includes('不代表状态没有改善'));
      assert.deepEqual(writes, ['/api/action', '/api/action']); assert.deepEqual(errors, []);
      results.push({ kind, mode: mode.label, minutes: 30, habitGain: f.habitGain, needGain: f.effect.after[need] - f.effect.before[need], writes: writes.length });
      console.log('PASS', kind, mode.label);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} catch (error) {
  await writeFile(join(dir, 'failure.json'), JSON.stringify({ error: String(error), completed: results, serverLog: log }, null, 2));
  console.error('Failure artifacts', dir); throw error;
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
