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
    const lcd = document.querySelector('.lcd-content');
    const content = lcd.getBoundingClientRect();
    const lcdScrolls = getComputedStyle(lcd).overflowY;
    const lcdScrollable = ['auto', 'scroll'].includes(lcdScrolls) && lcd.scrollHeight > lcd.clientHeight;
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect(), errors = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('horizontal overflow');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const element = text.parentElement;
      if (element?.matches('[data-care-reading-start]') && getComputedStyle(element).clipPath !== 'none') continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        const horizontalOverflow = box.left < content.left - 1 || box.right > content.right + 1;
        const verticalOverflow = box.top < content.top - 1 || box.bottom > Math.min(content.bottom, footer.top) + 1;
        if (horizontalOverflow || (verticalOverflow && !lcdScrollable)) errors.push('outside LCD: ' + text.textContent);
        let passedScrollport = false;
        for (let p = text.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), rect = p.getBoundingClientRect();
          const scrollable = ['auto', 'scroll'].includes(css.overflowY) && p.scrollHeight > p.clientHeight;
          if (scrollable) { passedScrollport = true; continue; }
          const horizontalClip = box.left < rect.left - 1 || box.right > rect.right + 1;
          const verticalClip = box.top < rect.top - 1 || box.bottom > rect.bottom + 1;
          if (horizontalClip || (!passedScrollport && verticalClip && (['hidden', 'clip'].includes(css.overflowY) || ['auto', 'scroll'].includes(css.overflowY)))) {
            errors.push('clipped: ' + text.textContent);
          }
        }
      }
    }
    const reading = document.querySelector('.status-reading');
    if (reading) {
      const rect = reading.getBoundingClientRect(), lastMeter = [...document.querySelectorAll('.lcd-meter')].at(-1).getBoundingClientRect();
      if (lastMeter.bottom > rect.top + 1 || rect.bottom > document.querySelector('.care-advice').getBoundingClientRect().top + 1) errors.push('reading overlaps another section');
    }
    const shell = Object.fromEntries(['.device-stage', '.device', '.screen-bezel', '.lcd', '.lcd-content']
      .map(selector => [selector, document.querySelector(selector).getBoundingClientRect().height]));
    return { errors, shell, scrollable: lcdScrollable, scrollTop: lcd.scrollTop, scrollHeight: lcd.scrollHeight, clientHeight: lcd.clientHeight };
  });
  assert.deepEqual(problems.errors, []);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,[aria-label="状态记录时间"] [tabindex]').count(), 0);
  return problems;
}
function assertSameShell(actual, expected, label) {
  for (const [selector, height] of Object.entries(expected)) {
    assert(Math.abs(actual[selector] - height) < 1,
      `${label} ${selector} height changed between status pages: ${actual[selector]} vs ${height}`);
  }
}
async function assertSummaryBottom(page) {
  const bottom = await page.locator('.lcd-content').evaluate(lcd => {
    const content = lcd.getBoundingClientRect();
    const summary = lcd.querySelector('.status-summary .life-summary-next')?.getBoundingClientRect();
    const summaryTop = summary ? summary.top - content.top + lcd.scrollTop : null;
    const maxScroll = lcd.scrollHeight - lcd.clientHeight;
    lcd.scrollTop = maxScroll;
    const readable = lcd.querySelector('.status-summary .life-summary')?.getBoundingClientRect();
    const readableContent = lcd.getBoundingClientRect();
    const pageNumber = lcd.querySelector('.status-page-number')?.getBoundingClientRect();
    return {
      maxScroll,
      scrollTop: lcd.scrollTop,
      summaryTop,
      summaryBottomOffset: summary && summaryTop !== null ? summaryTop + summary.height : null,
      scrollHeight: lcd.scrollHeight,
      lifeSummaryBottom: readable?.bottom ?? null,
      pageNumberBottom: pageNumber?.bottom ?? null,
      contentBottom: readableContent.bottom,
      contentTop: readableContent.top,
    };
  });
  assert(bottom.maxScroll > 0, `status summary must have an internal scroll range: ${JSON.stringify(bottom)}`);
  assert(Math.abs(bottom.scrollTop - bottom.maxScroll) < 1, `status summary did not reach its scroll end: ${JSON.stringify(bottom)}`);
  assert(bottom.summaryTop !== null && bottom.summaryTop >= -1 && bottom.summaryBottomOffset <= bottom.scrollHeight + 1,
    `status summary direction is not reachable inside LCD: ${JSON.stringify(bottom)}`);
  assert(bottom.lifeSummaryBottom !== null && bottom.lifeSummaryBottom <= bottom.contentBottom + 1 && bottom.lifeSummaryBottom >= bottom.contentTop - 1,
    `status summary bottom is not reachable inside LCD: ${JSON.stringify(bottom)}`);
  assert(bottom.pageNumberBottom !== null && bottom.pageNumberBottom <= bottom.contentBottom + 1,
    `status page number is not reachable inside LCD: ${JSON.stringify(bottom)}`);
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
        const layout = await readable(page);
        await reading.scrollIntoViewIfNeeded(); await page.locator('.button-c').scrollIntoViewIfNeeded();
        return { iso, layout };
      };
      await page.goto(base); await page.locator('.home-caption').waitFor(); await openStatus(page);
      const first = await verify(), shell = first.layout.shell;
      assert.equal(first.layout.scrollTop, 0, 'status page 1 must start at the top of the LCD');
      await key(page, 'a'); assert.equal(await page.locator('.status-reading').count(), 0);
      const summary = await readable(page); assertSameShell(summary.shell, shell, `${mode.label} status page 2`);
      await assertSummaryBottom(page);
      assert.equal(await page.locator('.status-summary').count(), 1);
      await key(page, 'a'); assert.equal(await page.locator('.status-reading').count(), 0);
      const rules = await readable(page); assertSameShell(rules.shell, shell, `${mode.label} status page 3`);
      assert.equal(rules.scrollTop, 0, 'status page 3 must reset the LCD scroll position');
      assert.equal(await page.locator('.status-rules').count(), 1);
      if (stage === 'baby' && zone === 'America/Los_Angeles') await page.screenshot({ path: join(dir, `${sleeping ? 'sleep' : 'awake'}-${mode.label}.png`), fullPage: true });
      await key(page, 'c'); assert.equal(await page.locator('.status-reading').count(), 0);
      await page.reload(); await page.locator('.home-caption').waitFor(); await openStatus(page);
      const refreshed = await verify(); assert(Date.parse(refreshed.iso) >= Date.parse(first.iso));
      assertSameShell(refreshed.layout.shell, shell, `${mode.label} refreshed status page 1`);
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
