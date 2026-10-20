// Real Chrome/Go cache check across two isolated builds. No routing interception,
// player service, shared dist, database replacement or automatic deployment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { web: nextWeb } = await isolatedTestBuilds({ env: { ...process.env, PIXELPET_TEST_WEB: process.env.PIXELPET_CACHE_NEXT_WEB } });
assert.notEqual(web, nextWeb, 'Use the before/after builds produced by check-build-cache.mjs');
async function assets(web) {
  const entries = Object.values(JSON.parse(await readFile(join(web, '.vite/manifest.json'), 'utf8')));
  return { app: entries.find(chunk => chunk.isEntry)?.file, runtime: entries.find(chunk => chunk.name === 'react-vendor')?.file };
}
const before = await assets(web), after = await assets(nextWeb);
assert(before.app && before.runtime && after.app && after.runtime);
assert.notEqual(before.app, after.app); assert.equal(before.runtime, after.runtime);
assert.deepEqual(await readFile(join(web, before.runtime)), await readFile(join(nextWeb, after.runtime)));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-runtime-cache-')), served = join(dir, 'web');
await cp(web, served, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
let server, browser, log = '', startupError;
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: served }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch { /* startup only */ }
    await wait(100);
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) {
    await api('reset', { confirm: true });
    const baseline = (await api('action', { kind: 'hatch', species: 0 })).state;
    await cp(web, served, { recursive: true });
    // Deliberately preserve the HTML timestamp across an update: content must
    // not be mistaken for the old document just because its mtime matches.
    const htmlDate = new Date('2026-10-19T00:00:00Z');
    await utimes(join(served, 'index.html'), htmlDate, htmlDate);
    const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], failures = [], responses = [], cacheHits = new Set();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestServedFromCache', e => cacheHits.add(e.requestId));
    cdp.on('Network.responseReceived', e => responses.push(e));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure() }));
    page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
    try {
      await page.goto(base); await page.locator('.pet-scene[data-motion="idle"]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buildCacheProbe), undefined);
      const firstHtml = responses.find(e => e.type === 'Document' && e.response.url === base + '/');
      assert.equal(firstHtml?.response.headers['Cache-Control'], 'no-store');
      const firstRuntime = responses.find(e => e.response.url === `${base}/${before.runtime}`);
      assert(firstRuntime && !firstRuntime.response.fromDiskCache && !cacheHits.has(firstRuntime.requestId), 'cold load must fetch runtime');
      assert.equal(firstRuntime.response.headers['Cache-Control'], 'public, max-age=31536000, immutable');
      await page.goto('about:blank');
      await cp(nextWeb, served, { recursive: true });
      await utimes(join(served, 'index.html'), htmlDate, htmlDate);
      responses.length = 0; cacheHits.clear();
      await page.goto(base); await page.locator('.pet-scene[data-motion="idle"]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.buildCacheProbe), 'isolated-cache-check', 'updated HTML must load the new app');
      const runtime = responses.find(e => e.response.url === `${base}/${after.runtime}`);
      const app = responses.find(e => e.response.url === `${base}/${after.app}`);
      const runtimeFromCache = !!runtime && (!!runtime.response.fromDiskCache || cacheHits.has(runtime.requestId));
      assert(runtimeFromCache, 'unchanged runtime must come from browser cache');
      const html = responses.find(e => e.type === 'Document' && e.response.url === base + '/');
      assert(html && html.response.status === 200 && !html.response.fromDiskCache && !cacheHits.has(html.requestId));
      assert.equal(html.response.headers['Cache-Control'], 'no-store');
      assert(app && !app.response.fromDiskCache && !cacheHits.has(app.requestId), 'new app must be fetched');
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      // Exercise a real saved action after the update, not just a rendered logo.
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action');
      await page.locator('.button-a').tap(); await page.locator('.button-b').tap();
      const receipt = await saved; assert(receipt.ok(), await receipt.text());
      const state = (await receipt.json()).state;
      assert.equal(state.careCount, baseline.careCount + 1);
      await page.locator('.pet-scene[data-motion="eating"]').waitFor();
      await page.locator('.button-c').tap();
      await page.screenshot({ path: join(dir, `${width}-after-update.png`), fullPage: true });
      const current = (await api('state')).state; assert.equal(current.careCount, state.careCount);
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      results.push({ width, before, after, runtimeFromCache, runtimeCache: { fromDiskCache: !!runtime.response.fromDiskCache,
        cacheEvent: cacheHits.has(runtime.requestId), header: runtime.response.headers['Cache-Control'] },
        html: { status: html.response.status, header: html.response.headers['Cache-Control'] },
        htmlTimestampUnchanged: true, careCount: state.careCount });
    } catch (error) {
      await writeFile(join(dir, `${width}-network.json`), JSON.stringify({ responses, cacheHits: [...cacheHits], errors, failures }, null, 2));
      await page.screenshot({ path: join(dir, `${width}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port, results }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server?.pid && server.exitCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
