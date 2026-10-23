// Native keyboard checks against an isolated HTTP service and temporary SQLite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-reset-confirmation-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [width, height, font] of [[1200, 700, 14], [320, 700, 14], [320, 700, 28], [320, 380, 28]]) {
    const now = Date.now(), name = 'ABC陪伴伙伴';
    await api('import', { schema: 1, revision: 1, species: 2, name, createdAt: now - 3600000, hatchedAt: now - 3500000, lastTick: now,
      sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', forcedColors: width < 700 ? 'active' : 'none' });
    try {
      const page = await ctx.newPage(), errors = [], resets = []; const tag = `${width}-${height}-${font}`;
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/reset')) resets.push(r.postData()); });
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
      await page.goto(base); await page.locator('.home-caption').waitFor();
      const open = async () => { await page.getByRole('button', { name: '存档盒', exact: true }).click(); await page.getByRole('button', { name: '重新开始', exact: true }).click(); };
      for (const modal of ['help', 'reset']) {
        if (modal === 'help') await page.getByRole('button', { name: '玩法说明', exact: true }).click();
        else await open();
        const close = page.getByRole('button', { name: '关闭', exact: true }); await close.focus();
        for (const shortcut of ['Control+c', 'Meta+c', 'Alt+c']) {
          await page.keyboard.press(shortcut);
          assert(await page.getByRole('dialog').isVisible(), shortcut + ' must not dismiss ' + modal);
          assert(await close.evaluate(el => el === document.activeElement));
          assert.equal(resets.length, 0);
        }
        await page.keyboard.press('c'); await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert(await page.locator('.button-c').evaluate(el => el === document.activeElement));
      }
      await open(); const input = page.getByRole('textbox', { name: '重新开始确认文字' });
      const confirm = page.getByRole('button', { name: '确认重新开始', exact: true });
      assert(await confirm.isDisabled());
      await input.click(); await page.keyboard.type('ABC'); assert.equal(await input.inputValue(), 'ABC');
      await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+c');
      assert.equal(await input.inputValue(), 'ABC');
      assert(await page.getByRole('dialog').isVisible()); assert(await confirm.isDisabled());
      await page.keyboard.press('Enter'); assert.equal(resets.length, 0);
      await page.keyboard.press('Tab'); assert(await page.getByRole('button', { name: '关闭', exact: true }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Shift+Tab'); assert(await input.evaluate(el => el === document.activeElement));
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert(await page.locator('.button-c').evaluate(el => el === document.activeElement));
      await open(); assert.equal(await input.inputValue(), '');
      await input.fill('abc陪伴伙伴'); assert(await confirm.isDisabled());
      await input.fill(name); assert(await confirm.isEnabled());
      await page.keyboard.press('Enter'); assert.equal(resets.length, 0);
      await page.keyboard.press('Tab'); assert(await confirm.evaluate(el => el === document.activeElement));
      await confirm.scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => {
        const modal = document.querySelector('.modal'), input = document.querySelector('#reset-confirmation'), button = document.querySelector('.confirm-reset');
        const rect = button.getBoundingClientRect(), bounds = modal.getBoundingClientRect(), field = input.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, reachable: rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
          inputFits: field.left >= bounds.left && field.right <= bounds.right + 1 };
      });
      assert.deepEqual(layout, { overflow: false, reachable: true, inputFits: true });
      assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
      await page.screenshot({ path: join(dir, `ready-${tag}.png`), fullPage: true });
      await page.keyboard.press('Enter'); await page.locator('.content-choose').waitFor();
      assert.equal(resets.length, 1); assert.equal((await api('state')).state.hatchedAt, 0);
      // The egg uses explicit words instead of the previous companion's name.
      await open(); await input.fill(name); assert(await confirm.isDisabled());
      await input.fill('重新开始'); assert(await confirm.isEnabled());
      await input.press('Escape'); assert.equal(resets.length, 1);
      assert.deepEqual(errors, []); results.push({ tag, layout, resetRequests: resets.length });
      console.log('PASS', tag);
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir }));
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
}
