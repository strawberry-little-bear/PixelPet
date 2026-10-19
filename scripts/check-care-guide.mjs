// Optional real-Chrome regression. Never accepts a player's URL or database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set PIXELPET_TEST_BINARY to an absolute freshly built binary.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-care-guide-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
let server, browser, startupError, log = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function seed(stage, full) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    schema: 1, revision: 1, species: 2, name: '睡个好觉', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    careCount: 0, logs: [], needs: { hunger: 60, mood: 80, clean: 60, energy: full ? 100 : 40 },
  }) });
  const reply = await response.json(); assert(response.ok, JSON.stringify(reply)); assert.equal(reply.state.growth.stage, stage); return reply.state;
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stderr.on('data', data => { log += data; }); server.stdout.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ label: 'normal', width: 390, height: 844, font: 14 }, { label: 'large', width: 320, height: 568, font: 28 }, { label: 'contrast', width: 320, height: 568, font: 28, forcedColors: 'active' }];
  for (const stage of ['baby', 'growing', 'adult']) for (const mode of modes) for (const profile of ['real', 'custom', 'missing', 'invalid']) {
    await seed(stage, false);
    const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', forcedColors: mode.forcedColors || 'none' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), mode.font);
      const page = await ctx.newPage(), writes = [], visits = [], errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST') { const path = new URL(r.url()).pathname; (path === '/api/visit' ? visits : writes).push(path); } });
      // Change response metadata only, not backend rules or saved state.
      await page.route('**/api/**', async route => {
        const response = await route.fetch(), reply = await response.json();
        if (profile === 'custom' && reply.careRules) reply.careRules.maxOfflineHours = 6;
        if (profile === 'missing') delete reply.careRules;
        if (profile === 'invalid' && reply.careRules) reply.careRules.maxOfflineHours = 0;
        await route.fulfill({ response, json: reply });
      });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const trigger = page.getByRole('button', { name: '玩法说明' }); await trigger.click();
      const dialog = page.getByRole('dialog'), guide = page.getByLabel('照顾与成长入门'); await guide.waitFor();
      const text = await guide.innerText();
      assert(text.includes('幼年 → 成长期 → 成年')); assert(text.includes('成年后形态固定')); assert(text.includes('按实际恢复量记录'));
      assert(text.includes('饱食和清洁仍会下降')); assert(text.includes('回访小结'));
      if (['real', 'custom'].includes(profile)) {
        assert(text.includes('单次最多 ' + (profile === 'real' ? 12 : 6) + ' 小时')); assert(text.includes('整段离开计入的时间可能超过单次上限'));
      } else { assert(text.includes('单次结算上限尚未读到')); assert(!/12|单次最多/.test(text)); }
      const close = page.getByRole('button', { name: '关闭', exact: true }); assert(await close.evaluate(e => e === document.activeElement));
      await page.keyboard.press('Shift+Tab'); assert(await dialog.evaluate(e => e.contains(document.activeElement)));
      for (const k of ['a', 'b', 'c']) await page.keyboard.press(k);
      assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.help-care button,.help-care a').count(), 0);
      const layout = await guide.evaluate(e => {
        const modal = e.closest('.modal'), rect = modal.getBoundingClientRect(), texts = [];
        const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { if (!walker.currentNode.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); texts.push(...range.getClientRects()); }
        return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || modal.scrollWidth > modal.clientWidth + 1,
          textInsideX: texts.every(r => r.left >= rect.left - 1 && r.right <= rect.right + 1),
          root: parseFloat(getComputedStyle(document.documentElement).fontSize), minText: Math.min(...[...e.querySelectorAll('p,h3')].map(p => parseFloat(getComputedStyle(p).fontSize))),
          modalInside: rect.top >= 0 && rect.bottom <= innerHeight + 1 };
      });
      assert(!layout.horizontalOverflow && layout.textInsideX && layout.modalInside, JSON.stringify(layout)); assert(layout.minText >= layout.root * .85, JSON.stringify(layout)); assert.equal(layout.root, mode.font);
      assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), mode.forcedColors === "active");
      await guide.locator('.help-save').scrollIntoViewIfNeeded(); assert(await guide.locator('.help-save').isVisible());
      const bottom = await guide.locator('.help-save').boundingBox(), modal = await dialog.boundingBox();
      assert(bottom.y >= modal.y && bottom.y + bottom.height <= modal.y + modal.height + 1);
      if (stage === 'baby' && profile === 'real') { await page.screenshot({ path: join(artifacts, 'care-guide-bottom-' + mode.label + '.png'), fullPage: true }); await dialog.evaluate(e => e.scrollTop = 0); await page.screenshot({ path: join(artifacts, 'care-guide-' + mode.label + '.png'), fullPage: true }); }
      await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0); assert(await trigger.evaluate(e => e === document.activeElement));
      // Reopen and test actual close control, after scrolling through the guide.
      await trigger.click(); await guide.locator('.help-save').scrollIntoViewIfNeeded(); await close.click(); assert.equal(await dialog.count(), 0);
      // Cross-check the existing status guide via A/B/C, without a gameplay write.
      const key = async k => page.locator('.button-' + k + ':not(:disabled)').tap();
      await key('a'); for (let i = 0; i < 4; i++) await key('a'); await key('b'); await key('a');
      const status = page.getByLabel('时间与状态说明'); await status.waitFor(); const statusText = await status.innerText();
      if (['real', 'custom'].includes(profile)) assert(statusText.includes('单次最多 ' + (profile === 'real' ? 12 : 6) + ' 小时'));
      else { assert(statusText.includes('详细速率尚未读到')); assert(!/12|单次最多/.test(statusText)); }
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ stage, profile, mode: mode.label, layout, writes: writes.length, readVisits: visits.length }); console.log('PASS', results.length, stage, profile, mode.label);
    } finally { await ctx.close(); }
  }
  await writeFile(join(artifacts, 'care-guide-results.json'), JSON.stringify({ db: join(dir, 'test.db'), port, results }, null, 2));
  console.log('PASS total', results.length, 'db', join(dir, 'test.db'), 'port', port, 'artifacts', artifacts);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
