// Saved-stage home voices, not simulated growth journeys or human playtests.
// All writes/fixtures are confined to a disposable DB and random-port server.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeVoice } from '../web/src/homeVoice.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
assert.equal(process.argv.length, 2, 'No player URL or database arguments');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-home-voice-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, currentPage, log = '', startupError;
async function api(path, body) {
  const res = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, `${path}: ${await res.clone().text()}`); return res.json();
}
async function seed(species, stage, needs = {}) {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const r = await api('import', { schema: 1, revision: 1, species, name: '小窝阶段伙伴', createdAt: now - age,
    hatchedAt: now - age, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80, ...needs } });
  assert.equal(r.state.growth.stage, stage); return r.state;
}
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function readable(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  const issues = await page.locator('.growth-feedback').evaluate(el => {
    const issues = [], area = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > Math.min(area.bottom, footer.top) + 1) issues.push(text.textContent);
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) issues.push('clipped: ' + text.textContent);
        }
      }
    }
    return issues;
  });
  assert.deepEqual(issues, [], 'home text clipped or overlaps footer');
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
}
function unchanged(before, after) {
  for (const field of ['species', 'hatchedAt', 'careCount', 'game', 'economy', 'album', 'logs']) assert.deepEqual(after[field], before[field], `read changed ${field}`);
  assert.deepEqual(after.growth.care, before.growth.care, 'read changed habits');
  assert.equal(after.growth.stage, before.growth.stage); assert.equal(after.growth.form, before.growth.form);
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
  for (const mode of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    const context = await browser.newContext({ viewport: { width: mode.width, height: 700 }, hasTouch: true,
      isMobile: mode.width === 320, reducedMotion: 'reduce', forcedColors: mode.width === 320 ? 'active' : 'none' });
    await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
    const page = currentPage = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() !== 'GET' && !new URL(r.url()).pathname.endsWith('/api/visit')) writes.push(r.postDataJSON()?.kind ?? r.url()); });
    for (let species = 0; species < 10; species++) for (const stage of ['baby', 'growing', 'adult']) {
      for (const kind of ['content', 'quiet']) {
        const label = `${mode.width}-${species}-${stage}-${kind}`;
        const before = await seed(species, stage, kind === 'quiet' ? { mood: 60, energy: 44 } : {});
        const count = writes.length, voice = homeVoice(species, stage, kind, before.growth.form);
        await page.goto(base); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.growth-feedback strong').innerText(), voice, label);
        assert(await page.locator(`.gesture-${kind}`).count() > 0, 'existing calm gesture missing');
        assert.equal(await page.locator('.growth-feedback').getAttribute('data-feedback'), 'idle');
        assert.equal(await page.locator('.growth-feedback').getAttribute('role'), null, 'static voice announced as a new event');
        await readable(page);
        await key(page, 'A'); await page.locator('.care-menu').waitFor();
        assert.match(await page.locator('.care-menu-advice').innerText(), kind === 'quiet' ? /可以安静陪伴/ : /现在很舒适/);
        await key(page, 'C'); assert.equal(await page.locator('.growth-feedback strong').innerText(), voice);
        const synced = page.waitForResponse(r => new URL(r.url()).pathname === '/api/visit');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await synced;
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.growth-feedback strong').innerText(), voice, 'reload changed present voice');
        assert.equal(writes.length, count); unchanged(before, (await api('state')).state);
        if ([1, 2, 3, 4, 8].includes(species) && kind === 'content') await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
        results.push({ label, voice, passed: true });
      }
    }
    // Legal migrated adult fixtures, not naturally raised four-form journeys.
    // Only the saved form/card are varied; neutral old evidence stays absent.
    for (const form of ['balanced', 'lively', 'gentle', 'easygoing']) {
      const fixture = await seed(2, 'adult');
      assert(!fixture.growth.formRecord, 'fixture unexpectedly has frozen evidence');
      fixture.growth.form = form;
      fixture.album.entries.find(m => m.kind === 'adult').form = form;
      const before = (await api('import', fixture)).state;
      const label = `${mode.width}-adult-${form}`, voice = homeVoice(2, 'adult', 'content', form);
      const count = writes.length;
      await page.goto(base); await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.growth-feedback strong').innerText(), voice, label);
      assert.equal(await page.locator('.growth-feedback').getAttribute('role'), null);
      await readable(page);
      await key(page, 'A'); await page.locator('.care-menu').waitFor();
      assert.match(await page.locator('.care-menu-advice').innerText(), /现在很舒适/);
      await key(page, 'C');
      assert.equal(await page.locator('.growth-feedback strong').innerText(), voice);
      await page.reload(); await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.growth-feedback strong').innerText(), voice);
      assert.equal(writes.length, count, 'voice or navigation wrote an action');
      unchanged(before, (await api('state')).state);
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      results.push({ label, voice, passed: true });
    }
    for (const stage of ['baby', 'growing', 'adult']) {
      const label = `${mode.width}-${stage}-care-sleep-game`, before = await seed(2, stage, { hunger: 50 });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      assert.match(await page.locator('.growth-feedback strong').innerText(), /想吃点东西/);
      const count = writes.length;
      for (const k of ['A', 'B']) await key(page, k);
      await page.locator('.care-outcome').waitFor();
      assert.match(await page.locator('.growth-feedback strong').innerText(), /喂食习惯/);
      await page.waitForFunction(expected => document.querySelector('.growth-feedback strong')?.textContent === expected,
        homeVoice(2, stage, 'content', before.growth.form), { timeout: 12000 });
      await readable(page);
      const after = (await api('state')).state;
      assert.equal(after.careCount, before.careCount + 1);
      assert.equal(after.growth.care.nutrition, before.growth.care.nutrition + 1);
      assert.equal(after.economy.coins, before.economy.coins);
      assert.equal(after.growth.form, before.growth.form);
      assert.deepEqual(writes.slice(count), ['feed'], 'voice made an additional gameplay write');
      // The following sleep/game actions are explicit isolated-server fixtures.
      await api('action', { kind: 'sleep' }); await page.reload(); await page.locator('.home-caption').waitFor();
      assert.equal(await page.locator('.pet-scene').getAttribute('data-motion'), 'sleeping');
      assert.match(await page.locator('.growth-feedback strong').innerText(), /正在做一个甜甜的梦/);
      await api('action', { kind: 'sleep' }); await api('action', { kind: 'play-treasure' });
      await page.reload(); await page.locator('.treasure-game').waitFor();
      assert.equal(await page.locator('.growth-feedback').count(), 0);
      assert.deepEqual(writes.slice(count), ['feed']); results.push({ label, passed: true });
    }
    assert.deepEqual(errors, []); await context.close();
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
  throw error;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
  await writeFile(join(dir, 'server.log'), log); console.log('Artifacts:', dir);
}
