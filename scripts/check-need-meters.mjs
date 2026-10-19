// Real Chrome, isolated database/port only. Does not contact a player's service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY.');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB to an isolated build.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-need-meters-'));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function check(page, selector, snapshot) {
  const meters = page.locator(`${selector} [role=meter]`); assert.equal(await meters.count(), 4);
  for (const [field, label] of [['hunger', '饱食'], ['mood', '心情'], ['clean', '清洁'], ['energy', '体力']]) {
    const meter = page.locator(selector).getByRole('meter', { name: label, exact: true });
    assert.equal(Number(await meter.getAttribute('aria-valuenow')), snapshot.needs[field]);
    assert.equal(await meter.getAttribute('aria-valuemin'), '0'); assert.equal(await meter.getAttribute('aria-valuemax'), '100');
    assert.equal(await meter.getAttribute('aria-valuetext'), `${Number.isInteger(snapshot.needs[field]) ? '' : '约 '}${Math.round(snapshot.needs[field])} / 100`);
    assert((await meter.ariaSnapshot()).includes(`meter "${label}"`));
    assert.equal(await meter.getAttribute('tabindex'), null); assert.equal(await meter.getAttribute('aria-live'), null);
    assert(Math.abs(await meter.locator('i').evaluate(el => parseFloat(el.style.width)) - snapshot.needs[field]) < .0001);
  }
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) for (const mode of ['normal', 'large', 'contrast']) {
    const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    const response = await fetch(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: 1, revision: 1, species: 2, name: '需求伙伴', createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping, needs: { hunger: 0, mood: 100, clean: 49.6, energy: .4 }, careCount: 0, logs: [] }) });
    assert(response.ok, await response.text());
    const ctx = await browser.newContext({ viewport: { width: mode === 'normal' ? 390 : 320, height: 568 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', forcedColors: mode === 'contrast' ? 'active' : 'none' });
    try {
      await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode === 'normal' ? 14 : 28);
      const page = await ctx.newPage(), writes = [], errors = []; let snapshot;
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname !== '/api/visit') writes.push(new URL(r.url()).pathname); });
      await page.route(/\/api\/(state|visit)$/, async route => { const reply = await route.fetch(); const json = await reply.json(); snapshot = json.state; await route.fulfill({ response: reply, json }); });
      await page.clock.install(); await page.goto(base); await page.locator('.home-caption').waitFor();
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
      assert.equal(snapshot.growth.stage, stage); await check(page, '.outside-needs', snapshot);
      await key(page, 'a'); for (let i = 0; i < 4; i++) await key(page, 'a'); await key(page, 'b');
      await check(page, '.screen-status', snapshot); await check(page, '.outside-needs', snapshot);
      assert.equal(await page.getByRole('meter').count(), 8);
      const description = await page.locator('#need-reading-description').innerText(); assert(description.includes('最近读取') && description.includes('越高越舒适'));
      const before = await page.locator('.screen-status').innerText(); await page.clock.runFor(10000); assert.equal(await page.locator('.screen-status').innerText(), before);
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, minKey: Math.min(...[...document.querySelectorAll('.physical-button')].map(e => Math.min(e.offsetWidth, e.offsetHeight))), meters: [...document.querySelectorAll('.screen-status [role=meter]')].every(e => e.getBoundingClientRect().width > 0) }));
      assert.equal(layout.overflow, false); assert(layout.minKey >= 44 && layout.meters);
      assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button],[role=slider]').count(), 0);
      if (stage === 'baby' && !sleeping) await page.screenshot({ path: join(dir, `need-meters-${mode}.png`), fullPage: true });
      await key(page, 'a'); assert.equal(await page.getByRole('meter').count(), 4); await key(page, 'c'); await page.locator('.home-caption').waitFor();
      assert.deepEqual(writes, []); assert.deepEqual(errors, []); results.push({ stage, sleeping, mode, ...layout });
    } finally { await ctx.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ groups: results.length, port, artifacts: dir }));
} finally {
  if (browser) await browser.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  await writeFile(join(dir, 'server.log'), log);
}
