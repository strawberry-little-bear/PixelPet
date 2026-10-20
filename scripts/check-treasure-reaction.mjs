// Real Chrome + actual saved digs in a fresh temporary SQLite/server.
// Stages/species are imported fixtures; map reads select test cells, not blind play.
// Never accepts a player URL or imports into a running user service.
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
assert.equal(process.argv.length, 2, 'No player URL or database arguments.');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-reaction-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed(species = 2, stage = 'baby') {
  const now = Date.now(), age = { baby: 1, growing: 25, adult: 80 }[stage] * 3600000;
  const { state } = await api('import', { schema: 1, revision: 1, species, name: '寻宝动作伙伴', createdAt: now - age,
    hatchedAt: now - age, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
  assert.equal(state.growth.stage, stage);
  state.economy.owned.push('leaf-pin'); state.economy.equipped.accessory = 'leaf-pin';
  await api('import', state);
}
async function key(page, name) {
  await page.locator(`.button-${name.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function selectTreasure(page) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(6).fill('A')]) await key(page, k);
  assert.equal(await page.locator('.arcade-card.selected').getAttribute('data-game'), 'treasure');
  assert.equal(await page.locator('.arcade-card').count(), 7);
}
async function start(page, repeat = false) {
  await selectTreasure(page); await key(page, 'B');
  await page.locator('.game-guide').waitFor();
  if (repeat) assert.equal(await page.locator('.game-quick-start').count(), 1);
  await key(page, 'B');
  await page.locator('.treasure-pause').waitFor();
}
async function readable(page) {
  const issues = await page.locator('.treasure-game').evaluate(el => {
    const issues = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (['hidden', 'clip'].includes(style.overflowY) && (box.top < clip.top - 2 || box.bottom > clip.bottom + 2)) issues.push(node.textContent);
        }
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(node.textContent);
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'text clipped');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(), 0);
  assert.equal(await page.locator('.physical-button').count(), 3);
}
async function digIndex(page, index) {
  for (let i = 0; i < 9; i++) {
    const chosen = await page.locator('.treasure-grid [aria-selected=true]').getAttribute('aria-label');
    if (chosen.startsWith(`${index + 1}号格`)) { await key(page, 'B'); return; }
    await key(page, 'A');
  }
  throw new Error(`Could not select ${index}`);
}

const rigs = ['tanuki', 'bird', 'rabbit', 'dolphin', 'mushroom', 'bear', 'frog', 'cat', 'dragon', 'dog'];
const parts = ['.tanuki-paw.paw-right', '.bird-head', '.rabbit-arm.paw-right', '.dolphin-flipper.flipper-right', '.mushroom-cap', '.bear-paw-right', '.frog-hand-right', '.cat-paw.paw-right', '.dragon-hand-right', '.dog-paw-right'];
async function reaction(page, value) {
  await page.locator(`.treasure-companion[data-reaction=${value}]`).waitFor();
}
async function still(page) {
  assert.equal(await page.locator('.treasure-actor').evaluate(el => [el, ...el.querySelectorAll('*')].filter(n => getComputedStyle(n).animationName !== 'none').length), 0, 'paused/reduced art animated');
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
  for (let species = 0; species < rigs.length; species++) for (const stage of ['baby', 'growing', 'adult']) {
    await seed(species, stage);
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, hasTouch: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base); await start(page); await reaction(page, 'quiet'); await still(page);
      await key(page, 'C'); await reaction(page, 'quiet');
      const game = (await api('state')).state.game;
      const found = game.treasure.layout.findIndex(item => item > 0), empty = game.treasure.layout.findIndex(item => item === 0);
      const artBox = await page.locator('.treasure-actor').evaluate(el => ({width:el.clientWidth,height:el.clientHeight}));
      await digIndex(page, found); await reaction(page, 'found');
      assert.deepEqual(await page.locator('.treasure-actor').evaluate(el => ({width:el.clientWidth,height:el.clientHeight})), artBox);
      const root = page.locator(`.treasure-companion[data-rig=${rigs[species]}]`);
      assert.equal(await root.locator('.treasure-object').getAttribute('data-item'), String(game.treasure.layout[found]));
      assert.equal(await root.locator('.equipped-accessory[data-item="leaf-pin"]').count(), 1);
      assert.equal(await root.locator(`.${rigs[species]}-${stage}.rig-motion-treasure`).count(), 1);
      const motion = await root.locator(parts[species]).evaluate(el => ({ name: getComputedStyle(el).animationName, count: getComputedStyle(el).animationIterationCount, duration: getComputedStyle(el).animationDuration }));
      assert(motion.name.startsWith('treasure-'), JSON.stringify(motion)); assert.equal(motion.count, '1'); assert.equal(motion.duration, '1.6s');
      await wait(650);
      assert.notEqual(await root.locator(parts[species]).evaluate(el => getComputedStyle(el).transform), 'none', 'native animation did not move real anatomy');
      assert.equal(await root.locator('.treasure-object').evaluate(el => getComputedStyle(el).opacity), '1');
      if (stage === 'adult' || species === 2) await root.screenshot({ path: join(dir, `${rigs[species]}-${stage}.png`) });
      await key(page, 'C'); await reaction(page, 'quiet'); await still(page);
      await key(page, 'C'); await reaction(page, 'quiet');
      await digIndex(page, empty); await reaction(page, 'empty');
      assert.equal(await page.locator('.treasure-object').count(), 0);
      const saved = (await api('state')).state.game.treasure;
      assert(saved.opened.includes(found) && saved.opened.includes(empty));
      await page.waitForFunction(() => document.querySelector('.treasure-companion')?.dataset.reaction === 'quiet');
      assert((await page.locator('.treasure-result').innerText()).includes('空地'));
      await page.reload(); await page.locator('.treasure-pause').waitFor(); await reaction(page, 'quiet');
      assert.deepEqual((await api('state')).state.game.treasure, saved); await readable(page);
      assert.deepEqual(errors, []); results.push({ species, stage, realFoundAndEmpty: true, fixedArtBox:artBox, actualNativeMotion:true, motion, refreshDoesNotReplay: true });
    } finally { await ctx.close(); }
  }
  for (const species of [1, 3, 4]) for (const font of [14, 28]) {
    await seed(species, 'adult');
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true,
      reducedMotion: 'reduce', forcedColors: font === 28 ? 'active' : 'none' });
    const page = await ctx.newPage();
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
    try {
      await page.goto(base); await start(page); await readable(page); await key(page, 'C');
      const game = (await api('state')).state.game;
      await digIndex(page, game.treasure.layout.findIndex(item => item > 0)); await reaction(page, 'found');
      await still(page); await readable(page);
      assert((await page.locator('.treasure-companion-note').innerText()).includes('找到'));
      assert.equal(await page.locator('.treasure-object').count(), 1);
      await page.screenshot({path: join(dir, `${rigs[species]}-320-${font}-viewport.png`)});
      await page.locator('.treasure-companion').screenshot({path: join(dir, `${rigs[species]}-320-${font}-companion.png`)});
      results.push({species, width:320, font, reducedMotion:true, forcedColors:font===28, staticRealObject:true, readable:true});
    } finally { await ctx.close(); }
  }
  // Actual saved HTTP action whose response is deliberately delayed: no stale flourish.
  await seed();
  const ctx = await browser.newContext({ viewport: {width:1200,height:850}, hasTouch:true });
  try {
    const page = await ctx.newPage(); await page.goto(base); await start(page); await key(page,'C');
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON()?.kind !== 'treasure-dig') return route.continue();
      const response = await route.fetch(); await wait(2200); await route.fulfill({response});
    });
    await key(page,'B'); await reaction(page,'quiet'); assert.equal((await api('state')).state.game.treasure.opened.length,1);
    assert.equal(await page.locator('.treasure-result').count(),1); results.push({delayedSavedResponse:2200, noStaleReaction:true});
  } finally {await ctx.close();}
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} catch (error) {
  await writeFile(join(dir, 'failure.log'), String(error.stack || error)); console.error('Artifacts:', dir); throw error;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
