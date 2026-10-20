// Constructed wallet boundaries, then real A/B/C buy + greeting on private saves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {binary,web}=await isolatedTestBuilds({root});
const {chromium}=await import(process.env.PIXELPET_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'pixelpet-shop-greeting-')),results=[];
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base=`http://127.0.0.1:${port}`,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,startupError,log='';
async function api(path,body){
  const response=await fetch(`${base}/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert(response.ok,await response.clone().text());return response.json();
}
async function key(page,key){await page.locator(`.button-${key.toLowerCase()}`).tap();await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled)}
async function open(page){await key(page,'A');for(let i=0;i<9;i++)await key(page,'A');await key(page,'B');await page.locator('.shop-panel').waitFor()}
async function readable(page){
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  await page.locator('.shop-decision').evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const lines=Array.from(range.getClientRects(),r=>({top:r.top+scrollY,left:r.left,width:r.width,height:r.height}));
    for(const line of lines){
      window.scrollTo({top:line.top-12,behavior:'instant'});
      const top=line.top-scrollY,hit=document.elementFromPoint(line.left+line.width/2,top+line.height/2);
      if(line.left<0||line.left+line.width>innerWidth+1||top<0||top+line.height>innerHeight||!hit||!el.contains(hit))throw Error('Greeting decision unreadable');
    }
  });
  assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(),0);
  assert.equal(await page.locator('.physical-button').count(),3);
}
try{
  server=spawn(binary,[],{cwd:root,env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
  server.once('error',e=>{startupError=e});server.stdout.on('data',d=>{log+=d});server.stderr.on('data',d=>{log+=d});
  let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{await api('state');ready=true;break}catch{await wait(100)}}assert(ready,log);
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const mode of [{width:1200,height:850,font:14,space:9},{width:320,height:380,font:28,space:0}]){
    const now=Date.now();let r=await api('import',{schema:1,revision:1,species:2,name:'问候测试伙伴',createdAt:now-3600000,hatchedAt:now-3600000,lastTick:now,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
    const rules=r.shop,coins=rules.maxCoins-mode.space;
    r.state.economy.coins=coins;await api('import',r.state);
    // The backend refuses a partial greeting, without consuming the claim.
    const rejected=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'daily'})});
    assert.equal(rejected.status,400);assert((await rejected.text()).includes('小钱包装满'));
    assert.equal((await api('state')).state.economy.lastDailyAt,0);
    const ctx=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width<700,reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'});
    const page=await ctx.newPage(),writes=[],errors=[];
    page.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/action')writes.push(req.postDataJSON())});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize=`${font}px`),mode.font);
    try{
      await page.goto(base);await open(page);
      assert.equal(await page.locator('.shop-decision').textContent(),`钱包放不下本次 ${rules.dailyCoins} 金币；本次未领取，腾出空间后可再领。`);
      await readable(page);
      const decisionFont=await page.locator('.shop-decision').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
      assert(decisionFont>=mode.font*.85,'decision text did not scale');
      for(let i=0;i<2;i++)await key(page,'B');
      await readable(page);
      await page.locator('.shop-decision').evaluate(el=>el.scrollIntoView({block:'start'}));
      await page.screenshot({path:join(dir,`blocked-${mode.width}.png`)});
      assert.equal(writes.length,0,'known-invalid claim sent');
      assert.equal((await api('state')).state.economy.coins,coins);assert.equal((await api('state')).state.economy.lastDailyAt,0);
      await page.reload();await page.locator('.home-caption').waitFor();await open(page);
      assert((await page.locator('.shop-decision').textContent()).includes('本次未领取'));assert.equal(writes.length,0);
      // Buying is optional; here it exercises re-evaluation from a real saved balance.
      await key(page,'A');await key(page,'B');await page.locator('.shop-panel h3').waitFor();
      const item=rules.catalog[0];await key(page,'B');await key(page,'B');
      assert.equal((await api('state')).state.economy.coins,coins-item.price);
      await key(page,'C');for(let i=0;i<6;i++)await key(page,'A');
      assert.equal(await page.locator('.shop-decision').textContent(),`B 收下 ${rules.dailyCoins} 金币`);
      assert.equal(writes.filter(w=>w.kind==='daily').length,0,'balance change automatically claimed');
      await key(page,'B');await readable(page);
      assert.equal(await page.locator('.shop-decision').textContent(),'今日已领取 · 不必连续来');
      const final=(await api('state')).state;
      assert.equal(final.economy.coins,coins-item.price+rules.dailyCoins);assert(final.economy.lastDailyAt>0);
      await key(page,'B');assert.equal(writes.filter(w=>w.kind==='daily').length,1);
      await page.reload();await page.locator('.home-caption').waitFor();await open(page);
      assert.equal(await page.locator('.shop-decision').textContent(),'今日已领取 · 不必连续来');
      assert.equal((await api('state')).state.economy.coins,final.economy.coins);assert.deepEqual(errors,[]);
      results.push({...mode,decisionFont,coins:final.economy.coins,writes:writes.map(w=>w.kind)});
    }catch(e){await page.screenshot({path:join(dir,'failure.png'),fullPage:true});console.error('Artifacts:',dir);throw e}finally{await ctx.close()}
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({dir,groups:results.length,results},null,2));
}finally{
  if(browser)await browser.close();
  if(server&&server.exitCode===null&&server.signalCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed}
}
