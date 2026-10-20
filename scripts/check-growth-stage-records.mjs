// Native growth-stage records, isolated HTTP service/save/random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-stage-records-')), dbPath = join(dir, 'test.db'), results = [];
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
async function readAll(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  await page.locator('.growth-look-guide').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({top:r.top + scrollY,left:r.left,width:r.width,height:r.height}));
      for (const line of lines) {
        window.scrollTo({top:line.top - 12,behavior:'instant'});
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit))
          throw new Error('Growth date line clipped/unreachable: ' + text.textContent);
      }
    }
  });
}
const stages = ['baby','growing','adult'], labels = ['幼年期','成长期','成年期'];
const hour = 3600000;
const modes = [{width:1200,height:700,font:14},{width:320,height:380,font:28}];
async function seed(profile) {
  const stage = ['legacy','unknown','missing'].includes(profile)?'adult':profile;
  let at = Date.now(); const age = 100*hour;
  if (profile==='legacy') return (await api('import',{schema:1,revision:1,species:2,name:'成长足迹',createdAt:at-age,
    hatchedAt:at-age,lastTick:at,sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,logs:[]})).state;
  await api('reset',{confirm:true});
  const pet = (await api('action',{kind:'hatch',species:2})).state; at=Date.now();
  pet.createdAt=pet.hatchedAt=at-age;pet.lastTick=at;pet.album.since=pet.hatchedAt;
  // Keep the constructed 100-hour history complete so the first real read
  // does not legitimately append an elapsed-day memory to our baseline.
  pet.album.entries=[{kind:'hatch',at:pet.hatchedAt,source:'shared'},
    {kind:'days',at:pet.hatchedAt+24*hour,source:'elapsed',days:1}];
  Object.assign(pet.growth,{stage,points:stage==='adult'?72:stage==='growing'?40:8,
    growingAt:stage==='baby'?0:at-60*hour,adultAt:stage==='adult'?at-hour:0,form:stage==='adult'?'gentle':''});
  for (const s of ['growing','adult']) {
    const stamp = s==='growing'?pet.growth.growingAt:pet.growth.adultAt;
    if(stamp)pet.album.entries.push({kind:s,at:stamp,source:'shared',...(s==='adult'?{form:'gentle'}:{})});
  }
  return (await api('import',pet)).state;
}
async function open(page) {await key(page,'A');for(let i=0;i<6;i++)await key(page,'A');await key(page,'B');for(let i=0;i<5;i++)await key(page,'A');}
async function verify(page, pet, profile) {
  const panel = page.getByRole('region',{name:'成长手册阅读区'});
  assert.equal(await page.locator('.growth-page-dots').innerText(),'6 / 6');
  assert.equal(await page.getByRole('group',{name:'幼年期时间'}).count(),1,'Dated stage poses need named history groups');
  for (const [i,s] of stages.entries()) {
    const item = page.getByRole('group',{name:`${labels[i]}时间`}), stamp = s==='baby'?pet.hatchedAt:s==='growing'?pet.growth.growingAt:pet.growth.adultAt;
    const date = item.locator('time'), text = await item.innerText();
    if (profile==='missing' && s!=='baby') {assert.equal(await date.count(),0);assert.match(text,/成长记录尚未读到/);}
    else if (!stamp) {assert.equal(await date.count(),0);assert.match(text,/尚未/);}
    else {
      assert.equal(await date.getAttribute('datetime'),new Date(stamp).toISOString());
      assert.match(text,profile==='legacy'?/旧档记录/:['unknown','missing'].includes(profile)?/来源未注明/:/成长经历记录/);
    }
  }
  assert.equal(await page.locator('.physical-button').count(),3);
  assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
  const before = await panel.innerText();
  // Reach the pre-existing parent reading stop through native keyboard navigation.
  for(let i=0;i<10 && !await panel.evaluate(el=>document.activeElement===el);i++) await page.keyboard.press('Shift+Tab');
  assert(await panel.evaluate(el=>document.activeElement===el));
  await readAll(page);assert.equal(await panel.innerText(),before);
  return panel;
}
try {
  await start();browser=await chromium.launch({channel:'chrome',headless:true});
  for(const profile of ['baby','growing','adult','legacy','unknown','missing'])for(const mode of modes){
    const pet=await seed(profile), context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,
      isMobile:mode.width===320,reducedMotion:'reduce',forcedColors:mode.width===320?'active':'none'});
    const page=await context.newPage(), writes=[],errors=[],label=`${profile}-${mode.width}`;
    page.setDefaultTimeout(6000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()!=='GET'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(new URL(r.url()).pathname);});
    await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
    // These profiles change optional response fields only, not the actual save.
    if(['unknown','missing'].includes(profile))await page.route('**/api/**',async route=>{
      const res=await route.fetch(),body=await res.json();if(body.state){delete body.state.album;if(profile==='missing')delete body.state.growth;}
      await route.fulfill({response:res,json:body});
    });
    try{
      await page.goto(base);await page.locator('.home-caption').waitFor();await open(page);
      const panel=await verify(page,pet,profile),before=await panel.innerText();
      assert(Math.abs(parseFloat(await page.locator('.growth-stage-record time').first().evaluate(el=>getComputedStyle(el).fontSize))-mode.font*12/14)<.1);
      await page.locator('.growth-stage-record').first().scrollIntoViewIfNeeded();
      await page.screenshot({path:join(dir,`${label}-top.png`)});
      await page.locator('.growth-stage-record').last().scrollIntoViewIfNeeded();
      await page.screenshot({path:join(dir,`${label}-bottom.png`)});
      const position=await page.evaluate(()=>scrollY),read=page.waitForResponse(r=>['/api/state','/api/visit'].includes(new URL(r.url()).pathname));
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await read;await wait(150);
      assert.equal(await panel.innerText(),before);assert(await panel.evaluate(el=>document.activeElement===el));assert.equal(await page.evaluate(()=>scrollY),position);
      await key(page,'B');assert.equal(await page.locator('.growth-page-dots').innerText(),'1 / 6');
      await key(page,'C');await page.locator('.home-caption').waitFor();assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
      const after=(await api('state')).state;
      for(const k of ['hatchedAt','careCount','economy','album'])assert.deepEqual(after[k],pet[k]);
      assert.equal(after.growth.growingAt,pet.growth.growingAt);assert.equal(after.growth.adultAt,pet.growth.adultAt);
      results.push({profile,...mode,dates:[pet.hatchedAt,pet.growth.growingAt,pet.growth.adultAt],writes});
    }catch(e){await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});throw e;}
    finally{await context.close();}
  }
  // Construct near-threshold fixtures; the subsequent milestone itself is real
  // HTTP care, not a mocked response, elapsed clock jump or claimed multi-day play.
  for(const target of ['growing','adult'])for(const mode of modes){
    let pet=await seed(target==='growing'?'baby':'growing');
    pet.growth.points=target==='growing'?23.95:71.95;pet.needs.hunger=60;
    pet=(await api('import',pet)).state;
    const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width===320,reducedMotion:'reduce',forcedColors:mode.width===320?'active':'none'});
    const page=await context.newPage(),writes=[],errors=[],label=`care-${target}-${mode.width}`;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()!=='GET'&&!['/api/state','/api/visit'].includes(new URL(r.url()).pathname))writes.push(r.postDataJSON().kind);});
    await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
    try{
      await page.goto(base);await page.locator('.home-caption').waitFor();await key(page,'A');
      const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action');await key(page,'B');const ack=await(await pending).json();
      assert.equal(ack.state.growth.stage,target);assert(ack.careFeedback?.milestone);
      await key(page,'C');await key(page,'C');await open(page);await verify(page,ack.state,target);
      await page.locator('.growth-stage-record').last().scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,`${label}.png`)});
      await key(page,'C');await page.reload();await page.locator('.home-caption').waitFor();await open(page);
      await verify(page,ack.state,target);
      assert.deepEqual(writes,['feed']);assert.deepEqual(errors,[]);
      const after=(await api('state')).state;assert.equal(after.careCount,ack.state.careCount);assert.deepEqual(after.album,ack.state.album);
      assert.equal(after.growth.growingAt,ack.state.growth.growingAt);assert.equal(after.growth.adultAt,ack.state.growth.adultAt);
      assert.deepEqual(after.economy,ack.state.economy);results.push({profile:`care-${target}`,...mode,feedback:ack.careFeedback,writes});
    }catch(e){await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});throw e;}
    finally{await context.close();}
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({groups:results.length,artifacts:dir}));
}catch(e){console.error('Artifacts:',dir);throw e;}
finally{if(browser)await browser.close();await stop();await writeFile(join(dir,'server.log'),log);}
