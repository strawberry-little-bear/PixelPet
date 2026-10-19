// Own temporary service/save only. Faults are HTTP response fixtures, not save corruption.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY to a freshly built test binary.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-album-response-'));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [];
let server, browser, log = '', startupError;
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, body) => {
  const res = await fetch(base + '/api/' + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const reply = await res.json(); assert(res.ok, JSON.stringify(reply)); return reply;
};
async function key(page, k) { await page.locator(`.button-${k}:not(:disabled)`).tap(); }
async function reconcile(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/state');
  await key(page, 'b'); await (await response).finished();
  await page.locator('.button-b:not(:disabled)').waitFor();
}
async function handbook(page) {
  await key(page, 'a'); for (let i = 0; i < 8; i++) await key(page, 'a'); await key(page, 'b');
  await key(page, 'b'); await page.locator('[aria-label="永久纪念册"]').waitFor();
}
const corruptions = {
  entries: c => { c.entries = {}; },
  null: c => { c.entries = [null]; },
  date: c => { c.entries[0].at = 8640000000000001; },
};
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: process.env.PIXELPET_TEST_WEB || join(root, 'web/dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1200, 320]) for (const mode of ['initial', 'poll', 'write', 'missing-legacy', 'null-legacy', 'empty-legacy']) {
    for (const fault of (mode.includes('legacy') ? ['none'] : Object.keys(corruptions))) {
      const now = Date.now(); await api('import', { schema: 1, revision: 1, species: 2, name: '一起慢慢玩', createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0, logs: [] });
      const before = await api('state');
      const ctx = await browser.newContext({ viewport: { width, height: 750 }, hasTouch: true, isMobile: width < 700, reducedMotion: 'reduce', forcedColors: width === 320 ? 'active' : 'none' });
      try {
        if (width === 320) await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '28px'; }));
        const page = await ctx.newPage(), errors = [], writes = [], reads = [];
        let broken = mode === 'initial' ? 'visit' : '';
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => {
          const p = new URL(r.url()).pathname.replace('/api/', '');
          if (['state', 'visit', 'action'].includes(p)) reads.push(p);
          if (r.method() === 'POST' && p !== 'visit') writes.push(p);
        });
        await page.route(/\/api\/(state|visit|action)$/, async route => {
          const response = await route.fetch(), reply = await response.json();
          const path = new URL(route.request().url()).pathname.replace('/api/', '');
          if (!response.ok) return route.fulfill({ response });
          const c = { since: now - 3600000, legacy: true, entries: [{ kind: 'hatch', source: 'saved', at: now - 3600000 }, { kind: 'meal', source: 'shared', at: now - 1000 }] };
          if (path === broken) corruptions[fault](c);
          reply.state.album = c;
          if (mode === 'missing-legacy') delete reply.state.album;
          if (mode === 'null-legacy') reply.state.album = null;
          if (mode === 'empty-legacy') reply.state.album = { since: now, legacy: true, entries: null };
          await route.fulfill({ response, json: reply });
        });
        await page.goto(base);
        if (mode === 'initial') {
          await page.locator('.save-recovery').waitFor();
          if (fault === 'entries') await page.screenshot({ path: join(dir, `${width}-initial-recovery.png`), fullPage: true });
          await page.keyboard.press('a'); await page.keyboard.press('c'); assert.equal(writes.length, 0);
          broken = ''; await key(page, 'b'); await page.locator('.home-caption').waitFor(); await handbook(page);
        } else {
          await page.locator('.home-caption').waitFor();
          if (mode === 'write') {
            broken = 'action'; await key(page, 'a'); await key(page, 'b'); await page.locator('.save-recovery').waitFor();
            assert((await page.locator('[role="alert"]').innerText()).includes('可能已经保存'));
            await page.keyboard.press('a'); await page.keyboard.press('c'); assert.deepEqual(writes, ['action']);
            broken = 'state'; await reconcile(page); assert.equal(reads.at(-1), 'state'); assert.equal(await page.locator('.save-recovery').count(), 1);
            broken = ''; await reconcile(page); await page.locator('.home-caption').waitFor(); assert.equal(reads.at(-1), 'state');
            assert.equal(await page.locator('.care-outcome,.growth-feedback.has-feedback').count(), 0);
            await handbook(page);
          } else {
            await handbook(page);
            if (mode === 'poll') {
              broken = 'visit'; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
              await page.locator('.save-recovery').waitFor(); assert(!(await page.locator('[role="alert"]').innerText()).includes('可能已经保存'));
              broken = ''; await key(page, 'b'); await page.locator('[aria-label="永久纪念册"]').waitFor();
            }
          }
        }
        const panel = page.locator('[aria-label="永久纪念册"]');
        assert.equal(await panel.count(), 1);
        if (mode === 'missing-legacy' || mode === 'null-legacy') {
          assert((await panel.innerText()).includes('更新服务后')); assert.equal(await panel.locator('time').count(), 0);
        } else if (mode === 'empty-legacy') {
          assert((await panel.innerText()).includes('还没有留下回忆')); assert.equal(await panel.locator('time').count(), 0);
        } else {
          await key(page, 'b'); assert.equal(await panel.getAttribute('data-album-kind'), 'hatch');
          assert((await panel.innerText()).includes('沿用旧存档的相遇日期'));
          await key(page, 'b'); assert.equal(await panel.getAttribute('data-album-kind'), 'meal');
          assert((await panel.innerText()).includes('纪念册开启后记下的第一顿饭'));
          assert.equal(await panel.locator('time').getAttribute('datetime'), new Date(now - 1000).toISOString());
        }
        assert.equal(await page.locator('.physical-button').count(), 3); assert.equal(await page.locator('.lcd button,.lcd input,.lcd a').count(), 0);
        const bounds = await panel.evaluate(el => {
          const b = el.getBoundingClientRect(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let inside = true;
          while (w.nextNode()) { if (!w.currentNode.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(w.currentNode); for (const x of r.getClientRects()) if (x.width && x.height) inside &&= x.left >= b.left - 1 && x.right <= b.right + 1; }
          return inside && document.documentElement.scrollWidth <= innerWidth + 1;
        });
        assert(bounds, 'album text must remain horizontally readable');
        const after = await api('state'); assert.equal(after.state.careCount, before.state.careCount + (mode === 'write' ? 1 : 0));
        if (mode === 'write') {
          const actual = after.state.album, original = before.state.album;
          assert.equal(actual.since, original.since); assert.equal(actual.legacy, original.legacy);
          assert.deepEqual(actual.entries.slice(0, -1), original.entries);
          const meal = actual.entries.at(-1); assert.equal(meal.kind, 'meal'); assert.equal(meal.source, 'shared');
          assert(meal.at >= now && meal.at <= after.serverTime);
        } else assert.deepEqual(after.state.album, before.state.album, 'response fixtures must not fabricate saved memories');
        assert.deepEqual(after.state.economy, before.state.economy);
        assert.deepEqual(writes, mode === 'write' ? ['action'] : []); assert.deepEqual(errors, []);
        if (fault === 'entries' || mode.includes('legacy')) await page.screenshot({ path: join(dir, `${width}-${mode}.png`), fullPage: true });
        results.push({ width, mode, fault, writes, errors }); console.log('PASS', width, mode, fault);
      } finally { await ctx.close(); }
    }
  }
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await stopped; }
  await writeFile(join(dir, 'server.log'), log);
}
