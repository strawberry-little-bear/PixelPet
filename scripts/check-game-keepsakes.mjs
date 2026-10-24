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
  await wait(950);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action'&&r.request().postDataJSON()?.kind==='catch');
  await key(page,'b');assert((await response).ok());
 }
 await page.locator('.game-outcome').waitFor();
}
async function album(page) {
 await key(page,'a');for(let i=0;i<8;i++)await key(page,'a');await key(page,'b');await page.locator('.album-directory').waitFor();
 for(let i=0;i<3;i++)await key(page,'a');assert.equal(await page.locator('[data-album-directory]').getAttribute('data-album-directory'),'play');
 await key(page,'b');
}
async function readable(page) {
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
 const clipped=await page.locator('.album-panel').evaluate(el=>{
  const bad=[],walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const b of range.getClientRects()){
   if(!b.width||!b.height)continue;
   if(b.left < -1 || b.right > innerWidth+1)bad.push(node.textContent);
   for(let p=node.parentElement;p;p=p.parentElement){const style=getComputedStyle(p),clip=p.getBoundingClientRect();if(['hidden','clip','auto','scroll'].includes(style.overflowY)&&(b.top<clip.top-2||b.bottom>clip.bottom+2))bad.push(node.textContent);}
  }}return [...new Set(bad)];
 });assert.deepEqual(clipped,[],'card text clipped');
 for(const selector of ['.album-panel > header','.album-source:last-child','.button-a','.button-b','.button-c']) {
  const el=page.locator(selector);await el.scrollIntoViewIfNeeded();assert(await el.evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=-1&&b.bottom<=innerHeight+1;}),`${selector} unreachable`);
 }
 assert.equal(await page.locator('.physical-button').count(),3);
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
}
try {
 server=spawn(binary,[],{env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
 server.once('error',e=>startupError=e);server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 const now=Date.now();const initial=await api('import',{schema:1,revision:0,species:2,name:'小纪念伙伴',createdAt:now-3600000,hatchedAt:now-3600000,lastTick:now,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
 assert.equal(initial.state.schema,21);assert.deepEqual(cards(initial.state),[]);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1200,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.home-caption').waitFor();
 await play(page);assert.match(await page.locator('.game-keepsake-result').innerText(),/一起收好了「接星星的小缎带」/);
 const first=cards((await api('state')).state);assert.equal(first.length,1);assert.equal(first[0].item,'star-ribbon');
 await page.reload();await page.locator('.home-caption').waitFor();assert.equal(await page.locator('.game-keepsake-result').count(),0,'reload must not repeat a new-item announcement');
 await play(page);assert.equal(await page.locator('.game-keepsake-result').count(),0);assert.deepEqual(cards((await api('state')).state),first);
 const backup=await api('backup');assert.deepEqual(cards(backup),first);
 const restored=await api('import',backup);assert.deepEqual(cards(restored.state),first);
 assert.deepEqual(errors,[]);await context.close();results.push({check:'real-completions-repeat-reload-backup',passed:true});
 for(const mode of [{width:1200,height:850,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}]) {
  const ctx=await browser.newContext({viewport:{width:mode.width,height:mode.height},reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'}),p=await ctx.newPage(),writes=[],failures=[];
  p.on('pageerror',e=>failures.push(e.message));
  p.on('request',r=>{if(r.method()==='POST'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(r.url());});
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
  await p.goto(base);await p.locator('.home-caption').waitFor();await album(p);
  for(let i=0;i<backup.album.entries.length+1 && !(await p.locator('[data-keepsake-art]').count());i++)await key(p,'a');
  assert.equal(await p.locator('[data-keepsake-art]').getAttribute('data-keepsake-art'),'star-ribbon');
  assert.match(await p.locator('.album-panel h3').innerText(),/接星星的小缎带/);await readable(p);
  const selected=await p.locator('.album-panel').getAttribute('data-album-page');await key(p,'a');await key(p,'b');
  assert.equal(await p.locator('.album-panel').getAttribute('data-album-page'),selected,'reverse must return to same saved item');
  await p.screenshot({path:join(dir,`keepsake-${mode.width}-${mode.height}.png`),fullPage:true});
  assert.deepEqual(writes,[]);assert.deepEqual(failures,[]);assert.deepEqual(cards((await api('state')).state),first);
  results.push({...mode,passed:true});await ctx.close();
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({artifacts:dir,results},null,2));
} finally { if(browser)await browser.close();if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));} }
