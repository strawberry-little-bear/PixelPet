// Isolated SQLite/HTTP/Chrome. Two real keyboard-played stars games verify
// saved counts. An adult fixture also separates capped familiarity from two
// real completions. Old-schema and extreme-number layouts use explicit fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-game-history-'));
const port = await new Promise((resolve, reject) => { const s=net.createServer(); s.once('error',reject); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));}); });
const base=`http://127.0.0.1:${port}`, wait=ms=>new Promise(r=>setTimeout(r,ms)), results=[];
let server,browser,log='',startupError;
async function api(path,body) { const r=await fetch(`${base}/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); assert(r.ok,await r.clone().text());return r.json(); }
async function key(page,k) { await page.locator('.button-'+k+':not([disabled])').waitFor(); await page.keyboard.press(k); await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled); }
async function home(page) { await page.reload();await page.locator('.home-caption').waitFor();await key(page,'c'); }
async function summary(page) {
 await key(page,'a');for(let i=0;i<4;i++)await key(page,'a');await key(page,'b');await key(page,'a');
 await page.locator('.life-summary').waitFor();
 assert((await page.locator('.life-summary-interest').textContent()).includes('成长手册'),
  'life summary must point detailed game counts to the handbook');
}
async function count(page,n) {
 const state=(await api('state')).state, entry=state.companion?.history?.completions?.find(row=>row.kind==='stars');
 assert.equal(entry?.count,n,'saved stars completion count');
}
async function companion(page, expected) {
 const writes=[];
 const onRequest=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname.startsWith('/api/'))writes.push(req.url());};
 page.on('request',onRequest);
 try {
  await key(page,'a');for(let i=0;i<6;i++)await key(page,'a');await key(page,'b');
  for(let i=0;i<3;i++)await key(page,'b');
  const panel=page.locator('.companion-panel');await panel.waitFor();
  assert.equal(await panel.locator('[aria-label="共同游戏完成总数"]').textContent(),`共同完成 ${expected} 局 · 只统计已经收好的游戏`);
  assert.equal(await page.locator('.physical-button').count(),3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'companion page overflow');
  const clipped=await panel.evaluate(el=>{
   const b=el.getBoundingClientRect(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),bad=[];let node;
   while((node=walker.nextNode())){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height&&(r.left<b.left-1||r.right>b.right+1))bad.push(node.textContent);}
   return bad;
  });
  assert.deepEqual(clipped,[],'companion text clipped');
  await panel.locator('.companion-since').scrollIntoViewIfNeeded();assert(await panel.locator('.companion-since').isVisible());
  assert.deepEqual(writes,[],'companion reading must not write');
 } finally {page.off('request',onRequest);}
 await key(page,'c');
}
async function play(page,n) {
 await key(page,'a');await key(page,'a');await key(page,'b');await page.locator('.arcade-card').first().waitFor();await key(page,'b');await page.locator('.game-guide').waitFor();await key(page,'b');await page.locator('.star-game').waitFor();
 for(let i=0;i<5;i++) { await wait(950);const ack=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action'&&r.request().method()==='POST'&&r.request().postDataJSON()?.kind==='catch');await key(page,'b');const response=await ack;assert(response.ok(),await response.text()); }
 await page.locator('.game-outcome').waitFor();assert((await page.locator('.game-completion-count').textContent()).includes(`已记录 ${n} 局共同游戏`));await key(page,'c');await key(page,'c');
}
// The recent game below comes from actual completions, not fabricated interest.
async function quietRecent(page, expected, label) {
 const writes=[];
 const onRequest=req=>{if(req.method()!=='GET'&&!['/api/state','/api/visit'].includes(new URL(req.url()).pathname))writes.push(req.url());};
 page.on('request',onRequest);
 try {
  const before=(await api('state')).state;
  await key(page,'a');for(let i=0;i<12;i++)await key(page,'a');await key(page,'b');
  await page.locator('.quiet-moment').waitFor();await key(page,'a');await key(page,'a');
  assert.equal(await page.locator('.quiet-memory-source').count(),0,'Opening chat must not replay a response');
  await key(page,'b');
  const source=page.locator('.quiet-memory-source'), first=await source.innerText();
  const position=page.locator('.quiet-memory-position'), firstPosition=await position.innerText();
  assert.match(firstPosition,/^闲聊回忆 1 \/ [2-9][0-9]*$/,'Recent completion and album share one sequence');
  assert(first.includes('从共同游戏记录想起：最近一次一起玩「接星星」'),first);
  assert.equal(await source.locator('time').getAttribute('datetime'),new Date(expected.at).toISOString());
  assert(!(await page.locator('.quiet-moment-copy > p').innerText()).match(/今天|刚才|昨天|奖励|成长|金币/));
  // Read each wrapped source line through the LCD scrollport, including the
  // date/time at 200% root size. The reading shell intentionally keeps the
  // device fixed, so document scrolling alone cannot reveal these lines.
  await source.evaluate(el=>{
   const scrollport=el.closest('.lcd-content');if(!scrollport)throw new Error('Missing LCD scrollport');
   const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),texts=[];let text;
   while((text=walker.nextNode()))if(text.textContent.trim())texts.push(text);
   for(const text of texts){
    const range=document.createRange();range.selectNodeContents(text);
    for(const rect of Array.from(range.getClientRects())){
     const view=scrollport.getBoundingClientRect();
     if(rect.top<view.top+2)scrollport.scrollTop+=rect.top-(view.top+12);
     else if(rect.bottom>view.bottom-2)scrollport.scrollTop+=rect.bottom-(view.bottom-12);
     const current=Array.from(range.getClientRects()).find(candidate=>Math.abs(candidate.left-rect.left)<1);
     const line=current ?? rect, after=scrollport.getBoundingClientRect();
     if(line.left < after.left-1 || line.right > after.right+1 || line.top < after.top-1 || line.bottom > after.bottom+1)
      throw new Error('Unreachable recent-game source: '+text.textContent);
    }
   }
  });
  await page.screenshot({path:join(dir,`quiet-recent-${label}.png`),fullPage:true});
  const stop=page.getByRole('region',{name:'无目的互动阅读区'});await stop.focus();await page.keyboard.press('Enter');assert.equal(await source.innerText(),first);
  await key(page,'b');assert((await source.innerText()).startsWith('从纪念册想起：'),'First-game album remains available');
  assert.equal(await position.innerText(),firstPosition.replace(' 1 /',' 2 /'));
  for(let i=0;i<before.album.entries.length+1 && await source.innerText()!==first;i++)await key(page,'b');
  assert.equal(await source.innerText(),first,'B cycles back to the same recorded completion');
  assert.equal(await position.innerText(),firstPosition,'Position wraps with the selected memory');
  assert.equal(await page.locator('.physical-button').count(),3);assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await key(page,'c');assert.equal(await page.locator('.quiet-memory-source').count(),0);
  assert.equal(await page.locator('.quiet-moment').count(),1);
  await key(page,'c');await page.locator('.home-caption').waitFor();
  await home(page);
  const after=(await api('state')).state;
  assert.deepEqual(after.companion,before.companion);assert.deepEqual(after.album,before.album);assert.equal(after.careCount,before.careCount);
  assert.equal(after.economy.coins,before.economy.coins);assert.equal(after.growth.points,before.growth.points);assert.deepEqual(after.growth.formRecord,before.growth.formRecord);
  await key(page,'a');for(let i=0;i<12;i++)await key(page,'a');await key(page,'b');await key(page,'a');await key(page,'a');
  assert.equal(await page.locator('.quiet-memory-source').count(),0,'Refresh must not replay a chat');
  await key(page,'b');assert.equal(await page.locator('.quiet-memory-source time').getAttribute('datetime'),new Date(expected.at).toISOString());await key(page,'c');await key(page,'c');await page.locator('.home-caption').waitFor();
  assert.deepEqual(writes,[],'Chat and reading must not perform actions');
  results.push({quietRecent:label,source:'real second stars completion',timestamp:expected.at,readOnly:true,refresh:'manual conversation'});
 } finally {page.off('request',onRequest);}
}
async function layout(page) {
 assert.equal(await page.locator('.physical-button').count(),3);
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
 const clipped=await page.locator('.life-summary-next,.life-summary-experiences').evaluateAll(elements=>elements.flatMap(el=>{
  const b=el.getBoundingClientRect(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),bad=[];let node;
  while((node=walker.nextNode())){const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height&&(r.left<b.left-1||r.right>b.right+1))bad.push(node.textContent);}
  return bad;
 }));assert.deepEqual(clipped,[],'game history or next-step text clipped');
 const details=page.locator('.life-summary-experiences');await details.scrollIntoViewIfNeeded();assert(await details.isVisible());
 await page.locator('.button-c').scrollIntoViewIfNeeded();await key(page,'c');await page.locator('.home-caption').waitFor();
}
try {
 server=spawn(binary,[],{env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});server.once('error',e=>startupError=e);server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 const at=Date.now();await api('import',{schema:1,revision:0,species:2,name:'记录测试伙伴',createdAt:at-3600000,hatchedAt:at-3600000,lastTick:at,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1200,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.home-caption').waitFor();await key(page,'c');
 await summary(page);await count(page,0);await key(page,'c');
 await play(page,1);await summary(page);await count(page,1);await key(page,'c');
 await play(page,2);await summary(page);await count(page,2);
 let current=(await api('state')).state;assert.equal(current.companion.interests[0].points,1);assert.equal(current.companion.history.completions[0].count,2);assert.equal(current.album.entries.filter(x=>x.kind==='stars').length,1);
 await home(page);await summary(page);await count(page,2);await key(page,'c');results.push({keyboardGames:2,count:2,familiarity:1,refresh:'preserved'});
 const exported=await api('backup');const backup=exported.state??exported;
 assert.equal(backup.companion.history.completions[0].count,2);
 await api('import',backup);await home(page);await summary(page);await count(page,2);await key(page,'c');results.push({exportImport:'preserves counts without a new completion'});
 const old=structuredClone(backup);old.schema=18;delete old.companion.history;
 // Schema 18 predates game keepsakes and their display choice. Preserve only
 // records that could actually exist in that version before testing migration.
 old.album.entries=old.album.entries.filter(entry=>entry.kind!=='keepsake');delete old.album.displayItem;
 const migrated=(await api('import',old)).state;assert.equal(migrated.schema,23);assert.equal(migrated.companion.history.completions[0].count,0);assert.deepEqual(migrated.companion.interests,backup.companion.interests);assert.deepEqual(migrated.album,old.album);
 await home(page);await summary(page);await count(page,0);assert((await page.locator('.life-summary-interest').textContent()).includes('逐项局数收在成长手册'));await key(page,'c');results.push({legacyFixture:'no invented past games'});
 // Construct an adult with an older, capped fishing interest. This is an
 // explicit history fixture, not five naturally played fishing sessions.
 const adultAt=Date.now();
 const adult=(await api('import',{schema:1,revision:0,species:2,name:'成年陪伴伙伴',createdAt:adultAt-80*3600000,hatchedAt:adultAt-80*3600000,lastTick:adultAt,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]})).state;
 assert.equal(adult.growth.stage,'adult');
 adult.companion.since=adult.hatchedAt;
 const fishing=adult.companion.interests.find(row=>row.kind==='fishing');
 fishing.points=5;fishing.lastAt=adultAt-3600000;
 adult.companion.recent={kind:'fishing',id:backup.companion.recent.id,at:fishing.lastAt};
 const adultBefore=(await api('import',adult)).state;
 await home(page);await summary(page);
 const suggestion=()=>page.locator('.life-summary-next').textContent();
 assert((await suggestion()).includes('最近一次一起玩过的是「池塘钓鱼」'));
 assert((await suggestion()).includes('目前更熟悉的是「池塘钓鱼」'));
 await key(page,'c');
 let firstAdult;
 for(const n of [1,2]){
  await play(page,n);await summary(page);
  const text=await suggestion();
  assert(text.includes('最近一次一起玩过的是「接星星」'),text);
  assert(text.includes('目前更熟悉的是「池塘钓鱼」'),text);
  assert(!text.includes('最近常一起玩'),text);
  const saved=(await api('state')).state;
  assert.equal(saved.companion.interests.find(row=>row.kind==='fishing').points,5);
  assert.equal(saved.companion.interests.find(row=>row.kind==='stars').points,1);
  assert.equal(saved.companion.history.completions[0].count,n);
  assert.equal(saved.companion.recent.kind,'stars');
  assert.equal(saved.growth.stage,'adult');assert.equal(saved.growth.points,72);
  assert.equal(saved.growth.form,adultBefore.growth.form);assert.deepEqual(saved.growth.formRecord,adultBefore.growth.formRecord);
  if(n===1)firstAdult=saved.companion.recent;
  else{assert.notEqual(saved.companion.recent.id,firstAdult.id);assert(saved.companion.recent.at>firstAdult.at);}
  await key(page,'c');
 }
 const adultSaved=(await api('state')).state;
 await home(page);await summary(page);await count(page,2);
 assert((await suggestion()).includes('最近一次一起玩过的是「接星星」'));
 const afterReload=(await api('state')).state;
 assert.deepEqual(afterReload.companion,adultSaved.companion);
 assert.equal(afterReload.careCount,adultSaved.careCount);
 await key(page,'c');await companion(page,2);
 results.push({adultSuggestion:'uses actual completed game, not capped interest',realKeyboardGames:2,familiarity:{fishing:5,stars:1},refresh:'preserved',form:'unchanged'});
 await quietRecent(page,adultSaved.companion.recent,'desktop');
 assert.deepEqual(errors,[]);await context.close();
 const modes=[{width:1200,height:850,font:14},{width:390,height:844,font:14},{width:320,height:568,font:28},{width:320,height:380,font:28,forcedColors:'active'}];
 for(const mode of modes){
  const ctx=await browser.newContext({viewport:{width:mode.width,height:mode.height},forcedColors:mode.forcedColors||'none',reducedMotion:'reduce'}),p=await ctx.newPage(),pageErrors=[];p.on('pageerror',e=>pageErrors.push(e.message));
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=font+'px'),mode.font);
  await p.goto(base);await p.locator('.home-caption').waitFor();await key(p,'c');await summary(p);await count(p,2);
  const next=await p.locator('.life-summary-next').textContent();assert(next.includes('最近一次一起玩过的是「接星星」')&&next.includes('目前更熟悉的是「池塘钓鱼」'),next);
  await p.screenshot({path:join(dir,`summary-${mode.width}-${mode.height}.png`),fullPage:true});await layout(p);await companion(p,2);if(mode.width===320&&mode.height===380)await quietRecent(p,adultSaved.companion.recent,'320-380-double');assert.deepEqual(pageErrors,[]);results.push({layout:mode,companion:'readable'});await ctx.close();
 }
 // Constructed upper-bound display; this is not actual lifetime play.
 const extreme=structuredClone(adultSaved);for(const row of extreme.companion.history.completions)row.count=Number.MAX_SAFE_INTEGER;await api('import',extreme);
 const ctx=await browser.newContext({viewport:{width:320,height:568}}),p=await ctx.newPage();await p.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='28px'));await p.goto(base);await p.locator('.home-caption').waitFor();await key(p,'c');await summary(p);const extremeState=(await api('state')).state;assert.equal(extremeState.companion.history.completions[0].count,Number.MAX_SAFE_INTEGER);await layout(p);await ctx.close();results.push({extremeNumberFixture:'preserves upper-bound count in saved history'});
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,artifacts:dir,results},null,2));
} finally {await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}}
