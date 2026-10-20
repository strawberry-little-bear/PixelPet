// A held HTTP pulse deliberately exercises touch-vs-write ordering. This is not
// evidence of natural network failures or a physical-device accessibility audit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-fishing-pulse-pause-'));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms)), results = [];
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }); assert(r.ok, await r.clone().text()); return r.json();
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [320, 1200]) for (const mode of ['acknowledged', 'unknown', 'rejected', 'help', 'blur']) {
    const tag = `${width}-${mode}`; console.log('RUN', tag);
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '暂停慢慢等',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
      needs: { hunger: 80, mood: 80, energy: 80, clean: 80 } });
    await api('action', { kind: 'play-fishing' });
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width === 320,
      reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
    const page = await ctx.newPage(), writes = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
    let release, held = false;
    const gate = new Promise(r => { release = r; });
    try {
      await page.route('**/api/action', async route => {
        if (route.request().postDataJSON().kind !== 'fish-step') return route.continue();
        assert.equal(held, false, 'a second automatic pulse overlapped the held request');
        const response = mode === 'rejected' ? null : await route.fetch();
        held = true;
        await gate;
        if (mode === 'unknown') await route.abort('failed');
        else if (mode === 'rejected') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '受控拒绝，步进未保存' }) });
        else await route.fulfill({ response });
      });
      await page.goto(base); await page.locator('.fishing-game').waitFor();
      await page.locator('.button-b').tap();
      const deadline = Date.now() + 10000;
      while (!held && Date.now() < deadline) await wait(20);
      assert(held, 'automatic pulse did not reach the controlled response gate');
      await page.locator('.button-b:disabled').waitFor();
      assert(await page.locator('.button-a').isDisabled());
      assert(await page.locator('.button-c').isEnabled(), 'C should accept a pause while the automatic pulse is held');
      await page.locator('.button-c').tap(); await page.locator('.fishing-pause').waitFor();
      assert(await page.locator('.button-c').isDisabled(), 'a second C must not toggle the queued pause');
      assert.equal(writes.filter(a => a.kind === 'fish-pause').length, 0, 'pause raced the in-flight step');
      await wait(250); assert.equal(writes.filter(a => a.kind === 'fish-step').length, 1);
      if (mode === 'help') {
        await page.getByRole('button', { name: '玩法说明' }).click();
        await page.getByRole('dialog').waitFor();
      }
      if (mode === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const before = (await api('state')).state;
      release();
      await page.locator('.button-b:not(:disabled)').waitFor();
      if (mode === 'help') await page.getByRole('button', { name: '关闭', exact: true }).click();
      await wait(1500);
      const after = (await api('state')).state;
      assert.equal(writes.filter(a => a.kind === 'fish-step').length, 1);
      assert.equal(writes.filter(a => a.kind === 'fish-pause').length, mode === 'acknowledged' ? 1 : 0);
      assert.equal(after.game.fishing.paused, mode === 'acknowledged');
      if (mode === 'acknowledged') {
        const pause = writes.find(a => a.kind === 'fish-pause');
        assert.equal(pause.step, before.game.fishing.step);
        assert.equal(pause.gameId, before.game.id);
        await page.reload(); await page.locator('.fishing-pause').waitFor();
      } else if (mode === 'unknown') {
        // Reconciliation is a read, never an excuse to replay the queued pause.
        await page.locator('.button-b').tap(); await page.locator('.fishing-pause').waitFor();
        await wait(250); assert.equal(writes.filter(a => a.kind === 'fish-pause').length, 0);
      } else await page.locator('.fishing-pause').waitFor();
      assert.equal(after.careCount, 0); assert.equal(after.economy.coins, 0);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(dir, tag + '.png'), fullPage: true });
      results.push({ width, mode, writes, fishing: after.game.fishing });
    } catch (e) {
      await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
      await writeFile(join(dir, 'failure.json'), JSON.stringify({ tag, writes, errors, state: await api('state') }, null, 2));
      throw e;
    } finally { release(); await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await closed;
  }
}
