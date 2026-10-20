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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-board-pulse-pause-'));
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
  for (const width of [320, 1200]) for (const kind of ['snake', 'tetris']) for (const mode of ['acknowledged', 'unknown', 'rejected', 'help', 'blur', 'hidden', 'pause-unknown', 'pause-rejected', 'finish']) {
    const tag = `${width}-${kind}-${mode}`; console.log('RUN', tag);
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '棋盘暂停检查',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
      needs: { hunger: 80, mood: 80, energy: 80, clean: 80 } });
    await api('action', { kind: `play-${kind}` });
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width === 320,
      reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
    const page = await ctx.newPage(), writes = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
    let release, held = false, blockReadback = false, stepRequests = 0;
    const gate = new Promise(r => { release = r; });
    try {
      await page.addInitScript(({ width }) => {
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = width === 320 ? '28px' : '14px'; });
      }, { width });
      await page.route('**/api/state', route => blockReadback
        ? route.fulfill({ status: 503, body: '受控核对暂不可用' }) : route.continue());
      await page.route('**/api/action', async route => {
        const action = route.request().postDataJSON();
        if (action.kind === `${kind}-pause` && mode === 'pause-unknown') {
          await route.fetch(); blockReadback = true; return route.abort('failed');
        }
        if (action.kind === `${kind}-pause` && mode === 'pause-rejected') return route.fulfill({
          status: 409, contentType: 'application/json', body: JSON.stringify({ error: '受控拒绝，暂停未保存' }) });
        if (action.kind !== `${kind}-step`) return route.continue();
        stepRequests++;
        assert.equal(held, false, 'a second automatic pulse overlapped the held request');
        const response = mode === 'rejected' ? null : await route.fetch();
        if (mode === 'finish' && !(await response.json()).state.game[kind].end) return route.fulfill({ response });
        held = true;
        await gate;
        if (mode === 'unknown') { blockReadback = true; await route.abort('failed'); }
        else if (mode === 'rejected') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '受控拒绝，步进未保存' }) });
        else await route.fulfill({ response });
      });
      await page.goto(base); await page.locator(`.${kind}-game`).waitFor();
      await page.locator('.button-c').tap();
      const deadline = Date.now() + (mode === 'finish' ? 180000 : 10000);
      while (!held && Date.now() < deadline) await wait(20);
      assert(held, 'automatic pulse did not reach the controlled response gate');
      await page.locator('.button-b:disabled').waitFor();
      assert(await page.locator('.button-a').isDisabled());
      assert(await page.locator('.button-c').isEnabled(), 'C should accept a pause while the automatic pulse is held');
      await page.locator('.button-c').tap(); await page.locator(`.${kind}-overlay`).waitFor();
      assert(await page.locator('.button-c').isDisabled(), 'a second C must not toggle the queued pause');
      assert.equal(writes.filter(a => a.kind === `${kind}-pause`).length, 0, 'pause raced the in-flight step');
      const expectedSteps = mode === 'finish' ? stepRequests : 1;
      await wait(250); assert.equal(writes.filter(a => a.kind === `${kind}-step`).length, expectedSteps);
      if (mode === 'help') {
        await page.getByRole('button', { name: '玩法说明' }).click();
        await page.getByRole('dialog').waitFor();
      }
      if (mode === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (mode === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const before = (await api('state')).state;
      const expectedStep = (kind === 'tetris' ? 1 : 0) + (mode === 'rejected' ? 0 : expectedSteps);
      assert.equal(before.game[kind].step, expectedStep);
      if (mode === 'finish') assert(before.game[kind].end, 'real backend must end the board');
      release();
      await page.locator('.button-b:not(:disabled)').waitFor();
      if (mode === 'help') await page.getByRole('button', { name: '关闭', exact: true }).click();
      if (mode === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      if (mode === 'unknown' || mode === 'pause-unknown') {
        // Require an explicit readback while the save result is unknown.
        await page.locator('.save-recovery').waitFor();
        blockReadback = false;
        await page.locator('.button-b').tap();
      }
      const stopped = `.${kind}-overlay`;
      await page.locator(stopped).waitFor();
      await wait(1500);
      const after = (await api('state')).state;
      const expectedPauses = ['acknowledged', 'pause-unknown', 'pause-rejected'].includes(mode) ? 1 : 0;
      assert.equal(writes.filter(a => a.kind === `${kind}-step`).length, expectedSteps);
      assert.equal(writes.filter(a => a.kind === `${kind}-pause`).length, expectedPauses);
      assert.equal(writes.filter(a => a.kind === `${kind}-resume`).length, 1);
      assert.equal(writes.filter(a => a.kind === `${kind}-finish`).length, 0);
      assert.equal(after.game[kind].step, expectedStep + (kind === 'tetris' && expectedPauses === 1 && mode !== 'pause-rejected' ? 1 : 0));
      if (expectedPauses) {
        const pause = writes.find(a => a.kind === `${kind}-pause`);
        assert.equal(pause.step, before.game[kind].step);
        assert.equal(pause.gameId, before.game.id);
      }
      if (mode === 'acknowledged' || mode === 'pause-unknown') assert.equal(after.game[kind].paused, true);
      await page.reload(); await page.locator(stopped).waitFor();
      await wait(1200);
      assert.equal(writes.filter(a => a.kind === `${kind}-step`).length, expectedSteps, 'reload resumed the route');
      assert.equal(writes.filter(a => a.kind === `${kind}-pause`).length, expectedPauses, 'readback replayed pause');
      assert.equal(writes.filter(a => a.kind === `${kind}-resume`).length, 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
      assert.equal(after.careCount, 0); assert.equal(after.economy.coins, 0);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(dir, tag + '.png'), fullPage: true });
      if (mode === 'finish') {
        await page.locator('.button-b').tap(); await page.locator('.content-home').waitFor();
        const collected = (await api('state')).state;
        assert.equal(writes.filter(a => a.kind === `${kind}-finish`).length, 1);
        const count = kind === 'snake' ? after.game.snake.eaten : after.game.tetris.lines;
        const rewarded = count >= (kind === 'snake' ? 3 : 2);
        assert.equal(collected.careCount, rewarded ? 1 : 0);
        assert.equal(collected.economy.coins, rewarded ? Math.min(count, 6) : 0);
        await page.reload(); await page.locator('.content-home').waitFor();
        assert.equal(writes.filter(a => a.kind === `${kind}-finish`).length, 1);
        assert.equal((await api('state')).state.careCount, rewarded ? 1 : 0);
      }
      results.push({ width, kind, mode, writes, board: after.game[kind] });
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
