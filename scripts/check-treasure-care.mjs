// Real Chrome + real settlements in an owned temporary SQLite/server.
// Constructed baby/adult/cooldown/quota fixtures, not natural multi-day play.
// Route choice reads the server's hidden map; this is not blind human play.
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
assert.notEqual(resolve(binary), join(root, 'bin/pixelpet'));
assert.notEqual(resolve(web), join(root, 'web/dist'));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-care-')), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function seed(stage, cooldown) {
  const now = Date.now(), age = (stage === 'adult' ? 80 : 1) * 3600000;
  const { state } = await api('import', { schema: 1, revision: 1, species: 2, name: '成长回执伙伴',
    createdAt: now - age, hatchedAt: now - age, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 70, clean: 50, energy: 80 }, careCount: 0, logs: [] });
  assert.equal(state.growth.stage, stage);
  state.growth.care.play = cooldown ? 1 : 0; state.growth.care.lastPlay = cooldown ? now : 0;
  if (cooldown || stage === 'adult') {
    state.economy.gameCoins = 30; state.economy.lastGameAt = now;
  }
  return (await api('import', state)).state;
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function play(page) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(6).fill('A'), 'B']) await key(page, k);
  await page.locator('.game-guide').waitFor(); await key(page, 'B');
  await page.locator('.treasure-pause').waitFor(); await key(page, 'C');
  const game = (await api('state')).state.game;
  for (const tile of game.treasure.layout.flatMap((item, i) => item > 0 ? [i] : [])) {
    let selected = false;
    for (let i = 0; i < 9; i++) {
      if ((await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label')).startsWith(`${tile + 1}号格`)) {
        await key(page, 'B'); selected = true; break;
      }
      await key(page, 'A');
    }
    assert(selected, `Could not select ${tile}`);
  }
  await page.locator('.treasure-game[data-done=true]').waitFor();
  assert.equal(await page.locator('.care-outcome').count(), 0, 'Unsettled game invented a receipt');
  const finish = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' &&
    r.request().postDataJSON()?.kind === 'treasure-finish');
  await key(page, 'B'); const response = await finish;
  assert(response.ok()); return response.json();
}
async function readable(page, font) {
  const issues = await page.locator('.care-outcome').evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(node.textContent);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
            (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'Receipt text clipped or trapped in a nested scroller');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert(await page.locator('.care-learning').evaluate((el, font) =>
    parseFloat(getComputedStyle(el).fontSize) >= font * .85, font), 'Text did not scale');
  await page.locator('.care-outcome > small').scrollIntoViewIfNeeded();
  assert(await page.locator('.care-outcome > small').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1;
  }), 'Receipt end is unreachable');
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
  for (const width of [1200, 320]) for (const font of [14, 28]) {
    for (const scenario of [{ stage: 'baby', cooldown: false }, { stage: 'baby', cooldown: true }, { stage: 'adult', cooldown: false }]) {
      const { stage, cooldown } = scenario, before = await seed(stage, cooldown);
      const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true,
        isMobile: width < 700, reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() === 'POST') writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = font + 'px';
      }), font);
      try {
        await page.goto(base); const reply = await play(page), feedback = reply.careFeedback;
        assert.equal(feedback.kind, 'treasure-finish'); assert.equal(feedback.habit, 'play');
        assert.equal(feedback.reason, cooldown ? 'cooldown' : 'credited');
        assert.equal(feedback.habitGain, cooldown ? 0 : 1);
        assert.equal(feedback.points, cooldown || stage === 'adult' ? 0 : .25);
        assert.equal(reply.state.careCount, 1); assert.equal(reply.state.growth.stage, stage);
        assert.equal(reply.state.growth.form, before.growth.form);
        assert.equal(reply.state.economy.coins, cooldown || stage === 'adult' ? 0 : 6);
        assert.equal(reply.state.growth.care.play - before.growth.care.play, feedback.habitGain);
        const receipt = page.getByRole('region', { name: '上次操作的即时变化' });
        const learning = page.getByRole('group', { name: '本次成长与习惯' });
        await learning.waitFor();
        assert((await learning.textContent()).includes(`本次成长：+${feedback.points.toFixed(2)} 点`));
        assert((await learning.textContent()).includes(`陪玩习惯：+${feedback.habitGain}`));
        assert((await learning.textContent()).includes(cooldown ? '记录时同类习惯仍在间隔内' : '已计入'));
        for (const need of ['hunger', 'mood', 'clean', 'energy']) {
          const text = await receipt.locator(`[data-need=${need}]`).textContent();
          assert(text.includes(`${feedback.effect.before[need].toFixed(2)} → ${feedback.effect.after[need].toFixed(2)}`));
          assert.equal(feedback.effect.after[need], reply.state.needs[need]);
        }
        const snapshot = await receipt.textContent();
        await key(page, 'C'); // Skip only the celebration, not the acknowledged receipt.
        await page.locator('[data-feedback=idle]').waitFor({ timeout: 12000 });
        assert.equal(await receipt.textContent(), snapshot);
        // One real external operation + ordinary polling: newer needs never rewrite the old receipt.
        if (width === 1200 && font === 14 && stage === 'baby' && !cooldown) {
          const poll = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/visit');
          await api('action', { kind: 'clean' });
          const polled = await (await poll).json();
          assert.equal(polled.state.careCount, 2);
          assert(polled.state.needs.clean > feedback.effect.after.clean);
          assert.equal(await receipt.textContent(), snapshot);
        }
        await readable(page, font);
        for (const k of ['A', 'A', 'A', 'A', 'A', 'B']) await key(page, k);
        await page.locator('.screen-status[data-status-page="0"]').waitFor();
        assert.equal(await receipt.textContent(), snapshot); await readable(page, font);
        await learning.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(dir, `${width}-${font}-${stage}-${cooldown ? 'cooldown' : 'credited'}.png`) });
        assert.equal(writes.filter(w => w.path === '/api/action' && w.body.kind === 'treasure-finish').length, 1);
        assert(writes.every(w => ['/api/action', '/api/visit'].includes(w.path)), 'Unexpected save import/reset from UI');
        await page.reload(); await page.locator('.home-caption').waitFor();
        assert.equal(await page.locator('.care-outcome').count(), 0, 'Refresh fabricated a response-only receipt');
        assert.deepEqual(errors, []); results.push({ width, font, stage, cooldown, points: feedback.points,
          habitGain: feedback.habitGain, coins: reply.state.economy.coins, writes: writes.length });
      } catch (e) {
        await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
        await writeFile(join(dir, 'failure.json'), JSON.stringify({ width, font, scenario, writes, errors, state: await api('state') }, null, 2));
        console.error('Artifacts:', dir); throw e;
      } finally { await context.close(); }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
