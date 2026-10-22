// Native keyboard activation; own temporary save, port, browser and build only.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-physical-keyboard-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
let server, browser, startupError, log = '';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function heldKey(page, key) {
  // Playwright repeated down calls produce native repeat events; keyup also
  // runs so a missed preventDefault cannot hide a second Space activation.
  await page.keyboard.down(key);
  for (let i = 0; i < 3; i++) await page.keyboard.down(key);
  await page.keyboard.up(key);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const font of [14, 28]) for (const key of ['Enter', 'Space']) {
    // Cancellation comes first so the unsafe old build fails on real import,
    // rather than only on a menu selection or synthetic event assertion.
    for (const mode of ['import', 'menu']) for (const control of ['C', 'A', 'B']) {
      const now = Date.now();
      await api('import', { schema: 1, revision: 1, species: 2, name: '键盘伙伴', createdAt: now - 3600000,
        hatchedAt: now - 3600000, lastTick: now, sleeping: false,
        needs: { hunger: 40, mood: 70, clean: 60, energy: 80 }, careCount: 0, logs: [] });
      const before = await api('state');
      const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width < 700,
        reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
      let page; const errors = [], writes = [];
      try {
        console.log('RUN', width, font, key, mode, control);
        await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
        page = await ctx.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => {
          const path = new URL(r.url()).pathname;
          if (r.method() === 'POST' && path !== '/api/visit') writes.push(path);
        });
        await page.goto(base); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd input,.lcd a').count(), 0);
        // Non-game buttons keep native Enter/Space activation and focus restore.
        await page.getByRole('button', { name: '玩法说明' }).click();
        await page.getByRole('dialog').waitFor();
        assert((await page.getByRole('dialog').innerText()).includes('Tab 聚焦机身按钮'));
        assert(await page.getByRole('button', { name: '关闭', exact: true }).evaluate(el => el === document.activeElement));
        if (width === 320 && font === 28 && mode === 'import' && control === 'C') {
          const note = page.getByText('也可以用 Tab 聚焦机身按钮，再按 Enter 或空格操作该按钮。', { exact: true });
          await note.scrollIntoViewIfNeeded();
          assert(await note.evaluate(el => {
            const box = el.getBoundingClientRect(), modal = el.closest('[role="dialog"]').getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(el);
            return box.top >= modal.top && box.bottom <= modal.bottom &&
              [...range.getClientRects()].every(r => r.left >= modal.left && r.right <= modal.right);
          }), 'The new keyboard help must be reachable and readable at 320px/200%');
          await page.screenshot({ path: join(dir, `help-${key}.png`), fullPage: true });
        }
        await page.keyboard.press(key); await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert(await page.locator('.physical-button.button-c').evaluate(el => el === document.activeElement));
        // Tab actually traverses the three buttons in visual A/B/C order.
        await page.locator('.button-a').focus(); await page.keyboard.press('Tab');
        assert(await page.locator('.button-b').evaluate(el => el === document.activeElement));
        await page.keyboard.press('Tab'); assert(await page.locator('.button-c').evaluate(el => el === document.activeElement));
        if (mode === 'import') {
          const backup = { ...before.state, name: '备份里的伙伴' };
          await page.locator('input[type="file"]').setInputFiles({ name: 'keyboard-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
          await page.locator('.import-preview[aria-busy="false"]').waitFor();
          assert(await page.locator('.button-c').evaluate(el => el === document.activeElement), 'Preview must start on safe C');
        } else {
          await page.locator('.button-a').tap(); await page.locator('.care-item.selected').waitFor();
        }
        await page.locator(`.button-${control.toLowerCase()}`).focus();
        await page.evaluate(() => {
          window.__physicalEvents = [];
          for (const type of ['keydown', 'keyup', 'click']) window.addEventListener(type, e => {
            window.__physicalEvents.push({ type, key: e.key, repeat: e.repeat, trusted: e.isTrusted,
              prevented: e.defaultPrevented, target: e.target.className });
          });
        });
        await heldKey(page, key);
        if (mode === 'import' || control !== 'A') await page.locator('.content-home').waitFor();
        else await page.waitForFunction(() => document.querySelector('.care-item.selected')?.textContent.includes('一起玩耍'));
        await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
        const after = await api('state');
        if (mode === 'import') {
          assert.equal(after.state.name, control === 'B' ? '备份里的伙伴' : '键盘伙伴', `${key} on focused ${control} must ${control === 'B' ? 'confirm' : 'cancel'} import`);
          assert.deepEqual(writes, control === 'B' ? ['/api/import'] : []);
          assert.equal(after.state.careCount, before.state.careCount);
        } else {
          assert.deepEqual(writes, control === 'B' ? ['/api/action'] : []);
          assert.equal(after.state.careCount, before.state.careCount + (control === 'B' ? 1 : 0));
          if (control === 'A') assert((await page.locator('.care-item.selected').innerText()).includes('一起玩耍'));
          assert.equal(after.state.name, '键盘伙伴');
        }
        assert.deepEqual(errors, []);
        const events = await page.evaluate(() => window.__physicalEvents);
        const downs = events.filter(e => e.type === 'keydown');
        assert.equal(downs.length, 4); assert.equal(downs[0].repeat, false);
        assert(downs.slice(1).every(e => e.repeat));
        assert(downs.every(e => e.trusted && e.prevented));
        assert.equal(events.filter(e => e.type === 'click').length, 0, 'No native follow-up click on Enter or Space keyup');
        results.push({ width, font, key, mode, control, writes, events });
        if (width === 320 && font === 28 && mode === 'import' && control === 'C') await page.screenshot({ path: join(dir, `cancel-${key}.png`), fullPage: true });
      } catch (error) {
        if (page) {
          await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
          await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, font, key, mode, control, writes, errors,
            state: await api('state'), dom: await page.locator('.device').innerText(),
            events: await page.evaluate(() => window.__physicalEvents) }, null, 2));
        }
        console.error('Artifacts:', dir); throw error;
      } finally { await ctx.close(); }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
