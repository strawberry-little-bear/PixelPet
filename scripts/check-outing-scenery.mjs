// Fictional scenery: isolated response fixtures + a natural full walk.
// Fixtures test layout, not random outcomes or actual server advancement.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-outing-scenery-')), results = [];
const port = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed() {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '试玩伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
}
async function key(page, key) {
  await page.locator(`.button-${key.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function readable(page, selector) {
  const failures = await page.locator(selector).evaluate(el => {
    const bounds = document.querySelector('.lcd-content').getBoundingClientRect();
    const footer = document.querySelector('.lcd-bottom').getBoundingClientRect();
    const failures = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.top < bounds.top - 1 || box.bottom > Math.min(bounds.bottom, footer.top) + 1 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({ text: node.textContent, reason: 'outside game content / overlaps footer' });
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if ((['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) &&
            (box.left < clip.left - 1 || box.right > clip.right + 1)) ||
            (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
            (box.top < clip.top - 1 || box.bottom > clip.bottom + 1))) {
            failures.push({ text: node.textContent, parent: parent.className }); break;
          }
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal page overflow');
    return failures;
  });
  assert.deepEqual(failures, [], `${selector}: clipped text`);
  assert.equal(await page.locator('.physical-button').count(), 3);
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,[data-guide] [tabindex]').count(), 0);
}
async function enter(page, index) {
  await page.locator('.home-caption').waitFor();
  for (const k of ['A', 'A', 'B', ...Array(index).fill('A'), 'B', 'B']) await key(page, k);
}
async function scene(page) { return page.locator('.outing-caption').getAttribute('data-scenery'); }
async function check(page, kind) {
  await readable(page, kind === 'fishing' ? '.fishing-game' : '.walking-game');
  assert.equal(await page.locator('.outing-caption').count(), 1);
  const overlaps = await page.locator('.outing-compact:visible').evaluateAll(labels => labels.flatMap(label => {
    const a = label.getBoundingClientRect();
    return [...label.parentElement.querySelectorAll('.park-obstacle,.fishing-bite')].filter(el => {
      const b = el.getBoundingClientRect(); return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    }).map(el => el.className);
  }));
  assert.deepEqual(overlaps, [], 'Scenery must not obscure an obstacle / bite');
  assert((await page.locator('.outing-label').innerText()).includes('虚构风景'));
  assert.equal(await page.locator('.outing-sky').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  assert.equal(await page.locator('.outing-caption').evaluate(el => !!el.closest('[role=status],[aria-live]')), false);
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
  // Obtain valid envelopes via genuine A/B/C starts in a disposable save.
  const real = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const realPage = await real.newPage(), realErrors = [], realWrites = [], templates = {};
  realPage.on('pageerror', e => realErrors.push(e.message));
  realPage.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/action') realWrites.push(r.postDataJSON()); });
  for (const [kind, index] of [['fishing', 4], ['walk', 5]]) {
    await seed(); await realPage.goto(base); await enter(realPage, index);
    await realPage.locator(kind === 'walk' ? '.walking-game' : '.fishing-game').waitFor();
    templates[kind] = await api('state');
  }
  // Fixture matrix: 48 combinations, 2 games, 4 viewport/font pairs, paused and active.
  // Only intercepted test responses change; this is not natural play / randomness evidence.
  for (const width of [1200, 320]) for (const font of [14, 28]) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: true, isMobile: width < 700,
      reducedMotion: width === 320 ? 'reduce' : 'no-preference', forcedColors: font === 28 ? 'active' : 'none' });
    const page = await ctx.newPage(), errors = []; let fixture;
    page.on('pageerror', e => errors.push(e.message));
    await ctx.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), font);
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!['/api/state', '/api/visit', '/api/action'].includes(path)) return route.continue();
      if (path === '/api/action') {
        const action = route.request().postDataJSON(), n = fixture.state.game.fishing ?? fixture.state.game.walking;
        assert(['fish-resume', 'walk-resume', 'fish-step', 'walk-step'].includes(action.kind), `Unexpected fixture action ${action.kind}`);
        n.paused = false; n.step++; fixture.state.revision++;
      }
      fixture.serverTime = Date.now(); fixture.state.lastTick = fixture.serverTime;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    try {
      console.log('FIXTURES', width, font);
      for (const kind of ['fishing', 'walk']) for (let index = 0; index < 48; index++) {
        fixture = structuredClone(templates[kind]);
        fixture.state.game.id = index.toString(16).padStart(6, '0') + '0'.repeat(26);
        const n = fixture.state.game.fishing ?? fixture.state.game.walking;
        Object.assign(n, { paused: true, ...(kind === 'fishing' ? { phase: 'wait', casts: 1, waitMs: 32000, candidate: 'reed-minnow' } : { route: Array(12).fill('branch') }) });
        await page.goto(base); await page.locator('.outing-caption:not(.outing-compact)').waitFor();
        const keyBefore = await scene(page); await check(page, kind);
        const seasonal = ['新芽把沿途染成浅绿。', '树荫留出一小片清凉。', '落叶给沿途添了暖色。', '远处的树披着淡淡冬色。'];
        const dialogue = ['伙伴说：“有你在，开头就很好。”', '伙伴说：“平常的一刻也值得记住。”', '伙伴说：“晚霞再美，也不必赶着看。”', '伙伴说：“月色安静，我们也慢慢来。”'];
        const story = await page.locator('.outing-caption > span').nth(1).innerText();
        assert(story.includes(seasonal[Math.floor(index / 3) % 4]));
        assert(story.includes(dialogue[Math.floor(index / 12)]));
        // reading-mode overrides the game caption's 8px with rem-based text.
        // Verify actual rendered spans, not just the root font or the container.
        const sizes = await page.locator('.outing-caption > span').evaluateAll(spans => spans.map(el => parseFloat(getComputedStyle(el).fontSize)));
        assert(sizes.every(size => Math.abs(size - (font === 28 ? 24 : 12)) < 0.01));
        assert.equal(await page.locator('.outing-caption > span').count(), 2);
        if (index === 47) await page.screenshot({ path: join(dir, `${kind}-dialogue-paused-${width}-${font}.png`), fullPage: true });
        await key(page, 'C'); await page.locator('.outing-compact').waitFor();
        assert.equal(await scene(page), keyBefore); assert.equal(await page.locator('.outing-caption > span').count(), 1);
        await check(page, kind);
        if ([2, 47].includes(index)) await page.screenshot({ path: join(dir, `${kind}-${index}-${width}-${font}.png`), fullPage: true });
        results.push({ type: 'response-fixture', width, font, kind, index, key: keyBefore, states: ['paused', 'active'] });
      }
      // Long copy/results, every actor, invalid-id legacy fallback. Distinct from the 48-scene matrix.
      for (const kind of ['fishing', 'walk']) for (let species = 0; species < 10; species++) {
        fixture = structuredClone(templates[kind]); fixture.state.species = species;
        fixture.state.game.id = '00002f' + '0'.repeat(26);
        const n = fixture.state.game.fishing ?? fixture.state.game.walking;
        if (kind === 'fishing') Object.assign(n, { phase: 'done', casts: 3, outcome: 'early' });
        else Object.assign(n, { beat: 72 });
        await page.goto(base); await page.locator('.outing-caption:not(.outing-compact)').waitFor();
        await check(page, kind);
        results.push({ type: 'result-fixture', width, font, kind, species });
      }
      for (const kind of ['fishing', 'walk']) {
        fixture = structuredClone(templates[kind]); delete fixture.state.game.id;
        await page.goto(base); await page.locator(kind === 'fishing' ? '.fishing-game' : '.walking-game').waitFor();
        assert.equal(await page.locator('.outing-caption,.outing-sky').count(), 0);
        await readable(page, kind === 'fishing' ? '.fishing-game' : '.walking-game');
        results.push({ type: 'legacy-fixture', width, font, kind });
      }
      assert.deepEqual(errors, []);
    } catch (e) {
      await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
      await writeFile(join(dir, 'failure.json'), JSON.stringify({ fixture, errors, dom: await page.locator('.device').innerText() }, null, 2));
      console.error('Artifacts:', dir); throw e;
    } finally { await ctx.close(); }
  }
  // Genuine server walk, no altered clock or responses. Paused while fixture browser was running.
  console.log('NATURAL WALK');
  const initial = await scene(realPage), initialGame = (await api('state')).state.game;
  await check(realPage, 'walk'); await key(realPage, 'C');
  await realPage.locator('.park-scene[data-pose="moving"]').waitFor();
  await wait(2200); await key(realPage, 'A'); await wait(250); await key(realPage, 'B'); await key(realPage, 'C');
  await realPage.locator('.walk-pause').waitFor();
  const paused = (await api('state')).state.game.walking;
  assert(paused.paused); assert(paused.beat >= 2); assert.equal(await scene(realPage), initial);
  await realPage.reload(); await realPage.locator('.walk-pause').waitFor();
  assert.equal(await scene(realPage), initial); await wait(1300);
  assert.deepEqual((await api('state')).state.game.walking, paused);
  // Pause menu -> actual discovery page -> return, no automatic resumption.
  await key(realPage, 'A'); await key(realPage, 'B'); await realPage.locator('.park-album').waitFor();
  await key(realPage, 'C'); await realPage.locator('.walk-pause').waitFor();
  await wait(1200); assert.deepEqual((await api('state')).state.game.walking, paused);
  await key(realPage, 'C'); await realPage.locator('.park-scene[data-pose="moving"]').waitFor();
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const n = (await api('state')).state.game.walking;
    if (n.beat === 72) break;
    assert.equal(await scene(realPage), initial); await check(realPage, 'walk'); await wait(750);
  }
  const completed = (await api('state')).state;
  assert.equal(completed.game.walking.beat, 72); assert.equal(completed.economy.coins, 0);
  assert.equal(completed.park.finds.reduce((sum, d) => sum + d.count, 0), 3);
  assert.equal(completed.game.id, initialGame.id); assert.equal(await scene(realPage), initial);
  await check(realPage, 'walk'); await realPage.screenshot({ path: join(dir, 'natural-walk-done.png'), fullPage: true });
  await key(realPage, 'B'); await realPage.locator('.home-caption').waitFor();
  const collected = (await api('state')).state;
  assert(!collected.game); assert.equal(collected.park.walks, 1);
  assert.equal(collected.economy.coins, 3 + Math.floor(completed.game.walking.cleared / 4));
  assert.deepEqual(collected.park.finds, completed.park.finds); assert.deepEqual(realErrors, []);
  results.push({ type: 'natural-walk', key: initial, writes: realWrites.map(a => a.kind), coins: collected.economy.coins });
  await real.close();
  await writeFile(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ groups: results.length, artifacts: dir, port }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
