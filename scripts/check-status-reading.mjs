// Isolated, real HTTP snapshot timestamps in two local time zones. Never use
// the player's database, shared binary/web output or existing browser tabs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB');
// Fresh checkouts may not have shared build outputs yet. Still resolve existing
// symlinks so an alias cannot bypass the shared-output protection.
const sharedPath = path => realpath(path).catch(error => { if (error.code === 'ENOENT') return resolve(path); throw error; });
assert.notEqual(await realpath(binary), await sharedPath(join(root, 'bin/pixelpet')), 'Do not run the shared binary');
assert.notEqual(await realpath(web), await sharedPath(join(root, 'web/dist')), 'Use an isolated web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-status-reading-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const dateOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
async function key(page, k) {
  await page.locator('.button-' + k).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function openStatus(page) { await key(page, 'a'); for (let i = 0; i < 4; i++) await key(page, 'a'); await key(page, 'b'); }
async function readable(page) {
  const problems = await page.locator('.screen-status').evaluate(el => {
    const content = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('horizontal overflow');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < content.left - 1 || box.right > content.right + 1 || box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1) errors.push('outside LCD: ' + text.textContent);
        for (let p = text.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push('clipped: ' + text.textContent);
        }
      }
    }
    const reading = document.querySelector('.status-reading');
    if (reading) {
      const rect = reading.getBoundingClientRect(), lastMeter = [...document.querySelectorAll('.lcd-meter')].at(-1).getBoundingClientRect();
      if (lastMeter.bottom > rect.top + 1 || rect.bottom > document.querySelector('.care-advice').getBoundingClientRect().top + 1) errors.push('reading overlaps another section');
    }
    return errors;
  });
  assert.deepEqual(problems, []);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,[aria-label="状态记录时间"] [tabindex]').count(), 0);
}
let server, browser, log = '', startupError;
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [
    { label: 'desktop', width: 1280, height: 900, font: 14 },
    { label: 'phone-large', width: 320, height: 568, font: 28 },
    { label: 'short-large', width: 320, height: 380, font: 28 },
    { label: 'contrast-large', width: 320, height: 568, font: 28, forcedColors: 'active' },
  ];
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) for (const mode of modes) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    const imported = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      schema: 1, revision: 1, species: 2, name: '时间伙伴', createdAt: at - age, hatchedAt: at - age, lastTick: at, sleeping,
      needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [],
    }) });
    const source = await imported.json(); assert(imported.ok, JSON.stringify(source)); assert.equal(source.state.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, timezoneId: zone, locale: 'zh-CN', isMobile: mode.width === 320, hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.forcedColors || 'none' });
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await context.newPage(), errors = [], writes = [], samples = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { const path = new URL(r.url()).pathname; if (r.method() === 'POST' && path !== '/api/visit') writes.push(path); });
      // Record actual payloads read by this tab; no DB edit or response fixture.
      await page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (reply.state) samples.push(reply.state);
        await route.fulfill({ response, json: reply });
      });
      const verify = async () => {
        const reading = page.getByLabel('状态记录时间'); await reading.waitFor({ timeout: 3000 });
        assert(samples.length > 0);
        const state = samples.at(-1), iso = new Date(state.lastTick).toISOString();
        assert.equal(await reading.locator('time').getAttribute('datetime'), iso);
        assert.equal(await reading.locator('time').innerText(), new Date(state.lastTick).toLocaleString('zh-CN', { ...dateOptions, timeZone: zone }));
        assert((await reading.innerText()).includes('不是按浏览器时间推算'));
        assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), zone);
        for (const [label, field] of [['饱食', 'hunger'], ['心情', 'mood'], ['清洁', 'clean'], ['体力', 'energy']]) {
          assert.equal(Number(await page.locator('.screen-status').getByRole('meter', { name: label, exact: true }).getAttribute('aria-valuenow')), state.needs[field]);
        }
        const sizes = await reading.evaluate(el => ({ text: parseFloat(getComputedStyle(el).fontSize), root: parseFloat(getComputedStyle(document.querySelector('.lcd-content')).fontSize) }));
        assert.equal(sizes.text, sizes.root, 'do not shrink the timestamp text');
        await readable(page);
        await reading.scrollIntoViewIfNeeded(); await page.locator('.button-c').scrollIntoViewIfNeeded();
        return iso;
      };
      await page.goto(base); await page.locator('.home-caption').waitFor(); await openStatus(page);
      const first = await verify();
      await key(page, 'a'); assert.equal(await page.locator('.status-reading').count(), 0); await readable(page);
      await key(page, 'a'); assert.equal(await verify(), first, 'changing pages must not invent a newer timestamp');
      if (stage === 'baby' && zone === 'America/Los_Angeles') await page.screenshot({ path: join(dir, `${sleeping ? 'sleep' : 'awake'}-${mode.label}.png`), fullPage: true });
      await key(page, 'c'); assert.equal(await page.locator('.status-reading').count(), 0);
      await page.reload(); await page.locator('.home-caption').waitFor(); await openStatus(page);
      const refreshed = await verify(); assert(Date.parse(refreshed) >= Date.parse(first));
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ stage, sleeping, zone, mode: mode.label, first, refreshed });
      console.log('PASS', results.length, stage, sleeping, zone, mode.label);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify({ results, db: join(dir, 'test.db'), port }, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
