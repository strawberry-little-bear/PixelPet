// Ordinary successful care notices must not float over long reading or A/B/C.
// Uses migrated stage fixtures and a paused browser clock, not natural endurance.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-reading-notices-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }); assert(r.ok, `${path}: ${await r.clone().text()}`); return r.json();
}
async function key(page, k) {
  await page.locator(`.button-${k}:not(:disabled)`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function unobscured(page, label) {
  const metrics = [];
  for (const target of await page.locator('.sleep-home-guidance p,.care-outcome-reading p,.care-reading-hint,.lcd-bottom,.physical-button').all()) {
    await target.evaluate(el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
    const metric = await target.evaluate(el => {
      const t = document.querySelector('.toast').getBoundingClientRect(), ranges = [];
      if (el.matches('.physical-button')) ranges.push(el.getBoundingClientRect());
      else {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const r = document.createRange(); r.selectNodeContents(walker.currentNode); ranges.push(...r.getClientRects()); }
      }
      const visible = ranges.filter(r => r.width && r.height && r.top < innerHeight && r.bottom > 0);
      return { text: el.textContent, visible: visible.length, hidden: visible.filter(r =>
        r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top).length,
        toastPosition: getComputedStyle(document.querySelector('.toast')).position };
    });
    assert(metric.visible > 0, 'Must actually show target when checking overlap');
    if (metric.hidden) await page.screenshot({ path: join(dir, `${label}-overlap.png`) });
    assert.equal(metric.hidden, 0, JSON.stringify(metric)); metrics.push(metric);
  }
  assert(metrics.length >= 4, 'Must cover reading and keys');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const notice = page.getByRole('status').filter({ has: page.getByRole('button', { name: '关闭提示' }) });
  assert.equal(await notice.count(), 1);
  assert.equal(await notice.evaluate(el => getComputedStyle(el).position), 'static');
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
  await notice.scrollIntoViewIfNeeded();
  const fits = await notice.evaluate(el => {
    const b = el.getBoundingClientRect(), text = el.querySelector('span'), r = document.createRange(); r.selectNodeContents(text);
    return [...r.getClientRects()].every(r => r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom);
  }); assert(fits, 'Notice text must fit without clipping');
  if (label.includes('-baby-')) await page.screenshot({ path: join(dir, `${label}-notice.png`) });
  return metrics;
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_WEB: web,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_ADDR: `127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const modes = [{ width: 320, height: 380, font: 28 }, { width: 320, height: 700, font: 14 },
    { width: 390, height: 844, font: 28 }, { width: 1200, height: 700, font: 14 }];
  for (const mode of modes) for (const stage of ['baby', 'growing', 'adult']) for (const care of stage === 'baby' ? ['sleep', 'feed'] : ['sleep']) {
    const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
    const seeded = (await api('import', { schema: 1, revision: 1, species: 2, name: '照顾结果慢慢读',
      createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false, careCount: 0, logs: [],
      needs: { hunger: 10, clean: 10, mood: 80, energy: 40 } })).state;
    assert.equal(seeded.growth.stage, stage);
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, hasTouch: true,
      isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.font === 28 ? 'active' : 'none' });
    const label = `${mode.width}-${mode.height}-${mode.font}-${stage}-${care}`;
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      const page = await context.newPage(), errors = [], writes = [];
      await page.clock.install(); await page.clock.pauseAt(new Date());
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (['/api/action', '/api/import', '/api/reset', '/api/recap/read'].includes(new URL(r.url()).pathname)) writes.push(r.url()); });
      await page.goto(base); await page.locator('.home-caption').waitFor();
      for (let i = 0; i < (care === 'sleep' ? 4 : 1); i++) await key(page, 'a');
      assert.equal(await page.locator('.care-preview').getAttribute('data-care-preview'), care);
      if (care === 'feed') {
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action');
        await page.locator('.button-b:not(:disabled)').tap(); await response;
        await key(page, 'c'); // Explicitly skip only the care animation.
      } else await key(page, 'b');
      await page.locator(care === 'sleep' ? '.sleep-home-guidance' : '.care-outcome-reading').waitFor();
      assert.equal(writes.length, 1);
      const metrics = await unobscured(page, label);
      if (stage === 'baby') {
        await page.locator('.care-reading-hint').first().evaluate(el => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await page.screenshot({ path: join(dir, `${label}-reading.png`) });
      }
      const expiryFocus = page.locator(care === 'sleep' ? '.sleep-home-guidance' : '.button-a');
      await expiryFocus.focus();
      if (care === 'sleep') await expiryFocus.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const y = await page.evaluate(() => scrollY);
      const geometry = await page.locator('.device').evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height }));
      const beforeExpiry = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight,
        focused: document.activeElement?.getBoundingClientRect().toJSON(), toast: document.querySelector('.toast').getBoundingClientRect().toJSON() }));
      await page.clock.runFor(4300); // Exercise actual notice expiry, not removal by script.
      assert.equal(await page.locator('.toast').count(), 0);
      const afterY = await page.evaluate(() => scrollY);
      const afterMax = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      // Removing a below-device notice can shorten the document. At its very
      // end, native scroll clamping is expected; no script may jump elsewhere.
      const expectedY = Math.min(y, afterMax);
      if (afterY !== expectedY) {
        await page.screenshot({ path: join(dir, `${label}-expiry-failure.png`) });
        await writeFile(join(dir, `${label}-expiry-failure.json`), JSON.stringify({ beforeExpiry, afterY, geometry,
          afterGeometry: await page.locator('.device').evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height })) }, null, 2));
      }
      assert.equal(afterY, expectedY, `${label}: expiry moved reading beyond native end clamping`);
      assert(await expiryFocus.evaluate(el => document.activeElement === el));
      assert.deepEqual(await page.locator('.device').evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.getBoundingClientRect().height })), geometry);
      assert.equal(writes.length, 1); assert.deepEqual(errors, []);
      const after = (await api('state')).state;
      assert.equal(after.careCount, seeded.careCount + (care === 'feed' ? 1 : 0));
      assert.equal(after.sleeping, care === 'sleep');
      assert.equal(after.economy.coins, seeded.economy.coins);
      if (stage === 'baby') await page.screenshot({ path: join(dir, `${label}-after-expiry.png`), fullPage: true });
      results.push({ mode, stage, care, metrics, expiry: { beforeY: y, afterY, afterMax, clamped: afterY !== y } });
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
