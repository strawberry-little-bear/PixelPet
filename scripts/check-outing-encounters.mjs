// Deliberately select eligible, genuinely server-generated session IDs in a
// disposable DB, then play with the real service clock. This is NOT a natural
// rarity-rate measurement. Layout responses are explicitly intercepted fixtures.
// Never connects to the user's service or changes production RNG/clock/rewards.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.PIXELPET_TEST_BINARY, web=process.env.PIXELPET_TEST_WEB;
assert(binary&&isAbsolute(binary),'Set absolute PIXELPET_TEST_BINARY');
assert(web&&isAbsolute(web),'Set absolute PIXELPET_TEST_WEB to an isolated build');
const {chromium}=await import(process.env.PIXELPET_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'pixelpet-outing-encounters-')), results=[];
console.log('Artifacts:',dir);
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const base=`http://127.0.0.1:${port}`, wait=ms=>new Promise(r=>setTimeout(r,ms));
const notes=s=>(s.album?.entries??[]).filter(m=>m.kind.startsWith('scenery-')||m.kind.startsWith('encounter-'));
let server,browser,log='',startupError;
async function api(path,body){const res=await fetch(base+'/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(res.ok,await res.clone().text());return res.json();}
async function key(page,k){await page.locator(`.button-${k.toLowerCase()}`).tap();await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled);}
async function selectEligible(kind) {
 // API starts/cancels ordinary sessions; no save injection or RNG override.
 for (let attempt=1;attempt<=512;attempt++) {
  const s=(await api('action',{kind:'play-'+kind})).state, id=s.game.id;
  const light=Math.floor((parseInt(id.slice(0,6),16)%48)/12);
  if(light===(kind==='fishing'?3:2)&&parseInt(id.slice(6,8),16)%4===0)return {id,attempt};
  await api('action',{kind:'cancel-play',gameId:id});
 }
 throw new Error('No eligible random session in bounded search');
}
async function openNotes(page){for(const k of ['A',...Array(8).fill('A'),'B',...Array(6).fill('A'),'B'])await key(page,k);await page.locator('[data-album-category="scenery"]').waitFor();}
// Discoveries must also be reachable directly, without exiting the live session.
async function pauseNotes(page,kind){
 const selector=kind==='walk'?'.walk-pause':'.fishing-pause';
 if(!await page.locator(selector).isVisible())await key(page,'C');await page.locator(selector).waitFor();
 const before=(await api('state')).state;
 for(const k of ['A','A','A','B'])await key(page,k);
 await page.locator('[data-album-category="scenery"]').waitFor();assert.match(await page.locator('.lcd-bottom').innerText(),/C 返回暂停/);
 const seen=[];for(let i=0;i<notes(before).length;i++){await key(page,'B');await readable(page);seen.push(await page.locator('.album-panel').getAttribute('data-album-kind'));}
 assert.deepEqual([...seen].sort(),notes(before).map(m=>m.kind).sort());
 await page.screenshot({path:join(dir,'pause-note-'+kind+'.png'),fullPage:true});
 await key(page,'C');await page.locator(selector).waitFor();await wait(1300);
 const after=(await api('state')).state;assert.deepEqual(after.game,before.game);assert.deepEqual(notes(after),notes(before));assert.equal(after.careCount,before.careCount);assert.equal(after.economy.coins,before.economy.coins);
 await page.reload();await page.locator(selector).waitFor();await wait(1300);assert.deepEqual((await api('state')).state.game,before.game);
 await key(page,'C');
}
async function abandon(page,kind){await key(page,'C');await page.locator(kind==='walk'?'.walk-pause':'.fishing-pause').waitFor();for(const k of ['A','A','B','B'])await key(page,k);await page.locator('.home-caption').waitFor();}
async function readable(page){
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow');
 const errors=await page.locator('.album-panel').evaluate(el=>{
  const bounds=document.querySelector('.lcd-content').getBoundingClientRect(),footer=document.querySelector('.lcd-bottom').getBoundingClientRect(),errors=[];
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(node);
   for(const box of r.getClientRects()){
    if(!box.width||!box.height)continue;
    if(box.top<bounds.top-1||box.bottom>Math.min(bounds.bottom,footer.top)+1||box.left<bounds.left-1||box.right>bounds.right+1)errors.push(node.textContent);
    for(let p=node.parentElement;p;p=p.parentElement){const css=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(css.overflowY)&&(box.top<b.top-1||box.bottom>b.bottom+1))errors.push('clipped: '+node.textContent);}
   }
  }
  return errors;
 });assert.deepEqual(errors,[],'album text clipped or overlaps footer');
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input').count(),0,'new LCD gameplay control');
 assert.equal(await page.locator('.physical-button').count(),3);
}
try{
 server=spawn(binary,[],{cwd:root,env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
 server.once('error',e=>{startupError=e;});server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const ctx=await browser.newContext({viewport:{width:320,height:700},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/action')writes.push(r.postDataJSON());});
 const now=Date.now();await api('import',{schema:1,revision:1,species:2,name:'手记试玩',createdAt:now-3600000,hatchedAt:now-3600000,lastTick:now,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
 const journeys=[];
 for(const kind of ['fishing','walk']){
  const selected=await selectEligible(kind), before=(await api('state')).state;
  const rareKind=kind==='fishing'?'encounter-fishing-stars':'encounter-walk-kite';
  assert(!notes(before).some(m=>m.kind===rareKind),'start fabricated encounter');
  await page.goto(base);await page.locator(kind==='fishing'?'.fishing-game':'.walking-game').waitFor();
  if(kind==='fishing')await key(page,'C');
  await page.locator(kind==='fishing'?'.fishing-pause':'.walk-pause').waitFor();
  await key(page,'C');
  if(kind==='fishing')await key(page,'B');
  const deadline=Date.now()+150000,resumptions=[];
  while(Date.now()<deadline){
   const s=(await api('state')).state;
   if(kind==='fishing'&&await page.locator('.fishing-bite').isVisible())break;
   if(kind==='walk'&&s.game.walking.beat>=24)break;
   assert(!notes(s).some(m=>m.kind===rareKind),'recorded before real discovery');
   if(await page.locator(kind==='fishing'?'.fishing-pause':'.walk-pause').isVisible()){
    resumptions.push(Date.now());assert(resumptions.length<=8,'host repeatedly suspended');await key(page,'C');
   }
   await wait(250);
  }
  if(kind==='fishing'){
   assert(await page.locator('.fishing-bite').isVisible(),'no natural bite');
   assert(!notes((await api('state')).state).some(m=>m.kind===rareKind),'bite alone recorded encounter');
   await key(page,'B');
  }
  const discovered=(await api('state')).state, rare=notes(discovered).filter(m=>m.kind===rareKind);
  assert.equal(rare.length,1,'missing or duplicated encounter');assert.equal(rare[0].outingId,selected.id);
  assert(rare[0].at>=before.game.startedAt&&rare[0].at<=discovered.lastTick);
  assert.equal(discovered.careCount,before.careCount);assert.equal(discovered.economy.coins,before.economy.coins);
  await pauseNotes(page,kind);await abandon(page,kind);
  const after=(await api('state')).state;assert.deepEqual(notes(after),notes(discovered));
  assert.equal(after.careCount,before.careCount);assert.equal(after.economy.coins,before.economy.coins);
  const evidence={type:'selected-random-session-real-clock-discovery',kind,selected,rare,resumptions,writes:writes.map(a=>a.kind)};
  results.push(evidence);journeys.push(evidence);
 }
 const both=(await api('state')).state;assert.equal(notes(both).filter(m=>m.kind.startsWith('encounter-')).length,2);
 await page.reload();await page.locator('.home-caption').waitFor();await openNotes(page);await readable(page);
 for(let i=0;i<notes(both).length;i++){await key(page,'B');await readable(page);}
 await page.screenshot({path:join(dir,'real-saved-note.png'),fullPage:true});
 const backup=await api('backup');await api('reset',{confirm:true});await api('import',backup);
 const restored=await api('state');assert.deepEqual(notes(restored.state),notes(both));
 await page.reload();await page.locator('.home-caption').waitFor();await openNotes(page);await key(page,'B');await readable(page);
 assert.deepEqual(errors,[]);results.push({type:'real-encounters-refresh-backup-roundtrip',notes:notes(restored.state)});await ctx.close();
 // Layout fixtures, not extra real catches: six ordinary and two encounter cards.
 const kinds=['scenery-fishing-clear','scenery-fishing-cloud','scenery-fishing-rain','scenery-walk-clear','scenery-walk-cloud','scenery-walk-rain','encounter-fishing-stars','encounter-walk-kite'];
 for(const width of [1200,320])for(const scale of [1,2]){
  const c=await browser.newContext({viewport:{width,height:700},isMobile:width===320,hasTouch:true,reducedMotion:'reduce',forcedColors:scale===2?'active':'none'}),p=await c.newPage(),errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(scale=>document.addEventListener('DOMContentLoaded',()=>{
   // Double actual px-based album typography, not only the root rem.
   const style=document.createElement('style');
   style.textContent=`.album-panel,.album-panel li,.album-panel li>span{font-size:${11*scale}px}.album-panel h3,.album-panel header strong{font-size:${13*scale}px}.album-panel p{font-size:${11*scale}px}.album-panel time,.album-source,.album-panel header span{font-size:${9*scale}px}.lcd-bottom{font-size:${9*scale}px}`;
   document.head.append(style);
  }),scale);
  const fixture=structuredClone(restored);fixture.state.album.entries=kinds.map((kind,i)=>({kind,at:fixture.state.lastTick-i,source:'shared',...(kind.startsWith('encounter-')?{outingId:journeys.find(j=>j.kind===(kind.includes('fishing')?'fishing':'walk')).selected.id}:{})}));fixture.state.game=null;
  await p.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;assert(['/api/state','/api/visit'].includes(path),'Reading attempted a save');fixture.serverTime=Date.now();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
  try{
   await p.goto(base);await p.locator('.home-caption').waitFor();
   for(const k of ['A',...Array(8).fill('A'),'B'])await key(p,k);
   await p.locator('.album-directory').waitFor();await readable(p);
   for(let i=0;i<6;i++)await key(p,'A');await key(p,'B');await readable(p);
   for(let i=0;i<kinds.length;i++){await key(p,'B');await readable(p);const card=await p.locator('.album-panel').getAttribute('data-album-kind');assert.equal(card,kinds[kinds.length-1-i]);results.push({type:'saved-card-layout-fixture',width,scale,kind:card});if(card.startsWith('encounter-'))await p.screenshot({path:join(dir,`${card}-${width}-${scale}.png`),fullPage:true});}
   await p.screenshot({path:join(dir,`notes-${width}-${scale}.png`),fullPage:true});
   await key(p,'B');assert.equal(await p.locator('.album-panel').getAttribute('data-album-kind'),null);
   fixture.state.album.entries=[];await p.reload();await p.locator('.home-caption').waitFor();await openNotes(p);await readable(p);assert((await p.locator('.album-panel').innerText()).includes('还没有留下风景手记'));results.push({type:'empty-layout-fixture',width,scale});
   assert.deepEqual(errs,[]);
  }catch(e){await p.screenshot({path:join(dir,`failure-${width}-${scale}.png`),fullPage:true});console.error('Artifacts:',dir);throw e;}finally{await c.close();}
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({groups:results.length,artifacts:dir,port}));
}finally{
 if(browser)await browser.close();if(server&&server.exitCode===null&&server.signalCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;}
}
