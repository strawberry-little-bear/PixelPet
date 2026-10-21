// Real play → confirmed coins → buy → use → store → permanent memory → refresh. Private saves only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-shop-preview-'));
const socket = createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '', startupError;
const results = [];
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.json(); assert(response.ok, JSON.stringify(body)); return body;
}
async function key(page, letter) {
  const button = page.locator(`.button-${letter}:not(:disabled)`); await button.waitFor();
  if (page.viewportSize().width < 700) await button.tap();
  else await page.keyboard.press(letter);
  // Persistence can finish before React accepts the reply. Wait for the UI too.
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function menu(page, index) {
  await key(page, 'a'); for (let i = 0; i < index; i++) await key(page, 'a'); await key(page, 'b');
}
async function shopItem(page) {
  await menu(page, 9); await key(page, 'a'); await key(page, 'b');
  await page.locator('.shop-panel h3').waitFor();
}
async function homeMemory(page, mode, suffix) {
  await menu(page, 8);
  for (let i = 0; i < 4; i++) await key(page, 'a');
  await key(page, 'b'); await key(page, 'b');
  const panel = page.locator('.album-panel[data-album-kind=outfit]');
  await panel.waitFor();
  assert((await panel.textContent()).includes('当时选用：嫩叶胸针'), 'saved outfit has no readable item name');
  assert((await panel.ariaSnapshot()).includes('当时选用：嫩叶胸针'), 'saved item name is hidden from accessibility tree');
  assert.equal(await panel.locator('[data-item=leaf-pin]').count(), 1);
  const note = panel.locator('.album-item');
  const font = await note.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert(font >= mode.font * .85, 'memory item label did not scale');
  await note.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const lines = Array.from(range.getClientRects(), r => ({ top: r.top + scrollY, left: r.left, width: r.width, height: r.height }));
    for (const line of lines) {
      window.scrollTo({ top: line.top - 12, behavior: 'instant' });
      const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
      if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !el.contains(hit)) throw Error('Memory item label unreadable');
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Memory page horizontal overflow');
  });
  await page.screenshot({ path: join(dir, `${mode.name}-memory-${suffix}.png`), fullPage: true });
  await key(page, 'c'); await key(page, 'c'); await page.locator('.content-home').waitFor();
}
async function caption(page, expected, mode) {
  const note = page.locator('.shop-preview small');
  assert.equal(await note.textContent(), expected);
  assert((await page.locator('.shop-preview').ariaSnapshot()).includes(expected));
  const layout = await note.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const clips = [];
    for (const box of range.getClientRects()) {
      if (box.left < -1 || box.right > innerWidth + 1) clips.push('viewport');
      for (let p = el.parentElement; p; p = p.parentElement) {
        const css = getComputedStyle(p), rect = p.getBoundingClientRect();
        if (/hidden|clip/.test(css.overflowY) && (box.top < rect.top - 2 || box.bottom > rect.bottom + 2)) clips.push(p.className);
      }
    }
    return { clips, font: parseFloat(getComputedStyle(el).fontSize), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.deepEqual(layout.clips, []); assert(!layout.overflow);
  assert(layout.font >= mode.font * .85);
}
async function purchaseDetails(page, coins, mode) {
  const status = page.locator('.shop-decision');
  const expected = `按当前余额，购买后剩 ${coins - 12} 金币。`;
  assert((await status.textContent()).includes(expected));
  assert((await status.ariaSnapshot()).includes('仅购买，不会自动使用；购买成功后，再按 B 使用。'));
  let lines = 0;
  for (const note of await page.locator('.shop-purchase-details').all()) {
    const result = await note.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const count = range.getClientRects().length, issues = [];
      for (let i = 0; i < count; i++) {
        let box = range.getClientRects()[i];
        window.scrollBy({ top: box.top - 12, behavior: 'instant' });
        box = range.getClientRects()[i];
        const dock = document.querySelector('.device-buttons').getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (box.left < -1 || box.right > innerWidth + 1 || box.top < 8 ||
            box.bottom > Math.min(innerHeight, dock.top) - 8 || !hit || !el.contains(hit)) issues.push(i);
        for (let p = el.parentElement; p; p = p.parentElement) {
          const css = getComputedStyle(p), bounds = p.getBoundingClientRect();
          if (/hidden|clip/.test(css.overflowY) && (box.top < bounds.top - 2 || box.bottom > bounds.bottom + 2)) issues.push(i);
        }
      }
      return { count, issues, font: parseFloat(getComputedStyle(el).fontSize), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.deepEqual(result.issues, []); assert(!result.overflow); assert(result.font >= mode.font * .85);
    lines += result.count;
  }
  assert(lines >= 2);
  await page.screenshot({ path: join(dir, `${mode.name}-purchase-confirm.png`), fullPage: true });
  return lines;
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of [
    { name: 'desktop', width: 1200, height: 850, font: 14 },
    { name: 'phone-lost-buy', width: 320, height: 480, font: 28, lostKind: 'buy' },
    { name: 'phone-lost-equip', width: 320, height: 380, font: 28, lostKind: 'equip' },
  ]) {
    // A healthy schema-1 fixture, not fabricated coins, ownership or a completed game.
    const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '小窝伙伴',
      createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
      needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
    const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
      hasTouch: true, isMobile: mode.width < 700, reducedMotion: 'reduce', forcedColors: mode.lostKind ? 'active' : 'none' });
    const page = await context.newPage(), writes = [], errors = [];
    try {
      await context.addInitScript(font => document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${font}px`;
      }), mode.font);
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
      let lost = false, pendingCaption;
      await page.route('**/api/action', async route => {
        if (mode.lostKind && !lost && route.request().postDataJSON().kind === mode.lostKind) {
          lost = true;
          const response = await route.fetch({ maxRetries: 0 });
          if (!response.ok()) errors.push(`Lost-write request failed: ${response.status()}`);
          pendingCaption = await page.locator('.shop-preview small').textContent();
          await route.abort('failed');
        } else await route.continue();
      });
      await page.goto(base); await page.locator('.home-caption').waitFor(); await menu(page, 1);
      for (let i = 0; i < 6; i++) await key(page, 'a');
      await key(page, 'b'); await page.locator('.game-guide').waitFor(); await key(page, 'b');
      await page.locator('.treasure-pause').waitFor(); await key(page, 'c');
      for (let i = 0; i < 6; i++) {
        await key(page, 'b'); const hunt = (await api('state')).state.game.treasure;
        // Read only to determine completion; never select by the hidden map.
        if (hunt.opened.length >= 6 || hunt.opened.filter(i => hunt.layout[i]).length === 3) break;
      }
      await page.locator('.treasure-game[data-done=true]').waitFor(); const gameId = (await api('state')).state.game.id;
      await key(page, 'b'); await page.locator('.game-outcome').waitFor(); const earned = (await api('state')).state;
      assert(!earned.game); assert(earned.economy.coins >= 3 && earned.economy.coins <= 6);
      assert.equal(earned.careCount, 1); assert.equal(earned.companion.recent.id, gameId);
      await key(page, 'c'); await menu(page, 9); await page.locator('.shop-panel').waitFor();
      await caption(page, '当前小窝 · 装扮不影响成长', mode); await key(page, 'b');
      const funded = (await api('state')).state; assert.equal(funded.economy.coins, earned.economy.coins + 10);
      await key(page, 'a'); await key(page, 'b'); await caption(page, '仅预览 · 未购买', mode);
      const beforePreview = (await api('state')).state.economy;
      await key(page, 'b'); assert.equal(await page.locator('.shop-panel').getAttribute('data-confirm'), 'true');
      const purchaseLines = await purchaseDetails(page, funded.economy.coins, mode);
      await key(page, 'a'); assert.deepEqual((await api('state')).state.economy, beforePreview);
      assert.equal(await page.locator('.shop-purchase-details').count(), 0);
      await key(page, 'b'); await key(page, 'c'); assert.deepEqual((await api('state')).state.economy, beforePreview);
      await key(page, 'b'); await key(page, 'b');
      if (mode.lostKind === 'buy') {
        await page.locator('.save-recovery').waitFor(); assert(lost); assert.equal(pendingCaption, '仅预览 · 未购买');
        await key(page, 'b'); await page.locator('.save-recovery').waitFor({ state: 'detached' });
      }
      const bought = (await api('state')).state;
      assert.equal(bought.economy.coins, funded.economy.coins - 12); assert.deepEqual(bought.economy.owned, ['leaf-pin']);
      assert.equal(bought.economy.equipped.accessory, '');
      // A recovered write is read, not replayed. Navigate explicitly if recovery returned home.
      if (await page.locator('.shop-panel').count() === 0) await shopItem(page);
      await caption(page, '仅预览 · 未使用', mode); await key(page, 'b');
      if (mode.lostKind === 'equip') {
        await page.locator('.save-recovery').waitFor(); assert(lost); assert.equal(pendingCaption, '仅预览 · 未使用');
        await key(page, 'b'); await page.locator('.save-recovery').waitFor({ state: 'detached' });
        if (await page.locator('.shop-panel').count() === 0) await shopItem(page);
      }
      await caption(page, '使用中 · 已保存', mode);
      await page.screenshot({ path: join(dir, `${mode.name}-saved.png`), fullPage: true });
      // Removing retains a free preview, but leaving the item shows the actual saved room.
      await key(page, 'b'); await caption(page, '仅预览 · 未使用', mode);
      assert.equal((await api('state')).state.economy.equipped.accessory, '');
      assert.equal(await page.locator('.shop-preview [data-item=leaf-pin]').count(), 1);
      await page.screenshot({ path: join(dir, `${mode.name}-trial.png`), fullPage: true });
      await key(page, 'c'); await caption(page, '当前小窝 · 装扮不影响成长', mode);
      assert.equal(await page.locator('.shop-preview [data-item=leaf-pin]').count(), 0);
      await key(page, 'c'); await page.locator('.content-home').waitFor();
      assert.equal(await page.locator('.content-home [data-item=leaf-pin]').count(), 0);
      const memoryBefore = (await api('state')).state.album.entries;
      assert.equal(memoryBefore.filter(m => m.kind === 'outfit').length, 1);
      assert.equal(memoryBefore.find(m => m.kind === 'outfit').item, 'leaf-pin');
      await homeMemory(page, mode, 'stored');
      assert.deepEqual((await api('state')).state.album.entries, memoryBefore);
      await shopItem(page); await key(page, 'b'); await caption(page, '使用中 · 已保存', mode);
      const equipped = (await api('state')).state;
      assert.equal(equipped.economy.equipped.accessory, 'leaf-pin'); assert.equal(equipped.economy.coins, bought.economy.coins);
      assert.equal(equipped.careCount, 1);
      await key(page, 'c'); await key(page, 'c'); await page.locator('.content-home').waitFor();
      await page.reload(); await page.locator('.content-home').waitFor();
      assert.equal(await page.locator('.content-home [data-item=leaf-pin]').count(), 1);
      const persisted = (await api('state')).state;
      assert.deepEqual(persisted.economy, equipped.economy); assert.equal(persisted.careCount, 1);
      assert.equal(persisted.companion.recent.id, gameId);
      await homeMemory(page, mode, 'reloaded');
      assert.deepEqual((await api('state')).state.album.entries, memoryBefore);
      assert.deepEqual((await api('state')).state.economy, persisted.economy);
      await shopItem(page); await caption(page, '使用中 · 已保存', mode);
      assert.equal(writes.filter(w => w.kind === 'buy').length, 1); assert.equal(writes.filter(w => w.kind === 'equip').length, 3);
      assert.equal(writes.filter(w => w.kind === 'treasure-finish').length, 1); assert.equal(writes.filter(w => w.kind === 'daily').length, 1);
      assert.equal(await page.locator('.physical-button').count(), 3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
      assert.deepEqual(errors, []);
      results.push({ mode: mode.name, purchaseLines, pendingCaption, writes, earned: earned.economy.coins, coins: persisted.economy.coins, gameId });
    } catch (error) {
      await page.screenshot({ path: join(dir, `${mode.name}-failure.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.length, artifacts: dir }));
} finally {
  console.log('Artifacts:', dir); await writeFile(join(dir, 'server.log'), log);
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exit = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await exit;
  }
}
