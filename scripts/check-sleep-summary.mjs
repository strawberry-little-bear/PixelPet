// Real Chrome + HTTP/SQLite on a private port/database/build only.
// Short real sleeps test accumulation; simulated hour/cap boundaries live in Go tests.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
console.log(JSON.stringify({ testBuilds: { binary, web } }));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-sleep-summary-'));
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms)), results = [];
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(base + '/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(r.ok, await r.clone().text()); return r.json();
}
async function seed(stage, full) {
  const now = Date.now(), age = ({ baby: 1, growing: 25, adult: 80 }[stage]) * 3600000;
  return api('import', { schema: 1, revision: 1, species: 2, name: '好梦伙伴', createdAt: now - age, hatchedAt: now - age,
    lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 90, energy: full ? 100 : 40 }, careCount: 0, logs: [] });
}
async function key(page, name) {
  await page.locator('.button-' + name.toLowerCase()).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function sleep(page) {
  for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
  const reply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
  await key(page, 'B'); const r = await reply; assert(r.ok());
  const result = await r.json(); await key(page, 'C'); return result;
}
// Read saved text using only the established A/B/C journal navigation. This
// does not reconstruct the response receipt or infer a past sleep from totals.
async function diary(page, entry, label) {
  await key(page, 'A'); for (let i = 0; i < 5; i++) await key(page, 'A');
  await key(page, 'B'); await page.locator('.screen-journal').waitFor();
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.screen-journal > p').innerText() === entry.text) break;
    await key(page, 'A');
  }
  assert.equal(await page.locator('.screen-journal > p').innerText(), entry.text);
  assert.equal(await page.locator('.screen-journal > time').getAttribute('datetime'), new Date(entry.at).toISOString());
  assert((await page.locator('.journal-note').innerText()).includes('最近 30 条'));
  await readable(page, '.screen-journal');
  await page.screenshot({ path: join(dir, `diary-${label}.png`), fullPage: true });
  await key(page, 'C'); await page.locator('.content-home').waitFor();
}
async function readable(page, selector = '.sleep-summary') {
  const panel = page.locator(selector);
  const issues = await panel.evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(node.textContent);
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'Sleep summary clipped or trapped');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  const tail = panel.locator(':scope > small');
  const end = await tail.count() ? tail.last() : panel;
  await end.scrollIntoViewIfNeeded();
  assert(await end.evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1;
  }), 'End of sleep summary cannot be reached');
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
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const stage of ['baby', 'growing', 'adult']) {
      const initial = await seed(stage, stage === 'adult');
      assert.equal(initial.state.growth.stage, stage);
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor();
        const bed = await sleep(page); assert(bed.state.sleeping); assert(bed.state.sleepSession); assert(!bed.careFeedback.sleepSummary);
        await wait(1000); const first = await api('visit', {}); assert(first.state.sleepSession.settledHours > 0);
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.sleep-summary').count(), 0, 'Reload invented completed sleep');
        await wait(1000); const second = await api('visit', {});
        assert(second.state.sleepSession.settledHours > first.state.sleepSession.settledHours);
        const wake = await sleep(page), summary = wake.careFeedback.sleepSummary;
        assert(summary); assert(!wake.state.sleeping); assert(!wake.state.sleepSession);
        assert.equal(summary.startedAt, bed.state.sleepSession.startedAt);
        assert.equal(summary.wokeAt, wake.careFeedback.effect.at);
        assert.equal(wake.careFeedback.points, 0); assert.equal(wake.careFeedback.habitGain, 0);
        assert.deepEqual(wake.careFeedback.effect.before, wake.careFeedback.effect.after);
        const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
        close(summary.settledHours, (summary.wokeAt - summary.startedAt) / 3600000);
        close(summary.energyRecovered, wake.state.needs.energy - bed.state.needs.energy);
        close(summary.restGain, wake.state.growth.care.rest - bed.state.growth.care.rest);
        close(summary.growthPoints, wake.state.growth.points - bed.state.growth.points);
        if (stage !== 'adult') assert(summary.energyRecovered > second.state.sleepSession.energyRecovered);
        else { assert.equal(summary.growthPoints, 0); assert.equal(wake.state.growth.form, initial.state.growth.form); }
        await page.locator('.sleep-summary').waitFor(); await readable(page);
        assert(await page.locator('.sleep-summary').evaluate((el, font) => parseFloat(getComputedStyle(el).fontSize) >= font * .85, font));
        const text = await page.locator('.sleep-summary').textContent();
        // Another page's ordinary action changes the pet, not this acknowledgement.
        await api('action', { kind: 'sleep', requestId: `other-page-${width}-${stage}` });
        await api('visit', {}); await wait(16000);
        assert.equal(await page.locator('.sleep-summary').textContent(), text);
        assert.equal(writes.length, 2, 'Reading repeated a wake');
        await readable(page);
        await page.locator('.sleep-summary').screenshot({ path: join(dir, `sleep-${width}-${stage}.png`) });
        await page.screenshot({ path: join(dir, `sleep-${width}-${stage}-viewport.png`) });
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.sleep-summary').count(), 0, 'Reload rebuilt old receipt from state');
        const entry = wake.state.logs[0];
        assert(entry.text.includes('本段休息') && entry.text.includes('非起床奖励'));
        await diary(page, entry, `${width}-${stage}`);
        assert.equal(writes.length, 2, 'Journal repeated care');
        assert.deepEqual(errors, []); results.push({ width, font, stage, summary, diaryAfterReload: true, passed: true });
      } finally { await context.close(); }
    }
  }
  // Response-shaped fixtures only: these prove the long-duration text/layout,
  // not natural day-long sleeps. Go controlled-clock tests prove real capping.
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const settledHours of [12, 24]) {
      await seed('baby', false);
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor(); await sleep(page);
        await page.route('**/api/action', async route => {
          const response = await route.fetch(), body = await response.json();
          if (body.careFeedback?.reason === 'awake') {
            const wokeAt = body.careFeedback.effect.at;
            body.careFeedback.sleepSummary = { startedAt: wokeAt - 24 * 3600000, wokeAt,
              settledHours, energyRecovered: 0, restGain: 0, growthPoints: 0 };
          }
          await route.fulfill({ response, json: body });
        });
        await sleep(page); await page.locator('.sleep-summary').waitFor();
        const text = await page.locator('.sleep-summary').textContent();
        assert(text.includes('入睡至起床：24.00 小时'));
        assert(text.includes(`实际结算：${settledHours.toFixed(2)} 小时`));
        assert.equal(text.includes('未计入结算：12.00 小时'), settledHours === 12);
        await readable(page); await wait(3200);
        await page.locator('.sleep-summary').screenshot({ path: join(dir, `duration-${width}-${settledHours}.png`) });
        await page.screenshot({ path: join(dir, `duration-${width}-${settledHours}-viewport.png`) });
        assert.deepEqual(errors, []);
        results.push({ kind: 'duration-response-fixture', width, font, elapsedHours: 24, settledHours, passed: true });
      } finally { await context.close(); }
    }
  }
  // Controlled numeric response fixtures, NOT naturally timed nine-second
  // browser sleeps. The real Go HTTP regression proves this raw recovery and
  // its durable diary; these two viewports prove both displays round it alike.
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    await seed('baby', false);
    await api('action', { kind: 'sleep' });
    const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
      isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
    await page.route('**/api/*', async route => {
      const response = await route.fetch(), body = await response.json();
      const energyRecovered = 0.03499999999999659;
      if (body.state?.sleeping && body.state.sleepSession) {
        body.state.sleepSession = { startedAt: body.state.lastTick - 9000, settledHours: 9 / 3600,
          energyRecovered, restGain: energyRecovered / 28, growthPoints: .003 };
        body.state.growth.care.rest = Math.max(body.state.growth.care.rest, energyRecovered / 28);
      }
      if (body.careFeedback?.reason === 'awake') {
        const wokeAt = body.careFeedback.effect.at;
        body.careFeedback.sleepSummary = { startedAt: wokeAt - 9000, wokeAt, settledHours: 9 / 3600,
          energyRecovered, restGain: energyRecovered / 28, growthPoints: .003 };
      }
      await route.fulfill({ response, json: body });
    });
    try {
      await page.goto(base); await page.locator('.home-caption').waitFor();
      for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
      await page.locator('.sleep-progress').waitFor();
      assert.deepEqual(await page.locator('.sleep-progress dt').allTextContents(), ['实际结算：', '恢复体力：', '休息习惯：', '睡眠期间成长：']);
      assert.deepEqual(await page.locator('.sleep-progress dd').allTextContents(), ['<0.01 小时', '+0.04', '+<0.01', '+<0.01 点']);
      await readable(page, '.sleep-progress');
      await page.locator('.sleep-progress').screenshot({ path: join(dir, `amount-progress-${width}.png`) });
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
      await key(page, 'B'); assert((await response).ok()); await key(page, 'C');
      await page.locator('.sleep-summary').waitFor();
      const text = await page.locator('.sleep-summary').innerText();
      assert(text.includes('恢复体力：+0.04') && text.includes('休息习惯：+<0.01'));
      // Inspect the acknowledged receipt after the ordinary short wake toast clears.
      await page.locator('.toast').waitFor({ state: 'hidden' });
      await readable(page);
      await page.locator('.sleep-summary').screenshot({ path: join(dir, `amount-summary-${width}.png`) });
      assert.equal(writes.length, 1, 'Reading numeric receipts replayed care');
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      assert.deepEqual(errors, []);
      results.push({ kind: 'half-step-response-fixture', width, font, energyRecovered: 0.03499999999999659, displayed: '0.04', passed: true });
    } finally { await context.close(); }
  }
  // Actual legacy migration/current backup imports, not response fixtures.
  // Import retains sleeping but intentionally drops active session provenance.
  for (const { width, font } of [{ width: 1200, font: 14 }, { width: 320, font: 28 }]) {
    for (const source of ['schema16', 'current-backup']) {
      const initial = await seed('baby', false);
      let backup;
      if (source === 'schema16') backup = { ...initial.state, schema: 16, sleeping: true };
      else {
        const bed = await api('action', { kind: 'sleep', requestId: `import-bed-${width}` });
        assert(bed.state.sleepSession); backup = bed.state;
      }
      const imported = await api('import', backup);
      assert(imported.state.sleeping); assert(!imported.state.sleepSession);
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = font + 'px'; }), font);
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor();
        for (const k of ['A', 'A', 'A', 'A']) await key(page, k);
        assert((await page.locator('.care-preview').textContent()).includes('没有完整入睡记录'));
        await readable(page, '.care-preview'); assert.equal(writes.length, 0);
        await page.locator('.care-preview').screenshot({ path: join(dir, `untracked-${width}-${source}-preview.png`) });
        const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().postDataJSON()?.kind === 'sleep');
        await key(page, 'B'); const wake = await (await response).json(); await key(page, 'C');
        assert(!wake.state.sleeping); assert(!wake.careFeedback.sleepSummary);
        assert.deepEqual(wake.careFeedback.effect.before, wake.careFeedback.effect.after);
        await page.locator('.sleep-summary-unavailable').waitFor();
        assert((await page.locator('.sleep-summary-unavailable').textContent()).includes('不代表睡着期间没有恢复'));
        assert.equal(await page.locator('.sleep-summary').count(), 0);
        await readable(page, '.sleep-summary-unavailable'); await wait(3200);
        await page.locator('.sleep-summary-unavailable').screenshot({ path: join(dir, `untracked-${width}-${source}-wake.png`) });
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.sleep-summary-unavailable').count(), 0);
        assert(wake.state.logs[0].text.includes('没有完整记录'));
        assert(!wake.state.logs[0].text.includes('+'));
        await diary(page, wake.state.logs[0], `${width}-${source}-untracked`);
        const nextBed = await sleep(page); assert(nextBed.state.sleepSession);
        const nextWake = await sleep(page); assert(nextWake.careFeedback.sleepSummary);
        await page.locator('.sleep-summary').waitFor();
        assert.equal(await page.locator('.sleep-summary-unavailable').count(), 0);
        assert.equal(writes.length, 3); assert.deepEqual(errors, []);
        results.push({ kind: 'untracked-sleep-real-import', width, font, source, diaryAfterReload: true, passed: true });
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify({ dir, results }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) { server.kill('SIGTERM'); await new Promise(r => { if (server.exitCode !== null) return r(); server.once('exit', r); }); }
  await writeFile(join(dir, 'server.log'), log);
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
}
