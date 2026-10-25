// Real stars completions, isolated SQLite, portable backup and three-key reading.
// Never uses the running player's service or shared builds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-keepsakes-'));
const port = await new Promise((resolve, reject) => { const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));}); });
const base=`http://127.0.0.1:${port}`, wait=ms=>new Promise(r=>setTimeout(r,ms)), results=[];
let server,browser,startupError,log='';
async function api(path,body) { const r=await fetch(`${base}/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json(); }
async function key(page,k) { await page.locator('.button-'+k+':not([disabled])').waitFor();await page.keyboard.press(k);await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled); }
const cards=state=>state.album.entries.filter(m=>m.kind==='keepsake');
async function play(page) {
 await key(page,'a');await key(page,'a');await key(page,'b');await page.locator('.arcade-card').first().waitFor();
 await key(page,'b');await page.locator('.game-guide').waitFor();await key(page,'b');await page.locator('.star-game').waitFor();
 for(let i=0;i<5;i++) {
  // Catch is server-clocked: wait until a new beat is actually available
  // instead of racing a fixed 900ms cadence and creating a false failure.
  for (;;) {
   const snapshot=await api('state'), game=snapshot.state.game;
   assert(game && !game.kind,'stars session must remain active before each catch');
   const beat=Math.floor(Math.max(0,snapshot.serverTime-game.startedAt)/900);
   if (beat>game.lastBeat) break;
   await wait(40);
  }
  const response=page.waitForResponse(
    r=>new URL(r.url()).pathname==='/api/action'&&r.request().postDataJSON()?.kind==='catch',
    {timeout:10000},
  );
  await key(page,'b');
  const reply=await response;
  assert(reply.ok(),await reply.text());
 }
 await page.locator('.game-outcome').waitFor();
}
async function selectionStatus(page, scope, text) {
 const node=page.locator(`[data-selection-status="${scope}"]`);
 assert.equal(await node.count(),1);assert.equal(await node.getAttribute('role'),'status');
 assert.equal(await node.getAttribute('aria-live'),'polite');assert.equal(await node.getAttribute('aria-atomic'),'true');
 assert.match(await node.textContent(),text);assert.match(await node.ariaSnapshot(),text);
 return node;
}
async function menuSelections(page) {
 await key(page,'a');const node=await selectionStatus(page,'care-menu',/第 1 \/ 13 项，吃点东西/);
 const identity=await node.elementHandle(),pagination=await page.locator('.care-menu-pagination').innerText();
 await page.locator('.button-a').focus();
 for(const [index,label] of ['一起玩耍','洗个澡澡','睡个好觉','看看状态','成长日记'].entries()) {
  await key(page,'a');assert.match(await node.textContent(),new RegExp(`第 ${index+2} / 13 项，${label}`));
  assert(await node.evaluate((el,original)=>el===original,identity));
  assert.equal(await page.locator('.care-menu-pagination').innerText(),pagination);
  assert(await page.locator('.button-a').evaluate(el=>el===document.activeElement));
 }
 const text=await node.textContent();
 const reply=page.waitForResponse(r=>['/api/state','/api/visit'].includes(new URL(r.url()).pathname));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert((await reply).ok());
 await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled);
 assert.equal(await node.textContent(),text);assert(await node.evaluate((el,original)=>el===original,identity));
 assert.equal(await page.locator('.care-menu-reading [aria-live],.care-menu-reading [role=status]').count(),1);
 await page.locator('.care-menu-reading').focus();await key(page,'a');
 assert(await page.locator('.care-menu-reading').evaluate(el=>el===document.activeElement));
 await key(page,'c');await page.locator('.home-caption').waitFor();await identity.dispose();
}
async function album(page) {
 await key(page,'a');for(let i=0;i<8;i++)await key(page,'a');await key(page,'b');await page.locator('.album-directory').waitFor();
 for(let i=0;i<3;i++)await key(page,'a');assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'),'play');
 await selectionStatus(page,'album-directory',/第 4 \/ 8 项，一起玩过/);
 await key(page,'b');await selectionStatus(page,'album-page',/一起玩过，第 1 \/ \d+ 页，封面/);
}
async function readable(page, panel = ".album-panel", targets = [".album-panel > header", ".album-source:last-child"]) {
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
 const clipped=await page.locator(panel).evaluate(el=>{
  const bad=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.textContent.trim()||node.parentElement.closest('.sr-only'))continue;const range=document.createRange();range.selectNodeContents(node);for(const b of range.getClientRects()){
   if(!b.width||!b.height)continue;
   if(b.left < -1 || b.right > innerWidth+1)bad.push(node.textContent);
   for(let p=node.parentElement;p;p=p.parentElement){const style=getComputedStyle(p),clip=p.getBoundingClientRect();if(['hidden','clip','auto','scroll'].includes(style.overflowY)&&(b.top<clip.top-2||b.bottom>clip.bottom+2))bad.push(node.textContent);}
  }}return [...new Set(bad)];
 });assert.deepEqual(clipped,[],'card text clipped');
 for(const selector of [...targets,'.button-a','.button-b','.button-c']) {
  const el=page.locator(selector);await el.scrollIntoViewIfNeeded();assert(await el.evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=-1&&b.bottom<=innerHeight+1;}),`${selector} unreachable`);
 }
 assert.equal(await page.locator('.physical-button').count(),3);
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
}
async function quiet(page, touch = false) {
 await key(page,'a');for(let i=0;i<12;i++)await key(page,'a');await key(page,'b');await page.locator('.quiet-moment').waitFor();
 await key(page,'a');await key(page,'a');
 assert.equal(await page.locator('.quiet-keepsake').count(),0,'a keepsake needs an explicit conversation');
 // Complete the cycle using only B; no LCD controls or synthetic page-state edits.
 const saved=(await api('state')).state;
 for(let i=0;i<saved.album.entries.length+1 && !(await page.locator('.quiet-keepsake').count());i++) {
  if(touch)await page.locator('.button-b').tap();else await key(page,'b');
 }
 assert.equal(await page.locator('.quiet-keepsake [data-keepsake-art]').getAttribute('data-keepsake-art'),'star-ribbon');
 assert.match(await page.locator('.quiet-moment-copy > p').innerText(),/一起接过的星光/);
 assert.match(await page.locator('.quiet-memory-source').innerText(),/从纪念册想起：接星星的小缎带/);
 assert.equal(await page.locator('.quiet-memory-source time').getAttribute('datetime'),new Date(cards(saved)[0].at).toISOString());
 await readable(page,'.quiet-moment',['.quiet-moment > header','.quiet-keepsake','.quiet-moment-copy > p','.quiet-memory-source','.quiet-moment-note']);
 await page.screenshot({path:join(dir,`quiet-keepsake-${page.viewportSize().width}-${page.viewportSize().height}.png`),fullPage:true});
 await key(page,'c');assert.equal(await page.locator('.quiet-keepsake').count(),0,'C returns to companion choices');
 assert.equal(await page.locator('.quiet-moment').count(),1);
 await key(page,'c');await page.locator('.home-caption').waitFor();
 await page.reload();await page.locator('.home-caption').waitFor();assert.equal(await page.locator('.quiet-keepsake').count(),0,'reload must not replay a recollection');
}
async function corner(page, touch = false) {
 // The read-only checks leave us on an album card. Return through its directory.
 await key(page,'c');await key(page,'c');await page.locator('.home-caption').waitFor();
 const before=(await api('state')).state;
 async function openCorner() {
  await key(page,'a');for(let i=0;i<8;i++)await key(page,'a');await key(page,'b');
  for(let i=0;i<7;i++)await key(page,'a');
  assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'),'keepsakes');
  await selectionStatus(page,'album-directory',/第 8 \/ 8 项，小窝纪念角/);
  await key(page,'b');await page.locator('.keepsake-corner').waitFor();
 }
 async function confirm() {
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action'&&r.request().postDataJSON()?.kind==='display-keepsake');
  if(touch)await page.locator('.button-b').tap();else await key(page,'b');
  assert((await response).ok());await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled);
 }
 await openCorner();await key(page,'a');
 assert.equal(await page.locator('.keepsake-corner').getAttribute('data-corner-choice'),'star-ribbon');
 assert.match(await page.locator('.corner-action').innerText(),/B 摆在小窝/);
 await selectionStatus(page,'keepsake-corner',/第 2 \/ 2 项，接星星的小缎带。现在摆着：暂时留空/);
 assert.equal(await page.locator('.corner-date time').getAttribute('datetime'),new Date(cards(before)[0].at).toISOString());
 await readable(page,'.keepsake-corner',['.keepsake-corner > header','.corner-preview','.corner-action','.keepsake-corner > small']);
 await page.screenshot({path:join(dir,`corner-${page.viewportSize().width}-${page.viewportSize().height}.png`),fullPage:true});
 await confirm();const placed=await api('backup');assert.equal(placed.album.displayItem,'star-ribbon');
 assert.equal(placed.careCount,before.careCount);assert.deepEqual(placed.logs,before.logs);assert.deepEqual(cards(placed),cards(before));
 assert.equal(placed.economy.coins,before.economy.coins);
 await key(page,'c');await key(page,'c');await page.locator('.home-keepsake').waitFor();
 await page.reload();await page.locator('.home-keepsake').waitFor();
 assert.equal(await page.locator('.home-keepsake [data-keepsake-art]').getAttribute('data-keepsake-art'),'star-ribbon');
 await readable(page,'.home-keepsake',['.home-keepsake']);
 await page.screenshot({path:join(dir,`home-corner-${page.viewportSize().width}-${page.viewportSize().height}.png`),fullPage:true});
 // A second real page sees the same saved display, with no replay or extra rewards.
 const other=await page.context().newPage();await other.goto(base);await other.locator('.home-keepsake').waitFor();await other.close();await page.bringToFront();
 await openCorner();await key(page,'a');assert.equal(await page.locator('.keepsake-corner').getAttribute('data-corner-choice'),'');
 await confirm();assert.equal((await api('state')).state.album.displayItem,undefined);
 await key(page,'c');await key(page,'c');assert.equal(await page.locator('.home-keepsake').count(),0);
 // Backup restores the chosen decoration; unowned choices remain a refusal.
 await api('import',placed);await page.reload();await page.locator('.home-keepsake').waitFor();
 const rejected=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'display-keepsake',item:'pond-shell',requestId:crypto.randomUUID()})});
 assert.equal(rejected.status,400);assert.equal((await api('state')).state.album.displayItem,'star-ribbon');
 await openCorner();await key(page,'a');await confirm();await key(page,'c');await key(page,'c');
 assert.equal(await page.locator('.home-keepsake').count(),0);
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
}
try {
 server=spawn(binary,[],{env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
 server.once('error',e=>startupError=e);server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 const now=Date.now();const initial=await api('import',{schema:1,revision:0,species:2,name:'小纪念伙伴',createdAt:now-3600000,hatchedAt:now-3600000,lastTick:now,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
 assert.equal(initial.state.schema,23);assert.deepEqual(cards(initial.state),[]);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1200,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.home-caption').waitFor();
 await play(page);assert.match(await page.locator('.game-keepsake-result').innerText(),/一起收好了「接星星的小缎带」/);
 const first=cards((await api('state')).state);assert.equal(first.length,1);assert.equal(first[0].item,'star-ribbon');
 const settlementWrites=[];
 const watchSettlement=r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/action')settlementWrites.push(r.postDataJSON());};
 page.on('request',watchSettlement);
 // Resize the same real acknowledgement: do not reconstruct a receipt from a
 // saved history or mock a completion just to exercise the narrow layout.
 for(const mode of [{width:1200,height:850,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}]) {
  await page.setViewportSize({width:mode.width,height:mode.height});
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'});
  await page.evaluate(font=>{document.documentElement.style.fontSize=`${font}px`;},mode.font);
  const card=page.getByRole('group',{name:'本次收好的游戏纪念物'});
  assert.match(await card.ariaSnapshot(),/一起收好了「接星星的小缎带」/);
  assert.match(await card.innerText(),/纪念册「一起玩过」.*「小窝纪念角」/);
  const art=card.locator('[data-keepsake-art]');assert.equal(await art.count(),1);
  assert.equal(await art.getAttribute('data-keepsake-art'),'star-ribbon');assert.equal(await art.getAttribute('aria-hidden'),'true');
  assert(await art.evaluate(el=>{const b=el.getBoundingClientRect(),card=el.parentElement.getBoundingClientRect();
   return b.width>=35&&b.height>=35&&b.left>=card.left&&b.right<=card.right&&b.top>=card.top&&b.bottom<=card.bottom;
  }),'keepsake art must retain its size inside the card');
  await readable(page,'.game-keepsake-result',['.game-keepsake-result > svg','.game-keepsake-result strong','.game-keepsake-result small']);
  // Check the final prose line too: reaching the top of a tall paragraph
  // does not prove its directions can be read in a short viewport.
  assert(await card.locator('p').evaluate(el=>{
   el.scrollIntoView({block:'end'});const range=document.createRange();range.selectNodeContents(el);const line=[...range.getClientRects()].at(-1);
   return line&&line.top>=-1&&line.bottom<=innerHeight+1&&line.left>=-1&&line.right<=innerWidth+1;
  }),'the last line of the album/corner directions must be reachable');
  await card.screenshot({path:join(dir,`settlement-keepsake-${mode.width}-${mode.height}.png`)});
  assert.deepEqual(settlementWrites,[]);assert.deepEqual(cards((await api('state')).state),first);
  results.push({check:'real-new-keepsake-card-art-and-reading',...mode,passed:true});
 }
 page.off('request',watchSettlement);
 await page.setViewportSize({width:1200,height:850});await page.emulateMedia({reducedMotion:'reduce',forcedColors:'none'});
 await page.evaluate(()=>{document.documentElement.style.fontSize='14px';});
 await page.reload();await page.locator('.home-caption').waitFor();assert.equal(await page.locator('.game-keepsake-result').count(),0,'reload must not repeat a new-item announcement');
 await play(page);assert.equal(await page.locator('.game-keepsake-result').count(),0);assert.deepEqual(cards((await api('state')).state),first);
 const backup=await api('backup');assert.deepEqual(cards(backup),first);
 const restored=await api('import',backup);assert.deepEqual(cards(restored.state),first);
 assert.deepEqual(errors,[]);await context.close();results.push({check:'real-completions-repeat-reload-backup',passed:true});
 for(const mode of [{width:1200,height:850,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}]) {
  const ctx=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:mode.font===28,reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'}),p=await ctx.newPage(),writes=[],failures=[];
  p.on('pageerror',e=>failures.push(e.message));
  p.on('request',r=>{if(r.method()==='POST'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(r.url());});
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
  await p.goto(base);await p.locator('.home-caption').waitFor();await menuSelections(p);
  assert.deepEqual(writes,[]);results.push({check:'selection-status-native-keys-focus-and-stable-sync',...mode,passed:true});
  await quiet(p,mode.font===28);await album(p);
  for(let i=0;i<backup.album.entries.length+1 && !(await p.locator('[data-keepsake-art]').count());i++)await key(p,'a');
  assert.equal(await p.locator('[data-keepsake-art]').getAttribute('data-keepsake-art'),'star-ribbon');
  assert.match(await p.locator('.album-panel h3').innerText(),/接星星的小缎带/);await readable(p);
  const selected=await p.locator('.album-panel').getAttribute('data-album-page');await key(p,'a');await key(p,'b');
  assert.equal(await p.locator('.album-panel').getAttribute('data-album-page'),selected,'reverse must return to same saved item');
  await p.screenshot({path:join(dir,`keepsake-${mode.width}-${mode.height}.png`),fullPage:true});
  assert.deepEqual(writes,[]);assert.deepEqual(failures,[]);assert.deepEqual(cards((await api('state')).state),first);
  results.push({check:"album-and-keepsake-conversation",...mode,touch:mode.font===28,passed:true});
  await corner(p,mode.font===28);assert.deepEqual(failures,[]);
  results.push({check:"keepsake-corner-persistence-backup-and-three-keys",...mode,touch:mode.font===28,passed:true});await ctx.close();
 }
 // Construct only the adult age in this isolated DB, then earn the item by
 // a real completion. This does not claim a naturally raised adult pet.
 const adultNow=Date.now();
 await api('import',{schema:1,revision:0,species:2,name:'成年纪念伙伴',createdAt:adultNow-80*3600000,hatchedAt:adultNow-80*3600000,lastTick:adultNow,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
 const setup=await browser.newContext({viewport:{width:1200,height:850},reducedMotion:'reduce'}),setupPage=await setup.newPage();
 await setupPage.goto(base);await setupPage.locator('.home-caption').waitFor();await play(setupPage);
 const adultBackup=await api('backup');assert.equal(adultBackup.growth.stage,'adult');assert.equal(cards(adultBackup)[0].item,'star-ribbon');await setup.close();
 for(const mode of [{width:1200,height:850,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}]) {
  await api('import',adultBackup);
  const ctx=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:mode.font===28,reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],writes=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/action')writes.push(r.postDataJSON());});
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
  const review=async expected=>{
   await key(p,'a');for(let i=0;i<4;i++)await key(p,'a');await key(p,'b');await key(p,'a');
   const cue=p.locator('.life-summary-directions li').first();assert.match(await cue.innerText(),expected);
   assert.match(await cue.innerText(),/纪念册 → 小窝纪念角/);
   if(mode.font===28)assert(await cue.evaluate(el=>{
    const label=el.querySelector('b').getBoundingClientRect(),text=el.querySelector('span').getBoundingClientRect();
    return text.top>=label.bottom-1&&text.width>=el.getBoundingClientRect().width-1;
   }),'large-font narrow layouts must give the prose a full row');
   await readable(p,'.life-summary-directions',['.life-summary-directions li:first-child b','.life-summary-directions li:last-child b']);
   assert(await cue.locator('span').evaluate(el=>{
    el.scrollIntoView({block:'end'});const range=document.createRange();range.selectNodeContents(el);const line=[...range.getClientRects()].at(-1);
    return line&&line.top>=-1&&line.bottom<=innerHeight+1&&line.left>=-1&&line.right<=innerWidth+1;
   }),'the last line of the review cue must be reachable by scrolling');
  };
  await p.goto(base);await p.locator('.home-caption').waitFor();await review(/已经收好的游戏纪念物/);assert.deepEqual(writes,[]);
  await key(p,'c');await key(p,'a');for(let i=0;i<8;i++)await key(p,'a');await key(p,'b');for(let i=0;i<7;i++)await key(p,'a');await key(p,'b');await key(p,'a');await key(p,'b');
  assert.equal((await api('state')).state.album.displayItem,'star-ribbon');await key(p,'c');await key(p,'c');
  await review(/小窝正摆着「接星星的小缎带」/);
  await p.screenshot({path:join(dir,`adult-review-${mode.width}-${mode.height}.png`),fullPage:true});
  await p.reload();await p.locator('.home-caption').waitFor();await review(/小窝正摆着「接星星的小缎带」/);
  assert.equal(writes.length,1);assert.equal(writes[0].kind,'display-keepsake');assert.deepEqual(errors,[]);
  results.push({check:'adult-review-owned-corner-three-keys-and-reload',...mode,passed:true});await ctx.close();
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({artifacts:dir,results},null,2));
} finally { if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));} }
