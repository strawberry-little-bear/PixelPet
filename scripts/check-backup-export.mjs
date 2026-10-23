// Real HTTP failures/downloads, own temporary database, port, build and Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-backup-export-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, proxy, startupError, log = '', mode = 'success', lastBody, backupReads = 0;
const failedResponses = {
  corrupt: [409, 'application/json', JSON.stringify({ error: '存档需要修复', code: 'save_corrupt' })],
  unavailable: [503, 'text/html', '<h1>Upstream temporarily unavailable</h1>'],
  invalid: [200, 'application/json', '{"error":"not a backup"}'],
  html: [200, 'text/html', '<h1>Error</h1>'],
  oversized: [200, 'application/json', ' '.repeat(65537)],
  redirect: [302, 'text/plain', 'redirecting'],
};
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function readable(page) {
  // The reset dialog intentionally scrolls at 200% text size; prove the full
  // feedback is reachable before checking clipping, not that every item fits at once.
  await page.locator('.export-feedback').scrollIntoViewIfNeeded();
  const issues = await page.locator('.export-feedback').evaluate(el => {
    const errors = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && (box.left < rect.left - 1 || box.right > rect.right + 1) ||
          ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) errors.push(parent.className);
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('horizontal overflow');
    return errors;
  });
  assert.deepEqual(issues, []);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a').count(), 0);
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
  assert(ready, log);
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '导出试玩伙伴', createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  proxy = http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/backup') {
        backupReads++;
        if (mode === 'offline') { res.destroy(); return; }
        if (mode === 'timeout') { return; } // Browser/hook must abort this genuine hanging request.
        if (failedResponses[mode]) {
          const [status, type, body] = failedResponses[mode]; res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(mode === 'redirect' ? { Location: base + '/' } : {}) }); res.end(body); return;
        }
      }
      const chunks = []; for await (const c of req) chunks.push(c);
      const response = await fetch(base + req.url, { method: req.method, headers: {
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
        ...(req.headers['x-pixelpet-generation'] ? { 'X-PixelPet-Generation': req.headers['x-pixelpet-generation'] } : {}),
      }, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const body = Buffer.from(await response.arrayBuffer());
      if (req.url === '/api/backup') lastBody = body;
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
    } catch { if (!res.destroyed) { res.writeHead(503); res.end(); } }
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${proxy.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const font of [14, 28]) for (const reset of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, acceptDownloads: true, reducedMotion: 'reduce', forcedColors: width < 700 ? 'active' : 'none' });
    const page = await ctx.newPage(), errors = [], downloads = [], writes = [];
    const tag = `${width}-${font}-${reset ? 'reset' : 'menu'}`;
    page.on('pageerror', e => errors.push(e.message)); page.on('download', d => downloads.push(d));
    page.on('request', r => { if (r.method() === 'POST' && /\/api\/(action|import|reset)/.test(r.url())) writes.push(r.postData()); });
    try {
      console.log('RUN', tag);
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
      await page.goto(url); await page.locator('.home-caption').waitFor();
      await page.getByRole('button', { name: '存档盒', exact: true }).click();
      if (reset) {
        await page.getByRole('button', { name: '重新开始', exact: true }).click();
        await page.getByRole('textbox', { name: '重新开始确认文字' }).fill('导出试玩伙伴');
      }
      const button = page.getByRole('button', { name: reset ? '先导出当前存档' : '导出存档', exact: true });
      for (mode of Object.keys(failedResponses).concat('offline')) {
        const before = downloads.length;
        await button.click(); await page.locator('.export-feedback[role="alert"]').waitFor();
        assert((await page.locator('.export-feedback').innerText()).includes('导出失败'));
        assert.equal(downloads.length, before, `Failed ${mode} must not trigger a download`);
        assert(await button.isEnabled()); await readable(page);
      }
      if (width === 320 && font === 28) await page.screenshot({ path: join(dir, `failure-${tag}.png`), fullPage: true });
      // Real pending request: no duplicate, importing or resetting while waiting.
      mode = 'timeout'; let reads = backupReads;
      await button.click(); await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"]'));
      await wait(500); assert.equal(backupReads, reads + 1);
      assert(await button.isDisabled());
      if (reset) assert(await page.getByRole('button', { name: '确认重新开始', exact: true }).isDisabled());
      else {
        assert(await page.getByRole('button', { name: '导入备份' }).isDisabled());
        assert(await page.getByRole('button', { name: '重新开始', exact: true }).isDisabled());
      }
      await page.locator('.export-feedback[role="alert"]').waitFor({ timeout: 12000 });
      assert((await page.locator('.export-feedback').innerText()).includes('超时'));
      assert.equal(downloads.length, 0); assert(await button.isEnabled()); await readable(page);
      mode = 'success'; reads = backupReads;
      const download = page.waitForEvent('download'); await button.click(); const file = await download;
      assert.equal(await file.failure(), null); assert.equal(file.suggestedFilename(), 'pixelpet-backup.json');
      const bytes = await readFile(await file.path()); assert.deepEqual(bytes, lastBody);
      const exported = JSON.parse(bytes); assert.equal(exported.name, '导出试玩伙伴'); assert.equal(exported.careCount, 0);
      assert.equal(backupReads, reads + 1); assert.equal(downloads.length, 1);
      await page.locator('.export-feedback[role="status"]').waitFor();
      assert((await page.locator('.export-feedback').innerText()).includes('确认文件已保存'));
      assert.equal(await page.locator('.export-feedback[role="alert"]').count(), 0); await readable(page);
      await page.screenshot({ path: join(dir, `success-${tag}.png`), fullPage: true });
      if (reset) {
        const confirm = page.getByRole('button', { name: '确认重新开始', exact: true });
        await confirm.scrollIntoViewIfNeeded(); assert(await confirm.isEnabled());
        const visible = await confirm.evaluate(el => {
          const box = el.getBoundingClientRect(), modal = el.closest('.modal').getBoundingClientRect();
          return box.top >= modal.top && box.bottom <= modal.bottom && box.top >= 0 && box.bottom <= innerHeight;
        });
        assert(visible, 'Reset confirmation remains reachable by scrolling, never clicked during export tests');
        if (width === 320 && font === 28) await page.screenshot({ path: join(dir, `reset-controls-${tag}.png`), fullPage: true });
      }

      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      await writeFile(join(dir, `backup-${tag}.json`), bytes);
      // Restore only to this script's temporary server, never the player's save.
      const restored = await api('import', exported);
      assert.equal(restored.state.name, exported.name); assert.equal(restored.state.species, exported.species);
      assert.equal(restored.state.careCount, exported.careCount);
      results.push({ width, font, reset, failures: Object.keys(failedResponses).concat('offline', 'timeout'), downloads: downloads.length, filename: file.suggestedFilename(), bytes: bytes.length, roundTrip: true, writes, errors });
    } catch (e) { await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }); console.error('Artifacts:', dir); throw e; }
    finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir }));
} finally {
  if (browser) await browser.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  if (server && server.exitCode === null && server.signalCode === null) { const exit = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exit; }
}
