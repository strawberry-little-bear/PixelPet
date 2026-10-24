// Controlled three-key self-test, not a natural blind playthrough or screen-reader certification.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-tile-reading-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [], wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed() {
  const now = Date.now();
  return api('import', { schema: 1, revision: 1, species: 2, name: '连连看测试伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
}
async function key(page, name) {
  await page.locator('.button-' + name + ':not(:disabled)').tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function board(page) { return page.locator('.tile-cell').evaluateAll(cells => cells.map(e => +e.dataset.tile)); }
async function move(page, target) {
  for (let i = 0; i < 16; i++) {
    if (+(await page.locator('.tile-cell.cursor').getAttribute('data-cell')) === target) return;
    await key(page, 'a');
  }
  assert.fail('could not select target');
}
// Find a legal pair for controlled completion; never exposed as a player hint.
function legal(board, a, b) {
  const point = i => [(i % 4) + 1, Math.floor(i / 4) + 1];
  const [sx, sy] = point(a), [tx, ty] = point(b), queue = [[sx, sy, -1, 0]], best = new Map();
  for (let head = 0; head < queue.length; head++) {
    const [x, y, direction, turns] = queue[head];
    for (const [d, [dx, dy]] of [[0,[1,0]], [1,[0,1]], [2,[-1,0]], [3,[0,-1]]]) {
      const nx = x+dx, ny = y+dy, count = turns + (direction >= 0 && direction !== d ? 1 : 0);
      if (count > 2 || nx < 0 || nx > 5 || ny < 0 || ny > 5) continue;
      if (nx === tx && ny === ty) return true;
      if (nx >= 1 && nx <= 4 && ny >= 1 && ny <= 4 && board[(ny-1)*4+nx-1]) continue;
      const k = `${nx},${ny},${d}`;
      if ((best.get(k) ?? 3) <= count) continue;
      best.set(k, count); queue.push([nx,ny,d,count]);
    }
  }
  return false;
}
// Synthetic interruption boundaries, not a real OS/mobile background test.
async function interrupt(page, kind, active = false) {
  if (kind === 'abandon') {
    if (active) assert.equal(await page.locator('.collected-tile').count(), 1);
    await key(page, 'c'); await page.locator('.game-abandon').waitFor();
    await key(page, 'a'); await page.locator('.tile-board').waitFor();
    assert.equal(await page.locator('.collected-tile,.tile-link,.tile-companion[data-motion="collecting"]').count(), 0);
    return;
  }
  const wasCollecting = await page.evaluate(kind => {
    const collecting = !!document.querySelector('.collected-tile');
    if (kind === 'blur') window.dispatchEvent(new Event('blur'));
    else if (kind === 'hidden') {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    } else document.querySelector(kind === 'help' ? '[aria-label="玩法说明"]' : '.backup-button').click();
    return collecting;
  }, kind);
  if (active) assert(wasCollecting, 'interruption must occur during collection, not after its timeout');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.collected-tile,.tile-link,.tile-companion[data-motion="collecting"]').count(), 0,
    'interruption clears collection before its ordinary 850ms expiry');
  await page.evaluate(kind => {
    if (kind === 'blur') window.dispatchEvent(new Event('focus'));
    else if (kind === 'hidden') {
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    } else document.querySelector(kind === 'help' ? '[aria-label="关闭"]' : '.backup-button').click();
  }, kind);
}
async function observeCollection(page) {
  await page.evaluate(() => {
    window.tileFeedbackObserver?.disconnect(); window.tileCollectionSeen = false;
    window.tileFeedbackObserver = new MutationObserver(() => {
      if (document.querySelector('.collected-tile,.tile-link,.tile-companion[data-motion="collecting"]')) window.tileCollectionSeen = true;
    });
    window.tileFeedbackObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}
async function delayedMatch(page, kind, pairs) {
  let release, acknowledge, reject;
  const gate = new Promise(r => { release = r; });
  const committed = new Promise((resolve, fail) => { acknowledge = resolve; reject = fail; });
  const handler = async route => {
    try {
      const response = await route.fetch();
      const payload = await response.json();
      assert(response.ok(), JSON.stringify(payload)); assert(payload.tileLink?.length);
      assert.equal(payload.state.game.tiles.pairs, pairs);
      acknowledge(payload); await gate; await route.fulfill({ response });
    } catch (e) { reject(e); }
  };
  await page.route('**/api/action', handler);
  try {
    await observeCollection(page);
    await page.locator('.button-b:not(:disabled)').tap();
    const confirmed = await committed;
    assert.equal(+(await page.locator('.tile-game').getAttribute('data-pairs')), pairs - 1);
    assert.equal((await api('state')).state.game.tiles.pairs, pairs, 'write must precede released acknowledgment');
    await interrupt(page, kind);
    const scrollCalls = await page.evaluate(() => window.tileViewportCalls); release();
    await page.waitForFunction(pairs => +document.querySelector('.tile-game')?.dataset.pairs === pairs && !document.querySelector('.button-b')?.disabled, pairs);
    assert.equal(await page.evaluate(() => window.tileCollectionSeen), false, `late collection replay after ${kind}`);
    // Native anchoring can move scrollY when the saved result wraps differently.
    assert.equal(await page.evaluate(() => window.tileViewportCalls), scrollCalls, 'no stale programmatic viewport reveal');
    assert.deepEqual(await board(page), confirmed.state.game.tiles.board);
    assert.equal(await page.locator('.collected-tile,.tile-link').count(), 0);
  } finally { release(); await page.unroute('**/api/action', handler); }
}
async function inspect(page) {
  return page.locator('.tile-game').evaluate(el => {
    const lcd = document.querySelector('.lcd-content').getBoundingClientRect(), issues = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || node.parentElement.closest('svg')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < lcd.left - 1 || box.right > lcd.right + 1 || box.top < lcd.top - 1 || box.bottom > lcd.bottom + 1) issues.push(node.textContent);
        for (let p = node.parentElement; p && p !== el.parentElement; p = p.parentElement) {
          const style = getComputedStyle(p), clip = p.getBoundingClientRect();
          if (['hidden','clip'].includes(style.overflowY) && (box.top < clip.top-1 || box.bottom > clip.bottom+1)) issues.push(node.textContent);
        }
      }
    }
    return {
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      statusFont: parseFloat(getComputedStyle(el.querySelector('.tile-status')).fontSize),
      messageFont: parseFloat(getComputedStyle(el.querySelector('.tile-message')).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped: [...new Set(issues)],
    };
  });
}
async function visibleFeedback(page, selector = ".tile-status") {
  const layout = await page.evaluate(selector => {
    const status = document.querySelector(selector).getBoundingClientRect(), dock = document.querySelector('.device-buttons').getBoundingClientRect();
    return { top: status.top, bottom: status.bottom, dock: dock.top, viewport: innerHeight,
      clearKeys: [...document.querySelectorAll('.physical-button')].every(e => {
        const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        return r.top >= 0 && r.bottom <= innerHeight && (e === hit || e.contains(hit));
      }) };
  }, selector);
  assert(layout.top >= 0 && layout.bottom <= Math.min(layout.viewport, layout.dock), JSON.stringify(layout));
  assert(layout.clearKeys, JSON.stringify(layout));
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir,'test.db'), PIXELPET_WEB: web }, stdio: ['ignore','pipe','pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i=0;i<100;i++) {
    if (startupError) throw startupError; if (server.exitCode !== null) throw Error(log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log);
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const mode of [
    {name:'desktop',width:1200,height:900,font:14}, {name:'desktop-large',width:1200,height:900,font:28},
    {name:'phone',width:320,height:480,font:14}, {name:'phone-large-contrast',width:320,height:480,font:28,contrast:true},
  ]) {
    await seed();
    const context = await browser.newContext({ viewport: {width:mode.width,height:mode.height}, hasTouch:true,
      forcedColors: mode.contrast ? 'active' : 'none', reducedMotion:'reduce' });
    try {
      const page = await context.newPage(), errors = [], writes = [], actionWrites = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => {
        if (r.method() !== 'POST') return;
        const path = new URL(r.url()).pathname; writes.push(path);
        if (path === '/api/action') actionWrites.push(r.postDataJSON());
      });
      await page.addInitScript(font => {
        const originalScrollBy = window.scrollBy.bind(window); window.tileViewportCalls = 0;
        window.scrollBy = (...args) => { window.tileViewportCalls++; return originalScrollBy(...args); };
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; });
      }, mode.font);
      await page.goto(base); await page.locator('.home-caption').waitFor();
      for (const k of ['a','a','b','a','b','b']) await key(page,k);
      await page.locator('.tile-board').waitFor();
      const layout = await inspect(page); results.push({mode:mode.name,...layout});
      await writeFile(join(artifacts,'results.json'), JSON.stringify(results,null,2));
      await page.screenshot({path:join(artifacts,mode.name+'.png'),fullPage:true});
      assert(layout.statusFont >= layout.rootFont*.85 && layout.messageFont >= layout.rootFont*.85, JSON.stringify(layout));
      assert(!layout.overflow); assert.deepEqual(layout.clipped, []);
      const desc = page.locator('.tile-board desc');
      assert.equal((await desc.textContent()).match(/第 \d+ 格/g)?.length,16);
      assert.equal(await page.locator('.physical-button').count(),3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(),0);
      const before = (await api('state')).state, tiles = await board(page);
      await move(page,0);
      const selectWrites = writes.length;
      await page.locator('.button-b').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
      assert.equal(writes.length,selectWrites+1);
      assert(await page.locator(".button-b").evaluate(el => el === document.activeElement),
        "confirmed tile selection must recover the disabled native B focus");
      assert((await page.locator('.tile-status').textContent()).includes('已选第 1 格'));
      await visibleFeedback(page, '.tile-message');
      const other = tiles.findIndex(v => v !== tiles[0]); await move(page,other); await key(page,'b');
      assert.equal(await page.locator('.tile-cell.picked').getAttribute('data-cell'),'0');
      assert.deepEqual(await board(page),tiles); await visibleFeedback(page, '.tile-message');
      const note = page.locator('.tile-hint-note'); await note.waitFor();
      const explanation = await note.textContent();
      assert.match(explanation, /示例：第 \d+ 格（\d 行 \d 列）和第 \d+ 格（\d 行 \d 列）·/);
      assert.match(explanation, /直线连通|拐 [12] 次弯/);
      assert.match(explanation, /文字保留到下次选牌/);
      assert.equal(await note.locator('..').getAttribute('aria-live'), 'polite');
      assert.equal(await note.locator('..').getAttribute('aria-atomic'), 'true');
      const trace = page.locator('.tile-hint');
      assert.equal(await trace.count(), 1, 'inspect reduced-motion/contrast styles before the trace fades');
      {
        assert.equal(await trace.evaluate(el => getComputedStyle(el).animationName), 'none');
        if (mode.contrast) {
          const colors = await trace.evaluate(el => {
            const sample = document.createElement('span'); sample.style.color = 'LinkText'; document.body.append(sample);
            const expected = getComputedStyle(sample).color; sample.remove();
            return {stroke:getComputedStyle(el).stroke, opacity:getComputedStyle(el).opacity, expected};
          });
          assert.equal(colors.stroke, colors.expected); assert.equal(colors.opacity, '1');
        }
      }
      await page.waitForFunction(() => !document.querySelector('.tile-hint'));
      assert.equal(await note.textContent(), explanation, 'fading must leave live text unchanged');
      assert.deepEqual((await inspect(page)).clipped, []);
      assert.equal((await inspect(page)).overflow, false);
      // Explicit scripted reading, not an automatic scroll or real screen reader.
      // Every wrapped line must be reachable above the sticky three-key dock.
      const lines = await note.evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), boxes = []; let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width && r.height)
            boxes.push({left:r.left,right:r.right,top:r.top+scrollY,bottom:r.bottom+scrollY});
        }
        return boxes;
      });
      assert(lines.length > 0);
      for (const line of lines) {
        const visible = await page.evaluate(line => {
          window.scrollTo({top:line.top-16,behavior:'instant'});
          const y = (line.top+line.bottom)/2-scrollY, x = (line.left+line.right)/2;
          const dock = document.querySelector('.device-buttons').getBoundingClientRect();
          return line.top-scrollY >= 0 && line.bottom-scrollY <= Math.min(innerHeight,dock.top) &&
            !!document.elementFromPoint(x,y)?.closest('.tile-hint-note');
        }, line);
        assert(visible, `hint line obscured by dock: ${JSON.stringify({mode:mode.name,line})}`);
      }
      results.at(-1).hint = {text:explanation,readableLines:lines.length,reducedMotion:true,forcedColors:!!mode.contrast};
      await note.evaluate(el => el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.screenshot({path:join(artifacts,mode.name+'-hint.png'),fullPage:true});
      const hintWrites = writes.length; await key(page,'a');
      assert.equal(await note.textContent(), explanation, 'cursor navigation is read-only and retains the example');
      assert.equal(writes.length, hintWrites);
      await move(page,other);
      await page.screenshot({path:join(artifacts,mode.name+'-selected.png'),fullPage:false});
      await key(page,'c'); assert.equal(await page.locator('.tile-cell.picked').count(),0);
      assert.equal(await note.count(),0, 'C clearing a selection clears the example');
      await visibleFeedback(page, '.tile-message'); await key(page,'b');
      await page.reload(); await page.locator('.tile-board').waitFor();
      assert.equal(await note.count(),0, 'refresh cannot reconstruct a local example');
      assert.equal(await page.locator('.tile-cell.picked').getAttribute('data-cell'),String(other));
      assert((await page.locator('.tile-status').textContent()).includes(`已选第 ${other+1} 格`));
      const readWrites = writes.length;
      await page.evaluate(() => { window.scrollTo(0,0); document.querySelector('.button-a').focus({preventScroll:true}); });
      const scroll = await page.evaluate(() => scrollY); await wait(5500);
      assert.equal(await page.evaluate(() => scrollY),scroll); assert.equal(writes.length,readWrites);
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('button-a')),true);
      const cursorBefore = +(await page.locator('.tile-cell.cursor').getAttribute('data-cell'));
      await page.keyboard.press('Space');
      assert.equal(+(await page.locator('.tile-cell.cursor').getAttribute('data-cell')),(cursorBefore+1)%16);
      assert.equal(writes.length,readWrites); await visibleFeedback(page);
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('button-a')),true);
      await key(page,'c'); await key(page,'c'); await page.locator('.game-abandon').waitFor();
      await key(page,'a'); await page.locator('.tile-board').waitFor(); await visibleFeedback(page);
      assert.deepEqual(await board(page),tiles);
      assert.equal((await api('state')).state.economy.coins,before.economy.coins);
      // Complete the genuine random board through the same three physical keys.
      const completionActions = actionWrites.length;
      const activeKinds = mode.name === 'desktop-large' ? ['blur','abandon'] : mode.width > 700 ? ['blur','hidden'] : ['help','tools'];
      for (let pair=0;pair<8;pair++) {
        const values = await board(page); let match;
        for (let a=0;a<16 && !match;a++) for(let b=a+1;b<16;b++) {
          if(values[a] && values[a] === values[b] && legal(values,a,b)) { match=[a,b]; break; }
        }
        assert(match,'server must preserve a playable board');
        await move(page,match[0]); await key(page,'b'); await move(page,match[1]);
        const matchWrites = actionWrites.length;
        if (pair >= 1 && pair <= 4) await delayedMatch(page, ['blur', 'hidden', 'help', 'tools'][pair - 1], pair + 1);
        else {
          await key(page,'b');
          if (pair >= 5 && pair < 7) {
            await page.locator('.collected-tile').waitFor();
            await interrupt(page, activeKinds[pair - 5], true);
            assert.equal(await page.locator('.collected-tile,.tile-link').count(), 0);
          }
        }
        assert.equal(actionWrites.length, matchWrites + 1, 'no retry or pause action from a tile interruption');
        if(pair<7) {
          // Check an ordinary live match before testing interruptions. Returning
          // from a window/modal leaves reading to the player, not a stale reveal.
          if (pair === 0) {
            await visibleFeedback(page, '.tile-message');
            await page.locator('.collected-tile').waitFor({ state: 'hidden' });
          }
          assert.deepEqual((await inspect(page)).clipped,[]);
          const state = (await api('state')).state;
          assert.equal(state.game.tiles.pairs, pair + 1);
          assert.equal(state.economy.coins,before.economy.coins); assert.equal(state.careCount,before.careCount);
          if (pair === 4) {
            await page.screenshot({path:join(artifacts,mode.name+'-late-feedback.png'),fullPage:true});
            // Explicit scripted reading, not an automatic reveal after interruption.
            await page.locator('.tile-message').evaluate(el => {
              el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -12, behavior: 'instant' });
            });
            await visibleFeedback(page, '.tile-message');
            await page.screenshot({path:join(artifacts,mode.name+'-read-message.png'),fullPage:false});
            await page.reload(); await page.locator('.tile-board').waitFor();
            assert.equal(await page.locator('.collected-tile,.tile-link').count(),0);
            assert.equal(+(await page.locator('.tile-game').getAttribute('data-pairs')),5);
          }
        }
      }
      assert.deepEqual(actionWrites.slice(completionActions).map(a => a.kind), Array(16).fill('tile-pick'));
      await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins,before.economy.coins+6);
      assert.equal(after.careCount,before.careCount+1); assert.deepEqual(errors,[]);
      await page.reload(); await page.locator('.content-home').waitFor();
      const reread = (await api('state')).state;
      assert.equal(reread.economy.coins, after.economy.coins); assert.equal(reread.careCount, after.careCount);
      results.at(-1).feedback = { delayed: ['blur','hidden','help','tools'], active: activeKinds, pairs: 8, coins: 6, care: 1 };
      await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
    } finally { await context.close(); }
  }
  console.log(`Tile reading and real three-key completion: ${results.length} modes passed. ${artifacts}`);
} finally {
  if(browser) await browser.close();
  if(server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit',resolve)); }
  await writeFile(join(artifacts,'server.log'),log);
}
