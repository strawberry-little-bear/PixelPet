// Read-only sleep guidance + explicit wake/bed flow, on an isolated Go service.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-sleep-home-')), results = [];
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
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function seed(stage, needs) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const result = await api('import', { schema: 1, revision: 1, species: 2, name: '休息中的小伙伴',
    createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: true, careCount: 0, logs: [],
    needs: { hunger: 80, clean: 80, mood: 80, energy: 40, ...needs } });
  assert.equal(result.state.growth.stage, stage); return result.state;
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function bedtime(page) {
  for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
  assert.equal(await page.locator('.care-preview').getAttribute('data-care-preview'), 'sleep');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action');
  await key(page, 'B'); const result = await (await response).json();
  await page.locator('.home-caption').waitFor(); return result.state;
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const panel = page.locator('.sleep-home-guidance');
  const issues = await panel.evaluate(el => {
    const issues = [], area = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) issues.push(node.textContent);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY) && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) issues.push(`clipped: ${node.textContent}`);
        }
      }
    }
    return issues;
  });
  assert.deepEqual(issues, [], 'Sleep advice clipped or overlaps footer');
  await panel.locator('p').scrollIntoViewIfNeeded();
  assert(await panel.locator('p').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }), 'Advice cannot be scrolled into view');
  for (const button of await page.locator('.physical-button').all()) {
    await button.scrollIntoViewIfNeeded();
    assert(await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.top >= -1 && r.bottom <= innerHeight + 1; }), 'Physical key unreachable');
  }
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await panel.locator('[aria-live],[role=status],[role=alert]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_WEB: web,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_ADDR: `127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', error => { startupError = error; });
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, font: 14 }, { width: 320, font: 14 }, { width: 320, font: 28 }];
  for (const mode of modes) for (const stage of ['baby', 'growing', 'adult']) {
    const context = await browser.newContext({ viewport: { width: mode.width, height: 700 }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('requestfailed', request => errors.push(`Failed: ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    page.on('request', r => { if (r.method() !== 'GET' && !new URL(r.url()).pathname.endsWith('/api/visit')) writes.push(r.postDataJSON()?.kind ?? r.url()); });
    const label = `${mode.width}-${mode.font}-${stage}`;
    try {
      for (const scenario of [
        { name: 'resting', needs: {}, text: '不必急着叫醒' },
        { name: 'full', needs: { energy: 100 }, text: '体力已满' },
        { name: 'hungry', needs: { hunger: 10 }, text: '醒来后优先吃点东西' },
        { name: 'dirty', needs: { hunger: 20, clean: 10 }, text: '醒来后优先洗澡' },
      ]) {
        const before = await seed(stage, scenario.needs), count = writes.length;
        await page.goto(base); const panel = page.locator('.sleep-home-guidance'); await panel.waitFor();
        assert((await panel.innerText()).includes(scenario.text));
        assert.equal(await page.locator('.pet-scene').getAttribute('data-motion'), 'sleeping');
        assert.equal(await page.locator('.pet-scene').getAttribute('data-need'), 'none');
        assert(await panel.locator('p').evaluate((el, font) => parseFloat(getComputedStyle(el).fontSize) >= font * .85, mode.font));
        await readable(page);
        const y = await page.evaluate(() => scrollY);
        const focusedKey = await page.evaluate(() => [...document.querySelectorAll('.physical-button')].indexOf(document.activeElement));
        const synced = page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await synced;
        await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
        assert.equal(await page.evaluate(() => scrollY), y, 'Reading stole scroll position');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.physical-button')].indexOf(document.activeElement)), focusedKey, 'Reading stole native key focus');
        await page.reload(); await panel.waitFor(); assert((await panel.innerText()).includes(scenario.text));
        assert.equal(writes.length, count, 'Reading or reload wrote an action');
        const after = (await api('state')).state;
        for (const field of ['careCount', 'sleeping', 'logs', 'economy', 'album']) assert.deepEqual(after[field], before[field], `Read changed ${field}`);
        assert.equal(after.growth.stage, before.growth.stage); assert.equal(after.growth.form, before.growth.form);
        if (stage === 'baby' && scenario.name === 'dirty') await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
        results.push({ ...mode, stage, scenario: scenario.name, passed: true });
      }
      const wake = await bedtime(page); assert.equal(wake.sleeping, false);
      assert.equal(await page.locator('.sleep-home-guidance').count(), 0);
      const bed = await bedtime(page); assert.equal(bed.sleeping, true);
      await page.locator('.sleep-home-guidance').waitFor();
      assert.match(await page.locator('.sleep-home-guidance').innerText(), /醒来后优先洗澡/);
      assert.equal(await page.locator('.growth-feedback').getAttribute('data-feedback'), 'resting', 'Bedtime feedback fixture was not exercised');
      await readable(page); assert.deepEqual(writes, ['sleep', 'sleep']); assert.deepEqual(errors, []);
      results.push({ ...mode, stage, scenario: 'explicit-wake-bed', passed: true });
    } catch (error) { await page.screenshot({ path: join(dir, `${label}-failure.png`), fullPage: true }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
