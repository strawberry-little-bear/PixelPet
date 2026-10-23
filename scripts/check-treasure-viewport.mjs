// Real Chrome + real HTTP, ephemeral port/SQLite and isolated build only.
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
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-treasure-viewport-')), results = [];
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
async function seed() {
  const now = Date.now();
  await api('import', { schema: 1, revision: 1, species: 2, name: '寻宝测试伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
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
async function start(page) {
  await selectTreasure(page); await key(page, 'B');
  await page.locator('.game-guide').waitFor();
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
          // A native vertical scrollport makes outer vertical clipping intentional.
          if (['auto', 'scroll'].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight) break;
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
// Do not scroll the target into view in the assertion: the A/B/C action must do it.
async function feedbackVisible(page, selector) {
  const boxes = await page.evaluate(selector => {
    const target = document.querySelector(selector), dock = document.querySelector('.device-buttons');
    if (!target || !dock) return null;
    const a = target.getBoundingClientRect(), b = dock.getBoundingClientRect();
    const lcd = target.closest('.lcd-content')?.getBoundingClientRect();
    const buttons = [...dock.querySelectorAll('button')].map(button => {
      const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return { visible: r.top >= 0 && r.bottom <= innerHeight, clear: hit === button || button.contains(hit) };
    });
    return { lcd: lcd ? {top:lcd.top,bottom:lcd.bottom} : null, target: {top:a.top,bottom:a.bottom}, dock: {top:b.top,bottom:b.bottom}, viewport: innerHeight, buttons };
  }, selector);
  assert(boxes, `missing feedback ${selector}`);
  assert(boxes.target.top >= -1 && boxes.target.bottom <= boxes.dock.top + 1,
    `${selector} not visible above controls: ${JSON.stringify(boxes)}`);
  if (boxes.lcd) assert(boxes.target.top >= boxes.lcd.top - 1 && boxes.target.bottom <= boxes.lcd.bottom + 1,
    `${selector} outside LCD scrollport: ${JSON.stringify(boxes)}`);
  assert(boxes.buttons.every(b => b.visible && b.clear), `covered/offscreen controls: ${JSON.stringify(boxes)}`);
  return boxes;
}
async function initialGridVisible(page) {
  const boxes = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.treasure-grid [role=row]')];
    const dock = document.querySelector('.device-buttons');
    if (rows.length !== 3 || !dock) return null;
    const last = rows.at(-1).getBoundingClientRect(), controls = dock.getBoundingClientRect();
    return { lastRow: { top: last.top, bottom: last.bottom }, dock: { top: controls.top, bottom: controls.bottom }, scrollY };
  });
  assert(boxes, 'missing initial treasure grid or key dock');
  assert(boxes.lastRow.bottom >= boxes.lastRow.top && boxes.lastRow.top < boxes.dock.bottom,
    `initial treasure grid is missing from the LCD flow: ${JSON.stringify(boxes)}`);
  return boxes;
}
// Reading can scroll beyond the auto-positioned result. Verify that even the
// final line of the longer reward explanation can be reached inside the LCD.
async function ruleEndVisible(page) {
  await page.locator('.treasure-rule').evaluate(el => {
    el.scrollIntoView({block:'end'});
    const dock=document.querySelector('.device-buttons').getBoundingClientRect();
    window.scrollBy(0,Math.max(0,el.getBoundingClientRect().bottom-dock.top+12));
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const boxes=await page.locator('.treasure-rule').evaluate(el=>{
    const text=el.lastChild, range=document.createRange();
    range.setStart(text,text.length-1);range.setEnd(text,text.length);
    const last=range.getBoundingClientRect(),dock=document.querySelector('.device-buttons').getBoundingClientRect();
    const lcd=el.closest('.lcd-content').getBoundingClientRect();
    return {top:last.top,bottom:last.bottom,dockTop:dock.top,lcdTop:lcd.top,lcdBottom:lcd.bottom};
  });
  assert(boxes.top>=Math.max(0,boxes.lcdTop)-1&&boxes.bottom<=Math.min(boxes.dockTop,boxes.lcdBottom)+1,`last rule line hidden by controls: ${JSON.stringify(boxes)}`);
  return boxes;
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error',error=>{startupError=error});
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready=false;
  for(let i=0;i<100;i++){
    if(startupError || server.exitCode!==null)break;
    try{if((await fetch(base+'/api/state')).ok){ready=true;break}}catch{}
    await wait(100);
  }
  assert(ready, `isolated server did not start: ${startupError ?? log}`);
  browser = await chromium.launch({channel:'chrome', headless:true});
  for (const [width,height,font,forced] of [[1200,700,14,false],[1200,700,28,false],[900,1000,14,false],[320,700,14,false],[320,700,28,false],[320,380,14,false],[320,380,28,true]]) {
    await seed();
    const ctx = await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width===320,reducedMotion:width===1200&&font===14?'no-preference':'reduce',forcedColors:forced?'active':'none'});
    const page=await ctx.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=`${font}px`),font);
    await page.goto(base); await start(page);
    let initial = null;
    if (width === 900 && height === 1000 && font === 14) {
      await page.evaluate(() => window.scrollTo(0, 0));
      initial = await initialGridVisible(page);
    }
    await key(page,'C');
    const resume = await feedbackVisible(page,'.treasure-grid [aria-selected=true]');
    // Native Enter/Space activation keeps focus on the same physical A button.
    await page.locator('.button-a').focus();
    for (const keyName of ['Enter','Space']) {
      await page.keyboard.press(keyName);
      await feedbackVisible(page,'.treasure-grid [aria-selected=true]');
      assert(await page.locator('.button-a').evaluate(el=>el===document.activeElement),'focus moved from physical A');
    }
    for (let n=0;n<10;n++) { await key(page,'A'); await feedbackVisible(page,'.treasure-grid [aria-selected=true]'); }
    await page.screenshot({path:join(dir,`selected-${width}-${height}-${font}.png`)});
    // Synthetic explicit rejection: do not hide errors below the document or cover keys.
    const beforeReject=(await api('state')).state.game.treasure.opened.length;
    await page.route('**/api/action', route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'没有保存本次探索，请重试。'})}),{times:1});
    await key(page,'B'); await page.locator('.toast.error').waitFor();
    await feedbackVisible(page,'.toast.error');
    assert.equal((await api('state')).state.game.treasure.opened.length,beforeReject,'rejection advanced progress');
    assert.equal(await page.locator('.treasure-result').count(),0,'rejection invented a result');
    await page.screenshot({path:join(dir,`rejected-${width}-${height}-${font}.png`)});
    await page.getByRole('button',{name:'关闭提示'}).click();
    await key(page,'B'); await feedbackVisible(page,'.treasure-result');
    await page.screenshot({path:join(dir,`result-${width}-${height}-${font}.png`)});
    // A normal state read must not hijack document reading after an action.
    await page.evaluate(()=>{window.scrollTo(0,0);window.__jumps=0;const original=window.scrollBy;window.scrollBy=function(...args){window.__jumps++;return original.apply(this,args)}});
    await wait(5500); assert.equal(await page.evaluate(()=>window.__jumps),0,'poll replayed navigation');
    assert.equal(await page.evaluate(()=>scrollY),0);
    await key(page,'C'); await page.locator('.treasure-pause').waitFor();
    await key(page,'A'); await key(page,'B'); await page.locator('.game-guide').waitFor();
    assert.equal(await page.locator('.treasure-mode').count(),0,'dock leaked into rules');
    await key(page,'C'); await page.locator('.treasure-pause').waitFor();
    await key(page,'C'); await feedbackVisible(page,'.treasure-grid [aria-selected=true]');
    await page.reload(); await page.locator('.treasure-pause').waitFor();
    const count=(await api('state')).state.game.treasure.opened.length;
    await wait(100); assert.equal((await api('state')).state.game.treasure.opened.length,count);
    await key(page,'C'); await feedbackVisible(page,'.treasure-grid [aria-selected=true]');
    for (let attempt=0;attempt<6;attempt++) {
      if (await page.locator('.treasure-game').getAttribute('data-done') === 'true') break;
      await key(page,'B');
      const done=await page.locator('.treasure-game').getAttribute('data-done')==='true';
      await feedbackVisible(page,done?'.treasure-status':'.treasure-result');
    }
    assert.equal(await page.locator('.treasure-game').getAttribute('data-done'),'true','six accepted explorations must end the game');
    await readable(page); await page.screenshot({path:join(dir,`done-${width}-${height}-${font}.png`)});
    const ruleEnd=await ruleEndVisible(page);
    await page.screenshot({path:join(dir,`rule-${width}-${height}-${font}.png`)});
    await key(page,'B'); await page.locator('.home-caption').waitFor();
    assert.equal(await page.locator('.treasure-mode').count(),0,'dock leaked outside treasure');
    assert.deepEqual(errors, [], 'browser runtime errors');
    results.push({width,height,font,forced,initial,resume,ruleEnd}); await ctx.close();
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({dir,groups:results.length,results},null,2));
} finally {
  if(browser)await browser.close();
  if(server&&server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed}
}
