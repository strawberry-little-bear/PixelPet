// Isolated HTTP/SQLite/Chrome checks. Default cases read real migrated saves;
// changed/missing/invalid/legacy cases explicitly alter response metadata only.
// Never accesses a player's URL, DB, binary or shared web build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,realpath,writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname,isAbsolute,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.PIXELPET_TEST_BINARY,web=process.env.PIXELPET_TEST_WEB;
assert(binary&&isAbsolute(binary),'Set absolute PIXELPET_TEST_BINARY');
assert(web&&isAbsolute(web),'Set absolute PIXELPET_TEST_WEB');
assert.notEqual(await realpath(binary),join(root,'bin/pixelpet'));
assert.notEqual(await realpath(web),join(root,'web/dist'));
const {chromium}=await import(process.env.PIXELPET_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'pixelpet-habit-rest-')),results=[];
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
const base=`http://127.0.0.1:${port}`,wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,log='',startupError;
async function api(path,body){const r=await fetch(`${base}/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();}
async function key(p,k){await p.locator(`.button-${k}:not(:disabled)`).tap();}
async function handbook(p){await key(p,'a');for(let i=0;i<6;i++)await key(p,'a');await key(p,'b');await key(p,'b');await p.locator('.growth-page-dots').filter({hasText:'2 / 6'}).waitFor();}
async function reading(p){return p.evaluate(()=>document.querySelector('.habit-rest-guide')?.textContent??document.querySelector('.growth-panel-note:last-of-type')?.lastChild?.textContent??'');}
async function check(p,stage,metadata){
 const text=await reading(p);
 if(metadata==='missing'||metadata==='invalid'||metadata==='legacy'){
  assert(text.includes(metadata==='legacy'?'成长记录尚未读到':'成长基准尚未读到'),text);
  assert(!/28|0\.25|17\.5|每恢复/.test(text),text);
 }else{
  const energy=metadata==='custom'?17.5:28,points=metadata==='custom'?.4:.25;
  assert(text.includes(`每恢复 ${energy} 体力，休息习惯 +1`),`habit page ignores ${metadata} rest basis: ${text}`);
  if(stage==='adult'){assert(text.includes('成年形态不变'),text);assert(!text.includes('成长 +'),text);}
  else {assert(text.includes(`成长 +${points}`),text);assert(text.includes('按实际恢复比例记录'),text);}
 }
 return text;
}
async function layout(p){
 const errors=await p.locator('.growth-panel').evaluate(el=>{
  const box=el.closest('.lcd-content').getBoundingClientRect(),footer=document.querySelector('.lcd-bottom').getBoundingClientRect(),errors=[];
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
  while((n=walk.nextNode())){if(!n.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(n);
   for(const r of range.getClientRects()){
    if(!r.width||!r.height)continue;
    if(r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>Math.min(box.bottom,footer.top)+1)errors.push(n.textContent);
    for(let e=n.parentElement;e;e=e.parentElement){const s=getComputedStyle(e),b=e.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))errors.push('clipped '+n.textContent);}
   }
  }return errors;
 });assert.deepEqual(errors,[],'habit page text clipped');
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
 assert.equal(await p.locator('.physical-button').count(),3);assert.equal(await p.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
 return p.locator('.habit-rest-guide').evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));
}
try{
 server=spawn(binary,[],{cwd:root,env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
 server.once('error',e=>startupError=e);server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const modes=[{width:1200,height:700,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}];
 const scenarios=[{metadata:'custom',sleeping:false},{metadata:'actual',sleeping:false},{metadata:'actual',sleeping:true},{metadata:'missing',sleeping:false},{metadata:'invalid',sleeping:false},{metadata:'legacy',sleeping:false}];
 for(const stage of ['baby','growing','adult'])for(const {metadata,sleeping}of scenarios)for(const mode of modes){
  const now=Date.now(),age={baby:1,growing:25,adult:80}[stage]*3600000;
  const seeded=(await api('import',{schema:1,revision:1,species:2,name:'休息习惯',createdAt:now-age,hatchedAt:now-age,lastTick:now,sleeping,needs:{hunger:80,mood:80,clean:80,energy:40},careCount:0,logs:[]})).state;
  const c=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width===320,reducedMotion:'reduce',forcedColors:mode.height===380?'active':'none'}),p=await c.newPage(),writes=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(new URL(r.url()).pathname);});
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=`${font}px`),mode.font);
  await p.route(/\/api\/(state|visit)$/,async route=>{
   const response=await route.fetch(),json=await response.json();
   if(metadata==='custom'){json.careRules.growth.restEnergyPerHabit=17.5;json.careRules.growth.restPointsPerHabit=.4;}
   if(metadata==='missing')delete json.careRules;
   if(metadata==='invalid')json.careRules.growth.restEnergyPerHabit=0;
   if(metadata==='legacy'){delete json.state.growth;json.state.schema=1;}
   await route.fulfill({response,json});
  });
  try{
   await p.goto(base);await p.locator('.home-caption').waitFor();await handbook(p);const text=await check(p,stage,metadata),geometry=await layout(p);
   assert(geometry.font>=12/14*mode.font-.01,JSON.stringify(geometry));
   await p.screenshot({path:join(dir,`${stage}-${metadata}-${sleeping}-${mode.width}-${mode.height}-${mode.font}.png`),fullPage:true});
   await key(p,'b');await key(p,'b');await key(p,'b');
   const basis=await p.locator('.growth-basis').innerText();
   if(['actual','custom'].includes(metadata))assert(basis.includes(`每实际恢复 ${metadata==='custom'?17.5:28} 点体力`),basis);
   if(['missing','invalid'].includes(metadata))assert(basis.includes('成长基准尚未读到'),basis);
   await p.reload();await p.locator('.home-caption').waitFor();await handbook(p);assert.equal(await check(p,stage,metadata),text);await layout(p);
   await key(p,'c');await p.locator('.home-caption').waitFor();assert.equal((await api('state')).state.sleeping,sleeping);
   const after=(await api('state')).state;assert.equal(after.careCount,0);assert.deepEqual(after.economy,seeded.economy);assert.equal(after.growth.stage,stage);assert.equal(after.growth.form,seeded.growth.form);
   const backup=await api('backup');assert(!JSON.stringify(backup).includes('careRules'));
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   results.push({stage,metadata,sleeping,...mode,text,geometry});
  }catch(e){await p.screenshot({path:join(dir,'failure.png'),fullPage:true});throw e;}
  finally{await c.close();}
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({groups:results.length,artifacts:dir,port}));
}finally{
 await browser?.close();if(server&&server.exitCode===null&&server.signalCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}
 await writeFile(join(dir,'server.log'),log);console.log('Artifacts:',dir);
}
