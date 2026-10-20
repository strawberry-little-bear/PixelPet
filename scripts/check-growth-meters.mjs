// Isolated migrations, natural first seconds after hatch, and explicit layout fixtures.
// Never reads player data or the existing preview; no natural multi-day aging claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.PIXELPET_TEST_BINARY,web=process.env.PIXELPET_TEST_WEB;
assert(binary&&isAbsolute(binary),'Set absolute PIXELPET_TEST_BINARY');
assert(web&&isAbsolute(web),'Set absolute PIXELPET_TEST_WEB to an isolated build');
assert.notEqual(await realpath(binary),join(root,'bin/pixelpet'),'Do not use shared binary');
assert.notEqual(await realpath(web),join(root,'web/dist'),'Do not use shared web build');
const {chromium}=await import(process.env.PIXELPET_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'pixelpet-growth-meters-')),results=[],fixtures={};
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
const base=`http://127.0.0.1:${port}`,wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,log='',startupError;
async function api(path,body){const r=await fetch(`${base}/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();}
async function key(page,k){await page.locator(`.button-${k}`).tap();}
async function open(page){await key(page,'a');for(let i=0;i<6;i++)await key(page,'a');await key(page,'b');await page.locator('.growth-panel').waitFor();}
async function check(page,selector,p){
 const g=p.growth,stage=g?.stage??((p.lastTick-p.hatchedAt)/3600000>=72?'adult':(p.lastTick-p.hatchedAt)/3600000>=24?'growing':'baby');
 const points=g?.points??Math.min(72,(p.lastTick-p.hatchedAt)/3600000),target=stage==='adult'?72:stage==='growing'?48:24;
 const value=stage==='adult'?72:stage==='growing'?points-24:points;
 const meter=page.locator(selector).getByRole('progressbar',{name:'本阶段成长进度',exact:true});
 assert.equal(await meter.count(),1);assert.equal(Number(await meter.getAttribute('aria-valuenow')),value);
 assert.equal(await meter.getAttribute('aria-valuemin'),'0');assert.equal(Number(await meter.getAttribute('aria-valuemax')),target);
 const text=await meter.getAttribute('aria-valuetext');assert.match(text,g?/最近读取/:/旧档兼容估算/);
 assert.match(text,stage==='baby'?/幼年期/:stage==='growing'?/成长期/:/成年期/);
 if(stage!=='adult')assert.match(text,/尚未进入/);else if(g)assert.match(text,/成长完成/);
 if(value>0&&value<.01)assert.match(text,/不足 0.01/);
 if(value<target&&Number(value.toFixed(2))===target)assert(text.includes(`不足 ${target}`));
 assert.equal(await meter.getAttribute('tabindex'),null);assert.equal(await meter.getAttribute('aria-live'),null);
 assert(Math.abs(await meter.locator('i').evaluate(el=>parseFloat(el.style.width))-value/target*100)<.0001);
 const reading=value>0&&value<.1?'<0.1':(Math.floor(value*10)/10).toFixed(1);
 if(selector==='.growth-panel') {
  assert.equal(await page.locator('.growth-score > b').evaluate(el=>el.firstChild.textContent),reading,'visible growth hides a positive trace');
  if(value>0&&value<.1)assert.match(await page.locator('.growth-trace-note').innerText(),g?/已有少量成长/:/旧档兼容估算/);
 } else {
  const percent=value/target*100;
  assert.equal(await page.locator('.companion-growth > div:first-child > span:last-child').innerText(),percent>0&&percent<1?'<1%':`${Math.floor(percent)}%`,'visible percent hides a positive trace');
  if(stage!=='adult')assert((await page.locator('.companion-growth > small').innerText()).includes(`本阶段 ${reading} / ${target}`));
 }
 const ax=await meter.ariaSnapshot();assert.match(ax,/progressbar "本阶段成长进度"/);
 return {stage,value,target,text,ax};
}
async function layout(page,selector){
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');
 const errors=await page.locator(selector).evaluate(el=>{
  const content=el.closest('.lcd-content')??el,box=content.getBoundingClientRect(),footer=document.querySelector('.lcd-bottom').getBoundingClientRect(),errors=[];
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
  while((n=walker.nextNode())){if(!n.textContent.trim()||n.parentElement.closest('[aria-hidden="true"]'))continue;const range=document.createRange();range.selectNodeContents(n);
   for(const r of range.getClientRects()){
    if(!r.width||!r.height)continue;
    if(r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>(el.closest('.lcd-content')?Math.min(box.bottom,footer.top):box.bottom)+1)errors.push(n.textContent);
    for(let p=n.parentElement;p;p=p.parentElement){const css=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(css.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))errors.push('clipped '+n.textContent);}
   }
  }return errors;
 });assert.deepEqual(errors,[],'reading text clipped');
 assert.equal(await page.locator('.physical-button').count(),3);
 assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,[role=slider]').count(),0);
}
try{
 server=spawn(binary,[],{cwd:root,env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
 server.once('error',e=>startupError=e);server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 let ready=false;for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{}await wait(100);}assert(ready,log);
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const stage of ['baby','growing','adult'])for(const sleeping of [false,true]){
  const now=Date.now(),age={baby:1,growing:25,adult:80}[stage]*3600000;
  await api('import',{schema:1,revision:1,species:2,name:'成长读数',createdAt:now-age,hatchedAt:now-age,lastTick:now,sleeping,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
  const c=await browser.newContext({viewport:{width:390,height:700},hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage(),writes=[],errors=[];let snapshot;
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&!new URL(r.url()).pathname.endsWith('/visit'))writes.push(new URL(r.url()).pathname);});
  await p.route(/\/api\/(state|visit)$/,async route=>{const r=await route.fetch();const json=await r.json();snapshot=json.state;await route.fulfill({response:r,json});});
  try{
   await p.goto(base);await p.locator('.home-caption').waitFor();assert.equal(snapshot.growth.stage,stage);await check(p,'.companion-growth',snapshot);await open(p);
   const side=await check(p,'.companion-growth',snapshot),lcd=await check(p,'.growth-panel',snapshot);assert.equal(side.text,lcd.text);await layout(p,'.growth-panel');
   fixtures[stage]=structuredClone(await api('state'));await key(p,'b');assert.equal(await p.locator('.growth-panel [role=progressbar]').count(),0);await key(p,'c');
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);results.push({type:'real-old-save-read',stage,sleeping,side,lcd});
  }finally{await c.close();}
 }
 // Real first seconds of life: no response fixture or clock injection.
 // Reset is setup on this script's temporary DB only; hatch uses the actual B.
 for(const mode of [{width:1200,height:700,font:14},{width:1200,height:700,font:28},
   {width:320,height:700,font:14},{width:320,height:700,font:28},{width:320,height:380,font:28}]) {
  await api('reset',{confirm:true});
  const c=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width===320,
   reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'}),p=await c.newPage(),writes=[],errors=[];let snapshot;
  await p.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{
   document.documentElement.style.fontSize=`${font}px`;
   const style=document.createElement('style');style.textContent='.companion-growth :is(span,small){font-size:.857143rem;line-height:1.6}';document.head.append(style);
  }),mode.font);
  await p.route(/\/api\/(state|visit)$/,async route=>{const response=await route.fetch();const json=await response.json();snapshot=json.state;await route.fulfill({response,json});});
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(r.method()==='POST'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(r.postDataJSON());});
  try {
   await p.goto(base);await p.locator('.content-choose').waitFor();assert.equal(snapshot.hatchedAt,0);
   await key(p,'b');await p.locator('.hatch-view').waitFor();
   const hatchedResponse=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/action');await key(p,'b');
   const hatchResponse=await hatchedResponse;assert(hatchResponse.ok());const hatched=(await hatchResponse.json()).state;
   await p.waitForFunction(()=>!document.querySelector('.button-b').disabled&&!document.querySelector('[data-motion="celebrating"]'));
   await wait(1000);
   const visited=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/visit');
   await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert((await visited).ok());await wait(100);
   assert(snapshot.growth.points>0&&snapshot.growth.points<.1,'natural trace was not exercised');assert.equal(snapshot.growth.stage,'baby');
   await open(p);const side=await check(p,'.companion-growth',snapshot),lcd=await check(p,'.growth-panel',snapshot);
   assert.equal(side.text,lcd.text);await layout(p,'.growth-panel');await layout(p,'.companion-growth');
   await p.screenshot({path:join(dir,`natural-${mode.width}-${mode.height}-${mode.font}.png`),fullPage:true});
   await p.reload();await p.locator('.home-caption').waitFor();await open(p);await check(p,'.growth-panel',snapshot);await check(p,'.companion-growth',snapshot);
   assert.deepEqual(writes.map(w=>w.kind),['hatch']);assert.deepEqual(snapshot.economy,hatched.economy);assert.equal(snapshot.careCount,0);
   assert.deepEqual(errors,[]);results.push({type:'natural-first-growth',...mode,side,lcd,reloadedPoints:snapshot.growth.points});
  }catch(e){await p.screenshot({path:join(dir,`failure-natural-${mode.width}-${mode.height}-${mode.font}.png`),fullPage:true});throw e;}
  finally{await c.close();}
 }
 const cases=[['baby',0],['baby',.0001],['baby',.12],['baby',.24],['baby',23.999999],['growing',24],['growing',24.0001],['growing',24.25],['growing',24.5],['growing',71.999999],['adult',72],['legacy',1],['legacy-adult',72]];
 for(const width of [1200,320])for(const scale of [1,2]){
  const fixtureNow=Date.now();
  const c=await browser.newContext({viewport:{width,height:700},isMobile:width===320,hasTouch:true,reducedMotion:'reduce',forcedColors:scale===2?'active':'none'}),p=await c.newPage(),errors=[];let fixture;
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({scale,now})=>{Date.now=()=>now;document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=`.reading-mode .growth-panel :is(p,small,strong,b,span,li,time,header,h3,dt,dd),.companion-growth :is(span,small){font-size:${12*scale}px!important;line-height:1.6!important}.lcd-bottom{font-size:${9*scale}px!important}`;document.head.append(style);});},{scale,now:fixtureNow});
  await p.route('**/api/**',async route=>{assert(['/api/state','/api/visit'].includes(new URL(route.request().url()).pathname),'reading attempted write');fixture.serverTime=fixtureNow;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
  try{
   for(const [stage,points]of cases){
    fixture=structuredClone(fixtures[stage==='legacy'?'baby':stage==='legacy-adult'?'adult':stage]);fixture.state.sleeping=false;fixture.state.growth.points=points;
    if(stage.startsWith('legacy')){fixture.state.schema=1;fixture.state.lastTick=fixtureNow;fixture.state.hatchedAt=fixtureNow-(stage==='legacy-adult'?80:1)*3600000;delete fixture.state.growth;}
    await p.goto(base);await p.locator('.home-caption').waitFor();await open(p);
    const side=await check(p,'.companion-growth',fixture.state),lcd=await check(p,'.growth-panel',fixture.state);assert.equal(side.text,lcd.text);
    await layout(p,'.growth-panel');await layout(p,'.companion-growth');
    const size=await p.locator('.growth-next').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.equal(size,12*scale);
    if(stage==='baby'&&points>23||stage==='adult'||points===.0001||points===24.0001)await p.screenshot({path:join(dir,`${stage}-${points}-${width}-${scale}.png`),fullPage:true});
    results.push({type:'reading-layout-fixture',stage,points,width,scale,size,side,lcd});
   }
   assert.deepEqual(errors,[]);
  }catch(e){await p.screenshot({path:join(dir,`failure-${width}-${scale}.png`),fullPage:true});throw e;}finally{await c.close();}
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({groups:results.length,artifacts:dir,port}));
}finally{
 if(browser)await browser.close();if(server&&server.exitCode===null&&server.signalCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await closed;}
 await writeFile(join(dir,'server.log'),log);console.log('Artifacts:',dir);
}
