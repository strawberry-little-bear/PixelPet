// Native return reading with real Go recap/acknowledgement on an isolated DB.
// Stage migration and a past presence baseline are constructed, not natural aging.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-return-viewport-')), db = join(dir, 'test.db'), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function key(page, k) { await page.locator(`.button-${k.toLowerCase()}:not(:disabled)`).tap(); }
async function focusedKey(page) { return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null); }
async function visibleHeader(page) {
  await wait(100);
  const box = await page.locator('.return-panel > header').boundingBox(), height = await page.evaluate(() => innerHeight);
  assert(box && box.y >= -1 && box.y + box.height <= height + 1, `return header outside native viewport: ${JSON.stringify(box)}`);
}
async function review(page) {
  await key(page, 'A'); for (let i = 0; i < 7; i++) await key(page, 'A'); await key(page, 'B');
  await page.locator('.return-panel').waitFor(); await visibleHeader(page);
}
async function geometry(page) { return page.evaluate(() => Object.fromEntries(['.device', '.screen-bezel', '.lcd', '.lcd-content'].map(s => [s, document.querySelector(s).getBoundingClientRect().height]))); }
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow');
  const problems = await page.locator('.return-panel').evaluate(el => {
    const area = el.getBoundingClientRect(), problems = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) if (box.width && box.height && (box.left < area.left - 1 || box.right > area.right + 1)) problems.push(text.textContent);
    }
    return problems;
  });
  assert.deepEqual(problems, [], 'return text horizontally clipped');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: db, PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 1200, height: 700, font: 14 }, { width: 320, height: 700, font: 28 }, { width: 320, height: 380, font: 28 }];
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const mode of modes) {
    const at = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    await api('import', { schema: 1, revision: 1, species: 2, name: '回访稳稳读', createdAt: at - age, hatchedAt: at - age, lastTick: at,
      sleeping, needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [] });
    await api('visit', {});
    // Only this newly-created DB: leave saves.lastTick and baseline intact.
    execFileSync(process.env.PIXELPET_PYTHON || '/usr/bin/python3', ['-c',
      'import sqlite3,sys; c=sqlite3.connect(sys.argv[1],timeout=10); c.execute("UPDATE visits SET last_seen=? WHERE id=1",(int(sys.argv[2]),)); c.commit(); c.close()', db, String(at - 2 * 3600000)]);
    const arrival = await api('visit', {}), before = arrival.state;
    assert.equal(before.growth.stage, stage); assert(arrival.returnRecap && arrival.recapPending);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true, isMobile: mode.width < 700,
      reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = []; let reads = 0;
    const label = `${stage}-${sleeping}-${mode.width}-${mode.height}`, capture = stage === 'baby' && !sleeping || stage === 'adult' && sleeping;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (req.method() !== 'GET' && !['/api/state', '/api/visit'].includes(new URL(req.url()).pathname)) writes.push(new URL(req.url()).pathname); });
    page.on('response', async res => { if (['/api/state', '/api/visit'].includes(new URL(res.url()).pathname)) { await res.finished(); reads++; } });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    async function syncWithoutJump() {
      const position = await page.evaluate(() => {
        window.__returnSyncFocus = document.activeElement;
        return { outer: scrollY, inner: document.querySelector('.return-panel').scrollTop };
      }), prior = reads;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      for (let i = 0; i < 100 && reads === prior; i++) await wait(20);
      assert(reads > prior, 'read not completed'); await wait(100);
      assert.deepEqual(await page.evaluate(() => ({ outer: scrollY, inner: document.querySelector('.return-panel').scrollTop })), position, 'sync changed reading position');
      assert(await page.evaluate(() => document.activeElement === window.__returnSyncFocus), 'sync changed reading focus');
    }
    try {
      await page.goto(base);
      if (!sleeping) {
        await page.locator('.return-panel').waitFor(); await visibleHeader(page);
        assert.equal(await page.locator('.return-panel header span').innerText(), '1 / 2');
        await page.evaluate(() => scrollBy({ top: 90, behavior: 'instant' })); await syncWithoutJump();
        await key(page, 'C');
      }
      await page.locator('.home-caption').waitFor(); const preference = await page.evaluate(() => JSON.stringify(localStorage));
      await review(page); const size = await geometry(page);
      for (let n = 0; n < 4; n++) {
        const panel = page.locator('.return-panel');
        assert.equal(await panel.locator('header span').innerText(), `${n % 2 + 1} / 2`);
        await visibleHeader(page); assert.equal(await panel.evaluate(el => el.scrollTop), 0);
        await readable(page); assert.deepEqual(await geometry(page), size, 'turning pages changed device height');
        if (capture && n < 2) { await page.screenshot({ path: join(dir, `visible-${label}-${n}.png`) }); await visibleHeader(page); }
        const focused = await focusedKey(page);
        await page.evaluate(() => { scrollBy({ top: 90, behavior: 'instant' }); document.querySelector('.return-panel').scrollTop = 70; });
        await syncWithoutJump(); assert.equal(await focusedKey(page), focused);
        await panel.focus(); await page.keyboard.press('End');
        await page.waitForFunction(() => { const el = document.querySelector('.return-panel'); return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2; });
        await wait(150);
        assert(await panel.evaluate(el => { const area = el.getBoundingClientRect(), last = (el.lastElementChild.lastElementChild ?? el.lastElementChild).getBoundingClientRect(); return last.bottom <= Math.min(area.bottom, innerHeight) + 1 && last.top >= Math.max(0, el.querySelector('header').getBoundingClientRect().bottom) - 1; }), 'bottom care guidance not reachable');
        if (capture && n < 2) {
          await page.screenshot({ path: join(dir, `bottom-${label}-${n}.png`) });
          await page.screenshot({ path: join(dir, `full-${label}-${n}.png`), fullPage: true });
        }
        await key(page, n === 0 ? 'B' : 'A');
      }
      assert.equal(await page.locator('.return-panel header span').innerText(), '1 / 2'); await visibleHeader(page);
      assert.equal(await focusedKey(page), 'a');
      for (const [index, native] of ['Enter', 'Space'].entries()) {
        await page.keyboard.press(native); await visibleHeader(page);
        assert.equal(await page.locator('.return-panel header span').innerText(), `${(index + 1) % 2 + 1} / 2`, 'native key flipped more than once');
        assert.equal(await focusedKey(page), 'a');
      }
      // Native panel navigation keeps focus on the remounted scroll container.
      await page.locator('.return-panel').focus(); await page.keyboard.press('a'); await visibleHeader(page);
      assert(await page.locator('.return-panel').evaluate(el => document.activeElement === el && el.scrollTop === 0));
      await page.keyboard.press('b'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(writes, sleeping ? [] : ['/api/recap/read']); assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), preference);
      const after = await api('state'); assert.deepEqual(after.returnRecap, arrival.returnRecap); assert.equal(after.recapPending, sleeping);
      for (const field of ['species', 'hatchedAt', 'sleeping', 'careCount', 'economy', 'game']) assert.deepEqual(after.state[field], before[field]);
      assert.equal(after.state.growth.stage, stage); assert.equal(after.state.growth.form, before.growth.form);
      results.push({ type: 'real-http-recap-with-constructed-presence-baseline', stage, sleeping, ...mode, acknowledged: !sleeping });
    } catch (e) { await page.screenshot({ path: join(dir, `failure-${label}.png`) }); throw e; }
    finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  console.error('Artifacts:', dir); if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
