// Real HTTP/SQLite route choices and one real-clock completion. The imported
// schema-1 companion is a test fixture, never a player's history or database.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-walk-trails-browser-')), results = [];
const port = await new Promise((resolve, reject) => {
 const s = net.createServer(); s.once('error', reject);
 s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
const trails = [
 { id: 'woodland', name: '林荫小径', finds: ['leaf', 'pinecone', 'feather'] },
 { id: 'pond', name: '池畔小路', finds: ['shell', 'pebble', 'feather'] },
 { id: 'garden', name: '花园步道', finds: ['flower', 'leaf', 'pebble'] },
];
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
async function picker(page, index) {
 for (let i = 0; i < 5; i++) await key(page, 'a');
 assert.match(await page.locator('.walk-pause span[data-selected=true]').innerText(), /挑条小路/);
 await key(page, 'b'); await page.locator('.walk-trail-picker').waitFor();
 for (let i = 0; i < index; i++) await key(page, 'a');
 assert.match(await page.locator('.walk-trail-selection').innerText(), new RegExp(trails[index].name));
}
async function layout(page) {
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
 assert.equal(await page.locator('.physical-button').count(), 3);
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
 const clipped = await page.locator('.walk-trail-picker').evaluate(el => {
  const content = document.querySelector('.lcd-content').getBoundingClientRect(), errors = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
   if (!walker.currentNode.textContent.trim()) continue;
   const range = document.createRange(); range.selectNodeContents(walker.currentNode);
   for (const b of range.getClientRects()) if (b.width && b.height && (b.left < content.left - 1 || b.right > content.right + 1 || b.top < content.top - 1 || b.bottom > content.bottom + 1)) errors.push(walker.currentNode.textContent);
  }
  return errors;
 }); assert.deepEqual(clipped, [], 'picker text clipped');
 const footer = page.locator('.walk-trail-picker > small'); await footer.scrollIntoViewIfNeeded();
 const bounds = await footer.boundingBox(); assert(bounds && bounds.y < page.viewportSize().height && bounds.y + bounds.height > 0, 'bottom instructions unreachable');
}
async function reach(page, beat) {
 const deadline = Date.now() + 110000, resumptions = [];
 while (Date.now() < deadline) {
  const r = await api('state');
  if (r.state.game.walking.beat >= beat) return { result: r, resumptions };
  if (await page.locator('.walk-pause').isVisible()) {
   resumptions.push(Date.now()); assert(resumptions.length <= 6, 'host repeatedly suspended');
   await key(page, 'c');
  }
  await wait(200);
 }
 throw Error(`did not naturally reach ${beat}`);
}
try {
 server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_WEB: web,
  PIXELPET_DB: join(dir, 'test.db'), PIXELPET_ADDR: `127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
 server.once('error', e => { startupError = e; }); server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
 let ready = false;
 for (let i = 0; i < 100; i++) {
  if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
  try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
  await wait(100);
 }
 assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
 const now = Date.now();
 await api('import', { schema: 1, revision: 1, species: 3, name: '试走小路', createdAt: now - 3600000,
  hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
  needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } });
 for (const size of (process.argv.includes('--recovery-only') ? [] : [{ width: 1200, height: 900, font: 14 }, { width: 320, height: 380, font: 28 }])) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: size.width === 320, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') writes.push(r.postDataJSON()); });
  await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), size.font);
  for (let i = 0; i < trails.length; i++) {
   const before = (await api('state')).state;
   await api('action', { kind: 'play-walk' }); await page.goto(base); await page.locator('.walk-pause').waitFor();
   const original = (await api('state')).state.game;
   await picker(page, i); await layout(page);
   await page.screenshot({ path: join(dir, `${size.width}-${trails[i].id}-picker.png`), fullPage: true });
   // Cancel is read-only, including a selected but unconfirmed route.
   const count = writes.length; await key(page, 'c'); await page.locator('.walk-pause').waitFor();
   assert.equal(writes.length, count); assert.deepEqual((await api('state')).state.game, original);
   await picker(page, i); await key(page, 'b'); await page.locator(`.park-scene[data-trail="${trails[i].id}"]`).waitFor();
   const chosen = (await api('state')).state;
   assert.equal(chosen.game.walking.trail, trails[i].id); assert(chosen.game.walking.paused); assert.equal(chosen.game.walking.beat, 0);
   assert.deepEqual(chosen.game.walking.route, original.walking.route);
   for (const find of chosen.game.walking.souvenirs) assert(trails[i].finds.includes(find));
   assert.equal(chosen.economy.coins, before.economy.coins); assert.deepEqual(chosen.park.finds, before.park.finds);
   assert(!await page.locator('.walk-pause').innerText().then(s => s.includes('挑条小路')));
   await page.reload(); await page.locator('.walk-pause').waitFor(); const countAfterReload = writes.length;
   await wait(1300); assert.equal(writes.length, countAfterReload); assert.deepEqual((await api('state')).state.game, chosen.game);
   // Resume briefly to inspect the real scene, pause again without hidden time.
   await key(page, 'c'); await page.locator(`[data-trail-scenery="${trails[i].id}"]`).waitFor();
   await page.screenshot({ path: join(dir, `${size.width}-${trails[i].id}-scene.png`), fullPage: true });
   await key(page, 'c'); await page.locator('.walk-pause').waitFor();
   if (size.width === 320 && i === 2) {
    await key(page, 'c'); const ended = await reach(page, 72), n = ended.result.state.game.walking;
    assert.equal(n.trail, 'garden'); assert.equal(ended.result.state.economy.coins, before.economy.coins);
    const found = ended.result.state.park.finds;
    assert.equal(found.reduce((sum, d) => sum + d.count, 0) - before.park.finds.reduce((sum, d) => sum + d.count, 0), 3);
    const finishedID = ended.result.state.game.id;
    await key(page, 'b'); await page.locator('.home-caption').waitFor(); const settled = (await api('state')).state;
    assert.equal(settled.economy.coins - before.economy.coins, 3 + Math.floor(n.cleared / 4));
    assert.equal(settled.park.walks, before.park.walks + 1); assert.deepEqual(settled.park.finds, found);
    await page.reload(); await page.locator('.home-caption').waitFor(); assert.equal((await api('state')).state.park.walks, settled.park.walks);
    assert.equal(writes.filter(a => a.kind === 'walk-finish' && a.gameId === finishedID).length, 1);
    results.push({ type: 'real-clock-selected-route-completion-and-single-settlement', trail: n.trail, finds: n.souvenirs, resumptions: ended.resumptions });
   } else {
    for (const k of ['a', 'a', 'b', 'b']) await key(page, k);
    await page.locator('.home-caption').waitFor();
    const canceled = (await api('state')).state; assert.equal(canceled.economy.coins, before.economy.coins); assert.deepEqual(canceled.park.finds, before.park.finds);
   }
   results.push({ type: 'real-http-three-key-choice-cancel-save-refresh', ...size, trail: trails[i].id });
  }
  assert.deepEqual(errors, []); await context.close();
 }
 // Commit the choice, lose only its reply, and reconcile without resending it.
 const recoveryContext = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true });
 const recovery = await recoveryContext.newPage(), recoveryWrites = [];
 recovery.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') recoveryWrites.push(r.postDataJSON()); });
 await api('action', { kind: 'play-walk' }); await recovery.goto(base); await recovery.locator('.walk-pause').waitFor();
 await picker(recovery, 1);
 let lost = false;
 await recovery.route('**/api/action', async route => {
  if (!lost && route.request().postDataJSON().kind === 'walk-trail') {
   lost = true; const response = await route.fetch(); assert(response.ok()); await route.abort('failed');
  } else await route.continue();
 });
 await key(recovery, 'b'); await recovery.getByText('先核对，再继续', { exact: true }).waitFor();
 const committed = (await api('state')).state.game;
 assert.equal(committed.walking.trail, 'pond'); assert(committed.walking.paused); assert.equal(committed.walking.beat, 0);
 await wait(1400); assert.equal(recoveryWrites.filter(a => a.kind === 'walk-trail').length, 1);
 await key(recovery, 'b'); await recovery.locator('.walk-pause').waitFor(); await wait(1400);
 assert.equal(recoveryWrites.filter(a => a.kind === 'walk-trail').length, 1); assert.deepEqual((await api('state')).state.game, committed);
 assert.match(await recovery.locator('.walking-game header').innerText(), /池畔小路/);
 assert(!await recovery.locator('.walk-pause').innerText().then(s => s.includes('挑条小路')));
 await recoveryContext.close(); results.push({ type: 'committed-choice-lost-reply-read-without-retry-or-auto-resume' });
 await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
 console.log(JSON.stringify({ passed: results.length, artifacts: dir }, null, 2));
} catch (e) {
 await writeFile(join(dir, 'failure.txt'), String(e.stack || e)); console.error(`Artifacts: ${dir}`); throw e;
} finally {
 await browser?.close(); server?.kill('SIGTERM'); await writeFile(join(dir, 'server.log'), log);
}
