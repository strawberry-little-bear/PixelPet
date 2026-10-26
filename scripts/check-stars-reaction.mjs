// Real HTTP catches; constructed age fixtures are not evidence of natural growth.
// All saves/builds are private; never connect this script to a player service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute PIXELPET_TEST_WEB');
const existing = p => realpath(p).catch(e => { if (e.code === 'ENOENT') return resolve(p); throw e; });
assert.notEqual(await realpath(binary), await existing(join(root, 'bin/pixelpet')));
assert.notEqual(await realpath(web), await existing(join(root, 'web/dist')));
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-stars-reaction-')), results = [];
const port = await new Promise((yes, no) => {
  const socket = net.createServer(); socket.once('error', no);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? no(e) : yes(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(r.ok, `${path}: ${await r.clone().text()}`); return r.json();
}
async function seed(species, stage) {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species, name: '接星伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } });
  const fixture = (await api('state')).state;
  Object.assign(fixture.growth, { stage, points: stage === 'baby' ? 0 : stage === 'growing' ? 24 : 72,
    growingAt: stage === 'baby' ? 0 : now - 2000, adultAt: stage === 'adult' ? now - 1000 : 0,
    form: stage === 'adult' ? 'balanced' : '' });
  if (stage !== 'baby') fixture.album.entries.push({ kind: 'growing', at: fixture.growth.growingAt, source: 'saved' });
  if (stage === 'adult') fixture.album.entries.push({ kind: 'adult', at: fixture.growth.adultAt, source: 'saved', form: 'balanced' });
  await api('import', fixture); return api('action', { kind: 'play', requestId: crypto.randomUUID() });
}
async function press(page, name) {
  // Use the physical keys on simulated phones, keyboard on desktop.
  if (page.viewportSize().width < 700) await page.locator(`.button-${name}`).tap();
  else await page.keyboard.press(name);
}
async function key(page, name) {
  await press(page, name);
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function prepareCatch(page, hit = true) {
  let current = await api('state');
  // The target is stable for the whole round. The 900ms beat only drives the
  // visual reaction metadata; it must not decide whether a catch scores.
  const target = current.state.game.round % 3;
  const lane = (target + (hit ? 0 : 1)) % 3;
  const selectedLane = () => page.locator('.game-lane').evaluateAll(nodes => nodes.findIndex(n => n.classList.contains('lane-selected')));
  // Position text may also contain an adult companion's dialogue. Read the
  // selected lane, then finish touch scrolling before observing the catch beat.
  for (let i = 0; i < 3 && await selectedLane() !== lane; i++) await key(page, 'a');
  assert.equal(await selectedLane(), lane);
  if (page.viewportSize().width < 700) await page.locator('.button-b').scrollIntoViewIfNeeded();
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    current = await api('state');
    const elapsed = current.serverTime - current.state.game.startedAt, nextBeat = Math.floor(elapsed / 900);
    if (nextBeat > current.state.game.lastBeat && elapsed % 900 < 200) return current;
    await wait(35);
  }
  assert.fail(`No fresh server beat for lane ${lane}, hit=${hit}`);
}
async function catchStar(page, hit = true) {
  const current = await prepareCatch(page, hit);
  const response = page.waitForResponse(r => r.url() === base + '/api/action' && r.request().postDataJSON().kind === 'catch');
  await press(page, 'b'); const r = await response; assert(r.ok(), await r.text());
  const next = await r.json(); assert.equal(r.request().postDataJSON().gameId, current.state.game.id);
  if (next.state.game) {
    await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
    assert.equal(next.state.game.round, current.state.game.round + 1);
    assert.equal(next.state.game.score, current.state.game.score + (hit ? 1 : 0));
  }
  return next;
}
const active = page => page.locator('.star-game .rig-motion-celebrating.expression-content');
async function quiet(page) { assert.equal(await active(page).count(), 0); }
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError; assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    await wait(100);
  }
  assert(ready, log); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const rigs = ['tanuki', 'bird', 'rabbit', 'dolphin', 'mushroom', 'bear', 'frog', 'cat', 'dragon', 'dog'];
  for (const stage of ['baby', 'growing', 'adult']) for (let species = 0; species < 10; species++) {
    const small = species % 3 !== 0, reduced = species % 2 === 1;
    await seed(species, stage);
    const context = await browser.newContext({ hasTouch: true, viewport: { width: small ? 320 : 1200, height: species % 3 === 2 ? 380 : 800 },
      reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(), writes = [];
    page.on('request', r => { if (r.method() === 'POST') writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    await page.goto(base); await page.locator('.star-game').waitFor();
    if (small) await page.addStyleTag({ content: 'html { font-size:28px !important }' });
    await quiet(page); const before = (await api('state')).state;
    const caught = await catchStar(page); await active(page).waitFor();
    assert.equal(await page.locator(`.star-game .${rigs[species]}-${stage}.rig-motion-celebrating`).count(), 1);
    assert.equal(await page.locator('.physical-button').count(), 3);
    assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const inside = await active(page).evaluate(el => {
      const r = el.getBoundingClientRect(), b = el.closest('.game-lane').getBoundingClientRect();
      return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    });
    assert(inside, 'pet reaction leaves its lane');
    if (reduced) assert(await active(page).evaluate(el => [el, ...el.querySelectorAll('*')].every(n => getComputedStyle(n).animationName === 'none')));
    assert.equal(caught.state.economy.coins, before.economy.coins, 'individual catch must not pay');
    if ([1, 2, 3].includes(species) && stage === 'baby') {
      await page.screenshot({ path: join(dir, `${rigs[species]}-${small ? 'phone' : 'desktop'}-${reduced ? 'reduced' : 'motion'}.png`), fullPage: true });
    }
    await wait(950); await quiet(page);
    await page.reload(); await page.locator('.star-game').waitFor(); await quiet(page);
    assert.equal((await api('state')).state.game.round, 1);
    assert.equal(writes.filter(r => r.path === '/api/action').length, 1);
    results.push({ stage, species, small, reduced, caught: true, reloadNoReplay: true });
    await context.close();
  }
  // Deliberately delay/drop delivery after the real server has accepted a catch.
  for (const fault of ['late', 'unknown']) {
    await seed(2, 'baby'); const page = await browser.newPage(), writes = [];
    page.on('request', r => { if (r.url() === base + '/api/action') writes.push(r.postDataJSON()); });
    await page.goto(base); await page.locator('.star-game').waitFor();
    await page.route('**/api/action', async route => {
      if (route.request().postDataJSON().kind !== 'catch') return route.continue();
      const response = await route.fetch(); assert(response.ok());
      if (fault === 'late') { await wait(2200); await route.fulfill({ response }); }
      else await route.abort('failed');
    });
    if (fault === 'late') { await catchStar(page); await quiet(page); }
    else {
      await prepareCatch(page);
      await key(page, 'b'); await page.locator('.save-recovery').waitFor(); await quiet(page);
      await key(page, 'b'); await page.locator('.star-game').waitFor(); await quiet(page);
    }
    const saved = (await api('state')).state;
    assert.equal(saved.game.round, 1); assert.equal(saved.game.score, 1);
    assert.equal(writes.length, 1, 'no retry of an uncertain catch');
    results.push({ fault, savedCatch: true, noReaction: true, noRetry: true });
    await page.close();
  }
  // Play out an ordinary round with a real miss and final settlement.
  await seed(2, 'baby'); const page = await browser.newPage(), finalWrites = [];
  page.on('request', r => { if (r.url() === base + '/api/action') finalWrites.push(r.postDataJSON()); });
  await page.goto(base); await page.locator('.star-game').waitFor();
  const wallet = (await api('state')).state.economy.coins;
  await catchStar(page); await active(page).waitFor();
  await key(page, 'c'); await page.locator('.game-abandon').waitFor(); await key(page, 'a'); await quiet(page);
  await catchStar(page, false); await quiet(page);
  await catchStar(page); await active(page).waitFor();
  await catchStar(page); await active(page).waitFor();
  const final = await catchStar(page); assert(!final.state.game);
  await page.locator('.pet-scene[data-motion="celebrating"]').waitFor();
  assert.equal(final.state.economy.coins - wallet, 7);
  assert.equal(finalWrites.length, 5);
  assert.equal(new Set(finalWrites.map(r => r.requestId)).size, 5);
  await page.reload(); await page.locator('.pet-scene').waitFor();
  assert.equal((await api('state')).state.economy.coins, final.state.economy.coins);
  results.push({ fullGame: true, hits: 4, misses: 1, awarded: 7, reloadNoExtraReward: true });
  await page.close();
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ scenarios: results.length, artifacts: dir }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await stopped;
  }
  await writeFile(join(dir, 'server.log'), log);
}
