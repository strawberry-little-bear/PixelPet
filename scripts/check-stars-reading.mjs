// Controlled three-key journey; not natural long-play or screen-reader certification.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-stars-reading-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, results = [], wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const response = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.ok, await response.clone().text()); return response.json();
}
async function key(page, name) {
  await page.locator('.button-' + name + ':not(:disabled)').tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
async function inspect(page) {
  return page.locator('.star-game').evaluate(el => {
    const lcd = document.querySelector('.lcd-content').getBoundingClientRect(), clipped = [];
    for (const node of el.querySelectorAll('.game-score strong,.game-score span,.star-position,.star-method,.game-message')) {
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        let scrollport = null;
        for (let p=node.parentElement;p;p=p.parentElement) {
          const style=getComputedStyle(p), r=p.getBoundingClientRect();
          if (!scrollport && ['auto','scroll'].includes(style.overflowY)) scrollport = { element: p, style, r };
          // The outer LCD/bezel may clip the scrollport's overflow by design;
          // only nested hidden containers are a real text-clipping failure.
          const outerOfScrollport = scrollport && p.contains(scrollport.element);
          if (!outerOfScrollport && ['hidden','clip'].includes(style.overflowY) &&
              (box.top < r.top-1 || box.bottom > r.bottom+1)) clipped.push(node.textContent);
          if (p === el.parentElement) break;
        }
        // Vertical overflow inside the LCD is intentional: the reading viewport
        // keeps the device shell fixed and lets the player scroll long copy.
        const viewport = scrollport ?? { style: { overflowX: 'hidden' }, r: lcd };
        if (!['auto','scroll'].includes(viewport.style.overflowX) &&
            (box.left < viewport.r.left-1 || box.right > viewport.r.right+1)) clipped.push(node.textContent);
        if (!scrollport && (box.top < lcd.top-1 || box.bottom > lcd.bottom+1)) clipped.push(node.textContent);
      }
    }
    return { rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
      scoreFont: parseFloat(getComputedStyle(el.querySelector('.game-score')).fontSize),
      messageFont: parseFloat(getComputedStyle(el.querySelector('.game-message')).fontSize),
      overflow: document.documentElement.scrollWidth > innerWidth+1, clipped: [...new Set(clipped)],
      lcdControls: document.querySelectorAll('.lcd button,.lcd [role="button"],.lcd a').length };
  });
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir,'test.db'), PIXELPET_WEB: web }, stdio:['ignore','pipe','pipe'] });
  server.once('error', e => { startupError=e; });
  server.stdout.on('data', d => { log+=d; }); server.stderr.on('data', d => { log+=d; });
  let ready=false, lastReadError;
  for (let i=0;i<100;i++) {
    if(startupError) throw startupError; if(server.exitCode!==null) throw Error(log);
    try { await api('state'); ready=true; break; } catch (e) { lastReadError=e; await wait(50); }
  }
  assert(ready,`${log}\n${lastReadError}`); browser=await chromium.launch({ headless:true, channel:'chrome' });
  for (const mode of [
    {name:'desktop-large',width:1200,height:900,font:28}, {name:'desktop',width:1200,height:900,font:14},
    {name:'phone',width:320,height:480,font:14}, {name:'phone-large-contrast',width:320,height:480,font:28,contrast:true},
  ]) {
    const now=Date.now();
    await api('import', { schema:1, revision:1, species:2, name:'接星测试伙伴', createdAt:now-3600000,
      hatchedAt:now-3600000, lastTick:now, sleeping:false, needs:{hunger:80,mood:80,clean:80,energy:80}, careCount:0, logs:[] });
    const start=await api('action',{kind:'play'}), before=start.state;
    const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,
      forcedColors:mode.contrast?'active':'none',reducedMotion:mode.contrast?'reduce':'no-preference'});
    try {
      const page=await context.newPage(), errors=[], actions=[];
      page.on('pageerror',e=>errors.push(String(e)));
      page.on('request',r=>{if(r.method()==='POST' && new URL(r.url()).pathname==='/api/action') actions.push(r.postDataJSON());});
      await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
      await page.goto(base); await page.locator('.star-game').waitFor();
      const layout=await inspect(page); results.push({mode:mode.name,...layout});
      await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
      await page.screenshot({path:join(artifacts,mode.name+'-start.png'),fullPage:true});
      assert(layout.scoreFont>=mode.font*.85,'round text must follow root font');
      assert(layout.messageFont>=mode.font*.85,'catch feedback must follow root font');
      assert(!layout.overflow); assert.deepEqual(layout.clipped,[]); assert.equal(layout.lcdControls,0);
      assert.match(await page.locator('.game-lanes').getAttribute('aria-label'),/^星星在(左边|中间|右边)；伙伴在中间$/);
      const status = page.locator('[data-selection-status="stars"]');
      assert.equal(await status.getAttribute('aria-live'), 'polite');
      assert.match(await status.textContent(), /伙伴在中间；A 移到右边/);
      await status.evaluate(el => {
        window.starsStatusMutations = 0;
        window.starsStatusNode = el;
        new MutationObserver(() => window.starsStatusMutations++).observe(el, {childList:true, subtree:true, characterData:true});
      });
      // Native keyboard navigation, no catch write; the live node stays mounted.
      for (const [position, next] of [['右边','左边'], ['左边','中间'], ['中间','右边']]) {
        await page.keyboard.press('a');
        await page.waitForFunction(position => document.querySelector('[data-selection-status="stars"]')?.textContent.includes(`伙伴在${position}；`), position);
        assert.match(await status.textContent(), new RegExp(`伙伴在${position}；A 移到${next}`));
      }
      assert.equal(actions.length, 0);
      const spoken = await status.textContent(), mutations = await page.evaluate(() => window.starsStatusMutations);
      await wait(1100);
      assert.equal(await status.textContent(), spoken);
      assert.equal(await page.evaluate(() => window.starsStatusMutations), mutations, 'automatic star changes must not rewrite speech');
      assert(await status.evaluate(el => el === window.starsStatusNode));
      await key(page,'a'); assert.equal(await page.locator('.star-position').textContent(),'伙伴：右边');
      await key(page,'c'); await page.locator('.game-abandon').waitFor();
      assert.equal(await status.count(), 0); await key(page,'a');
      assert.match(await status.textContent(), /伙伴在右边；A 移到左边/);
      assert.equal(await page.locator('.star-position').textContent(),'伙伴：右边');
      // Synthetic blur is a controlled boundary, not a physical OS background test.
      await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await wait(1100);
      assert.equal((await api('state')).state.game.round,0); assert.equal(actions.length,0);
      await page.reload(); await page.locator('.star-game').waitFor();
      assert.equal((await api('state')).state.game.id,before.game.id);
      assert.equal((await api('state')).state.game.round,0);
      for(let round=0;round<5;round++) {
        // Intentionally wait beyond one beat; no automatic catch or missed round.
        await wait(1100); await key(page,'a');
        const lane=await page.locator('.game-lane').evaluateAll(nodes=>nodes.findIndex(n=>n.classList.contains('lane-selected')));
        await key(page,'b'); assert.equal(actions.length,round+1);
        assert.equal(actions[round].kind,'catch'); assert.equal(actions[round].lane,lane);
        assert.equal(actions[round].gameId,before.game.id);
        if(round<4) {
          const saved=(await api('state')).state;
          assert.equal(saved.game.round,round+1); assert.equal(saved.economy.coins,before.economy.coins);
          assert.equal(saved.careCount,before.careCount);
          const speech = (await status.textContent()).replace(/\s+/g, ' ');
          assert(speech.includes(`第 ${round+2} / 5 轮，已接住 ${saved.game.score} 颗。`), speech);
          assert.match(await page.locator('.game-score').textContent(),new RegExp(`第 ${round+2} / 5 轮`));
          assert.deepEqual((await inspect(page)).clipped,[]);
          if(round===0) {
            // Explicit native reading, not automatic scrolling on a changing star.
            await page.locator('.game-message').evaluate(el=>{el.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy({top:-12,behavior:'instant'});});
            const reading=await page.evaluate(()=>{
              const text=document.querySelector('.game-message').getBoundingClientRect(),dock=document.querySelector('.device-buttons').getBoundingClientRect();
              return {top:text.top,bottom:text.bottom,dock:dock.top,height:innerHeight,keys:[...document.querySelectorAll('.physical-button')].every(el=>{
                const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                return r.top>=0 && r.bottom<=innerHeight && (hit===el || el.contains(hit));
              })};
            });
            assert(reading.top>=0 && reading.bottom<=Math.min(reading.height,reading.dock) && reading.keys,JSON.stringify(reading));
            await page.screenshot({path:join(artifacts,mode.name+'-read-message.png'),fullPage:false});
          }
          if(round===0) {await page.reload();await page.locator('.star-game').waitFor();assert.equal((await api('state')).state.game.round,1);}
        }
      }
      await page.locator('.content-home').waitFor();
      assert.equal(await status.count(), 0);
      const receipt=await page.locator('.game-outcome').textContent(), match=receipt.match(/一起接住了 (\d) 颗星星！\+(\d) 金币/);
      assert(match,receipt); assert.equal(+match[2],3+(+match[1]));
      const after=(await api('state')).state; assert(!after.game);
      assert.equal(after.economy.coins,before.economy.coins+(+match[2])); assert.equal(after.careCount,before.careCount+1);
      await page.reload(); await page.locator('.content-home').waitFor();
      const reread=(await api('state')).state;
      assert.equal(reread.economy.coins,after.economy.coins); assert.equal(reread.careCount,after.careCount);
      // A fresh session can be explicitly abandoned; it must not pay out.
      const next=await api('action',{kind:'play'}); await page.reload(); await page.locator('.star-game').waitFor();
      await key(page,'c'); await page.locator('.game-abandon').waitFor(); await key(page,'b');
      await page.locator('.content-home').waitFor();
      const abandoned=(await api('state')).state; assert(!abandoned.game);
      assert.equal(actions.length,6); assert.equal(actions[5].kind,'cancel-play'); assert.equal(actions[5].gameId,next.state.game.id);
      assert.equal(abandoned.economy.coins,after.economy.coins); assert.equal(abandoned.careCount,after.careCount);
      assert.deepEqual(errors,[]); results.at(-1).completion={rounds:5,score:+match[1],coins:+match[2],care:1};
      await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
    } finally { await context.close(); }
  }
  console.log(`Stars reading and three-key completion: ${results.length} modes passed. ${artifacts}`);
} finally {
  if(browser) await browser.close();
  if(server && server.exitCode===null) {server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  await writeFile(join(artifacts,'server.log'),log);
}
