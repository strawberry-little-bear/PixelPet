// Constructed delayed-hatch saves in an owned HTTP/SQLite service. These checks
// exercise real hatching and reading; they do not simulate natural multi-day play.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-meeting-days-')), results = [], day = 86400000;
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) {
  await page.locator(`.button-${k}`).click();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function menu(page, index) {
  await key(page, 'a');
  for (let i = 0; i < index; i++) await key(page, 'a');
  await key(page, 'b');
}
async function resetDays(page, expected) {
  await page.getByRole('button', { name: '存档盒', exact: true }).click();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  assert.equal(await page.locator('.reset-summary > dl > div').first().locator('dd').textContent(), expected);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
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
  for (const [width, height, font] of [[1200, 800, 14], [390, 844, 14], [320, 700, 28]]) for (const age of [0, 2]) {
    const now = Date.now(), tag = `${width}-${font}-day${age + 1}`;
    // Both eggs waited a week. One hatches through the UI; the other is a legal
    // legacy save already hatched two days ago. LastTick is current in both.
    const imported = (await api('import', { schema: 1, revision: 1, species: 2, name: '相识伙伴',
      createdAt: now - (7 + age) * day, hatchedAt: age ? now - age * day - 3600000 : 0,
      lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] })).state;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && !['/api/visit', '/api/state'].includes(new URL(r.url()).pathname)) writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
      console.log('RUN', tag);
      await page.goto(base);
      if (!age) {
        await page.locator('.content-choose').waitFor();
        await resetDays(page, '尚未孵化');
        await key(page, 'b'); await page.locator('.content-hatch').waitFor();
        // A native confirmation hatches exactly once, even though the egg is old.
        await page.locator('.button-b').focus(); await page.keyboard.press('Enter');
      }
      await page.locator('.home-caption').waitFor();
      // Cancel any hatch celebration before opening reading pages.
      if (!age) await key(page, 'c');
      assert.match(await page.locator('.home-caption').textContent(), new RegExp(`DAY ${age + 1}$`));
      const before = (await api('state')).state;
      assert.equal(before.createdAt, imported.createdAt);
      assert(before.hatchedAt - before.createdAt >= 6 * day);
      await menu(page, 4);
      assert.match(await page.locator('.status-name').textContent(), new RegExp(`相识第 ${age + 1}\\s*天`));
      await key(page, 'a'); await page.locator('.life-summary').waitFor();
      const verifySummary = async () => {
        assert.equal(await page.locator('.life-summary-grid > div > strong').first().textContent(), String(age + 1));
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd input,.lcd a').count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const grid = page.locator('.life-summary-grid');
        const layout = await grid.evaluate(element => {
          const box = element.getBoundingClientRect();
          const cells = [...element.children].map(child => {
            const rect = child.getBoundingClientRect();
            const label = child.querySelector('span');
            return {
              top: Math.round(rect.top * 10) / 10,
              right: rect.right,
              labelWidth: label?.getBoundingClientRect().width ?? 0,
              labelScrollWidth: label?.scrollWidth ?? 0,
            };
          });
          const rows = [...new Set(cells.map(cell => cell.top))].sort((a, b) => a - b);
          return { width: box.width, right: box.right, cells, rowSizes: rows.map(top => cells.filter(cell => cell.top === top).length) };
        });
        assert.equal(layout.cells.length, 5);
        assert(layout.cells.every(cell => cell.right <= layout.right + 1), `${tag} summary metrics overflow the grid`);
        assert(layout.cells.every(cell => cell.labelScrollWidth <= cell.labelWidth + 1), `${tag} summary label is clipped`);
        if (width === 390 && font === 14) assert.deepEqual(layout.rowSizes, [3, 2]);
      };
      await verifySummary();
      await page.locator('.life-summary-grid').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(dir, `${tag}-summary.png`), fullPage: true });
      await key(page, 'c'); await menu(page, 8);
      await page.locator('.album-directory').waitFor(); await key(page, 'b');
      assert.equal(await page.locator('.album-panel h3').textContent(), age ? `与你相识 ${age} 天` : '今天刚刚相识');
      await key(page, 'c'); await key(page, 'c'); await resetDays(page, `${age + 1} 天`);
      await page.reload(); await page.locator('.home-caption').waitFor();
      await menu(page, 4); await key(page, 'a'); await verifySummary();
      const after = (await api('state')).state;
      assert.equal(after.createdAt, before.createdAt); assert.equal(after.hatchedAt, before.hatchedAt);
      assert.deepEqual(after.album, before.album); assert.equal(after.careCount, before.careCount);
      assert.equal(writes.length, age ? 0 : 1);
      if (!age) { assert.equal(writes[0].path, '/api/action'); assert.equal(writes[0].body.kind, 'hatch'); }
      assert.deepEqual(errors, []);
      results.push({ tag, sharedDay: age + 1, createdAt: after.createdAt, hatchedAt: after.hatchedAt, writes: writes.length });
      console.log('PASS', tag);
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS total', results.length, 'artifacts', dir);
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
