// Real manifest, raster decoding and HTTP cache checks in an owned service.
// This does not install an app on an actual phone or test offline gameplay.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-home-screen-'));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`;
let server, context, startupError, log = '';
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, log);
  // A fresh non-incognito profile avoids CDP's unrelated in-incognito error.
  context = await chromium.launchPersistentContext(join(dir, 'chrome-profile'), { channel: 'chrome', headless: true });
  const page = context.pages()[0], errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const path = new URL(r.url()).pathname;
    if (r.method() !== 'GET' && !['/api/state', '/api/visit'].includes(path)) writes.push(path);
  });
  const response = await page.goto(base);
  assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store');
  await page.locator('.content-choose').waitFor();
  assert.equal(await page.locator('.device-buttons button').count(), 3);
  assert.equal(await page.locator('.lcd button, .lcd input, .lcd a').count(), 0);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.equal(manifest.url, `${base}/manifest.webmanifest`);
  assert.deepEqual(manifest.errors, []);
  const data = JSON.parse(manifest.data);
  assert.equal(new URL(data.start_url, manifest.url).href, `${base}/`);
  assert.equal(new URL(data.scope, manifest.url).href, `${base}/`);
  assert.equal(data.display, 'standalone');
  const apple = page.locator('link[rel="apple-touch-icon"]');
  assert.equal(await apple.count(), 1, 'Apple home-screen icon must be linked.');
  const applePath = await apple.getAttribute('href');
  const icons = data.icons.filter(icon => icon.type === 'image/png' && icon.purpose === 'any');
  assert(icons.some(icon => icon.sizes === '192x192'), 'Manifest needs a 192px PNG.');
  assert(icons.some(icon => icon.sizes === '512x512'), 'Manifest needs a 512px PNG.');
  const resources = [
    { src: '/manifest.webmanifest', type: /^(application\/manifest\+json|application\/json)/ },
    ...data.icons.map(icon => ({ ...icon, type: new RegExp(`^${icon.type.replace(/[+]/g, '\\+')}`) })),
    { src: applePath, sizes: '180x180', type: /^image\/png/ },
  ];
  const decoded = [];
  for (const resource of resources) {
    const url = new URL(resource.src, base);
    assert.equal(url.origin, base, 'Icons must be served by the same local service.');
    const result = await fetch(url);
    assert.equal(result.status, 200, resource.src);
    assert.match(result.headers.get('content-type'), resource.type, resource.src);
    assert.equal(result.headers.get('cache-control'), 'no-cache', resource.src);
    const modified = result.headers.get('last-modified');
    assert(modified, resource.src);
    const cached = await fetch(url, { headers: { 'If-Modified-Since': modified } });
    assert.equal(cached.status, 304, resource.src);
    assert.equal(cached.headers.get('cache-control'), 'no-cache', resource.src);
    if (resource.sizes && resource.sizes !== 'any') {
      const image = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = true; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) { opaque = false; break; }
        return { size: `${image.naturalWidth}x${image.naturalHeight}`, opaque };
      }, url.href);
      assert.equal(image.size, resource.sizes, resource.src);
      assert(image.opaque, `${resource.src} must have an opaque background.`);
      decoded.push({ src: resource.src, ...image });
    }
  }
  const install = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(install.installabilityErrors, []);
  await page.reload(); await page.locator('.content-choose').waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const result = { browser: context.browser().version(), manifest: manifest.manifest, decoded, install, writes, scope: 'Fresh desktop Chrome profile on localhost; no actual phone installation or offline play.' };
  await writeFile(join(dir, 'results.json'), JSON.stringify(result, null, 2));
  console.log('PASS manifest, PNG/Apple decoding, HTTP revalidation, three buttons, reload; artifacts', dir);
} finally {
  await context?.close();
  if (server?.pid && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  await writeFile(join(dir, 'server.log'), log);
}
