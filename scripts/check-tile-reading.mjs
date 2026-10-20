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
      const page = await context.newPage(), errors = [], writes = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('request', r => { if (r.method() === 'POST') writes.push(new URL(r.url()).pathname); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
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
      // A confirmed network write temporarily disables native keys; focus can
      // leave B in Chrome. This batch does not change that shared focus policy.
      assert((await page.locator('.tile-status').textContent()).includes('已选第 1 格'));
      await visibleFeedback(page, '.tile-message');
      const other = tiles.findIndex(v => v !== tiles[0]); await move(page,other); await key(page,'b');
      assert.equal(await page.locator('.tile-cell.picked').getAttribute('data-cell'),'0');
      assert.deepEqual(await board(page),tiles); await visibleFeedback(page, '.tile-message');
      await page.screenshot({path:join(artifacts,mode.name+'-selected.png'),fullPage:false});
      await key(page,'c'); assert.equal(await page.locator('.tile-cell.picked').count(),0);
      await visibleFeedback(page, '.tile-message'); await key(page,'b');
      await page.reload(); await page.locator('.tile-board').waitFor();
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
      for (let pair=0;pair<8;pair++) {
        const values = await board(page); let match;
        for (let a=0;a<16 && !match;a++) for(let b=a+1;b<16;b++) {
          if(values[a] && values[a] === values[b] && legal(values,a,b)) { match=[a,b]; break; }
        }
        assert(match,'server must preserve a playable board');
        await move(page,match[0]); await key(page,'b'); await move(page,match[1]); await key(page,'b');
        if(pair<7) { await visibleFeedback(page, '.tile-message'); assert.deepEqual((await inspect(page)).clipped,[]); }
      }
      await page.locator('.content-home').waitFor();
      const after = (await api('state')).state;
      assert(!after.game); assert.equal(after.economy.coins,before.economy.coins+6);
      assert.equal(after.careCount,before.careCount+1); assert.deepEqual(errors,[]);
      await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
    } finally { await context.close(); }
  }
  console.log(`Tile reading and real three-key completion: ${results.length} modes passed. ${artifacts}`);
} finally {
  if(browser) await browser.close();
  if(server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit',resolve)); }
  await writeFile(join(artifacts,'server.log'),log);
}
