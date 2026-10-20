// Shop reply safety and empty Go ownership, isolated HTTP service/save/random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.PIXELPET_TEST_BINARY, web = process.env.PIXELPET_TEST_WEB;
assert(binary && isAbsolute(binary), 'Set absolute isolated PIXELPET_TEST_BINARY');
assert(web && isAbsolute(web), 'Set absolute isolated PIXELPET_TEST_WEB');
const shared = path => realpath(path).catch(e => { if (e.code === 'ENOENT') return resolve(path); throw e; });
assert.notEqual(await realpath(binary), await shared(join(root, 'bin/pixelpet')), 'Do not use shared binary');
assert.notEqual(await realpath(web), await shared(join(root, 'web/dist')), 'Do not use shared web build');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-shop-response-')), dbPath = join(dir, 'test.db'), results = [];
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(e => e ? reject(e) : resolve(port)); });
});
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, log = '';
async function api(path, body, headers = {}) {
  const response = await fetch(`${base}/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert(response.ok, `${path}: ${await response.clone().text()}`); return response.json();
}
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed;
  }
}
async function start() {
  let startupError;
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`,
    PIXELPET_DB: dbPath, PIXELPET_WEB: web }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, log);
    try { if ((await fetch(base + '/api/state')).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Server did not start: ' + log);
}
async function key(page, k) {
  await page.locator(`.button-${k.toLowerCase()}`).tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
const modes=[{width:1200,height:700,font:14},{width:320,height:380,font:28}];
async function seed(){
  const at=Date.now();let pet=(await api('import',{schema:1,revision:1,species:2,name:'小店核对',createdAt:at-3600000,
    hatchedAt:at-3600000,lastTick:at,sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,logs:[]})).state;
  pet.economy.coins=40;return(await api('import',pet)).state;
}
async function open(page){await key(page,'A');for(let i=0;i<9;i++)await key(page,'A');await key(page,'B');}
async function allItems(page){await open(page);await key(page,'A');await key(page,'B');await page.locator('.shop-panel h3').waitFor();}
async function recovery(page,errors){
  // Fail immediately on a real render exception rather than timing out on an
  // element which a crashed old build cannot create.
  for(let i=0;i<100;i++){if(errors.length||await page.locator('.save-recovery').count())break;await wait(50);}
  assert.deepEqual(errors,[],'Reply must be rejected before a React render crash');
  assert.equal(await page.locator('.save-recovery').count(),1,'Expected read-only recovery');
  assert.equal(await page.locator('.button-b').isEnabled(),true);
}
async function readable(page,selector){
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  await page.locator(selector).evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text;
    while((text=walker.nextNode())){
      if(!text.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(text);
      const lines=Array.from(range.getClientRects(),r=>({top:r.top+scrollY,left:r.left,width:r.width,height:r.height}));
      for(const line of lines){
        window.scrollTo({top:line.top-12,behavior:'instant'});
        const top=line.top-scrollY,hit=document.elementFromPoint(line.left+line.width/2,top+line.height/2);
        if(line.left< -1||line.left+line.width>innerWidth+1||top<0||top+line.height>innerHeight||!hit||!text.parentElement.contains(hit))
          throw new Error('Shop/recovery text clipped or blocked: '+text.textContent);
      }
    }
  });
}
try{
  await start();browser=await chromium.launch({channel:'chrome',headless:true});
  for(const profile of ['poll-catalog','initial-equipment','buy-ownership','empty-null','empty-omitted','legacy'])for(const mode of modes){
    const before=await seed(),context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,
      isMobile:mode.width===320,reducedMotion:'reduce',forcedColors:mode.width===320?'active':'none'});
    const page=await context.newPage(),errors=[],writes=[],label=`${profile}-${mode.width}`;let damage=profile==='initial-equipment';
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()!=='GET'&&!['/api/state','/api/visit'].includes(path))writes.push({path,body:r.postDataJSON()});});
    await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
    await page.route('**/api/**',async route=>{
      const res=await route.fetch(),body=await res.json();
      if(body.state){
        if(profile==='legacy'){delete body.state.economy;delete body.shop;}
        if(profile.startsWith('empty')&&!body.state.economy.owned.length){
          if(profile==='empty-null')body.state.economy.owned=null;else delete body.state.economy.owned;
        }
        if(damage){
          if(profile==='initial-equipment')body.state.economy.equipped=null;
          if(profile==='poll-catalog')body.shop.catalog=[null];
          if(profile==='buy-ownership')body.state.economy.owned={};
        }
      }
      await route.fulfill({response:res,json:body});
    });
    try{
      await page.goto(base);
      if(profile==='initial-equipment'){
        await recovery(page,errors);await readable(page,'.save-recovery');
        assert.equal(await page.locator('.button-a').isDisabled(),true);
        assert.equal(await page.locator('.button-c').isDisabled(),true);
        await page.keyboard.press('a');await page.keyboard.press('c');assert.deepEqual(writes,[]);
        await page.screenshot({path:join(dir,`${label}-recovery.png`),fullPage:true});damage=false;await key(page,'B');await page.locator('.home-caption').waitFor();
      }else{
        await page.locator('.home-caption').waitFor();
        if(profile==='legacy'){
          await open(page);assert.match(await page.locator('.shop-panel').innerText(),/小店还没开门/);
          await key(page,'B');assert.deepEqual(writes,[]);await readable(page,'.shop-panel');await key(page,'C');
        }else if(profile==='poll-catalog'){
          await allItems(page);damage=true;
          const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/visit');
          await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await read;
          await recovery(page,errors);await readable(page,'.save-recovery');await page.screenshot({path:join(dir,`${label}-recovery.png`),fullPage:true});
          // A failed ordinary read retains the existing shop page; successful
          // reconciliation must restore it, not force a return to the home.
          damage=false;await key(page,'B');await page.locator('.shop-panel h3').waitFor();
          assert.equal(await page.locator('.save-recovery').count(),0);
          assert.match(await page.locator('.shop-panel h3').innerText(),/嫩叶胸针/);
          await key(page,'C');await key(page,'C');await page.locator('.home-caption').waitFor();
        }else{
          if(profile.startsWith('empty')){
            await open(page);for(let i=0;i<6;i++)await key(page,'A');await key(page,'B');
            assert.match(await page.locator('.shop-panel').innerText(),/这里还空着呢/);await readable(page,'.shop-panel');
            await key(page,'C');for(let i=0;i<2;i++)await key(page,'A');await key(page,'B');
          }else await allItems(page);
          assert.match(await page.locator('.shop-panel h3').innerText(),/嫩叶胸针/);
          await key(page,'B');assert.equal(await page.locator('.shop-panel').getAttribute('data-confirm'),'true');
          await key(page,'C');assert.deepEqual(writes,[]);await key(page,'B');
          damage=profile==='buy-ownership';await key(page,'B');
          if(damage){
            await recovery(page,errors);assert.match(await page.locator('[role=alert]').innerText(),/可能已经保存/);
            await readable(page,'.save-recovery');await page.screenshot({path:join(dir,`${label}-recovery.png`),fullPage:true});
            await page.keyboard.press('a');await page.keyboard.press('c');assert.equal(writes.length,1);
            const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await key(page,'B');await read;await recovery(page,errors);
            damage=false;await key(page,'B');await page.locator('.home-caption').waitFor();
            assert.equal(await page.locator('.pet-scene').getAttribute('data-motion'),'idle');
            await allItems(page);
          }
          assert.match(await page.locator('.shop-panel h3').innerText(),/已拥有/);
          await readable(page,'.shop-panel');await page.screenshot({path:join(dir,`${label}-owned.png`),fullPage:true});
          await page.reload();await page.locator('.home-caption').waitFor();await allItems(page);
          assert.match(await page.locator('.shop-panel h3').innerText(),/已拥有/);
          assert.equal(writes.length,1);assert.equal(writes[0].body.kind,'buy');assert.equal(writes[0].body.item,'leaf-pin');
          await key(page,'C');await key(page,'C');
        }
      }
      assert.equal(await page.locator('.physical-button').count(),3);
      assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);assert.deepEqual(errors,[]);
      const after=(await api('state')).state,bought=profile==='buy-ownership'||profile.startsWith('empty');
      assert.equal(after.economy.coins,before.economy.coins-(bought?12:0));
      assert.deepEqual(after.economy.owned,bought?['leaf-pin']:[]);assert.deepEqual(after.economy.equipped,before.economy.equipped);
      assert.equal(after.careCount,before.careCount);assert.deepEqual(after.album,before.album);assert.deepEqual(after.companion,before.companion);
      assert.equal(after.growth.growingAt,before.growth.growingAt);assert.equal(after.growth.adultAt,before.growth.adultAt);
      assert.equal(writes.length,bought?1:0);results.push({profile,...mode,writes,coins:after.economy.coins});
    }catch(e){console.error('Page errors:',errors);await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});throw e;}
    finally{await context.close();}
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({groups:results.length,artifacts:dir}));
}catch(e){console.error('Artifacts:',dir);throw e;}
finally{if(browser)await browser.close();await stop();await writeFile(join(dir,'server.log'),log);}
