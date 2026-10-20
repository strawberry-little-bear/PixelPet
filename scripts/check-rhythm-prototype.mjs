// Opt-in Chrome acceptance of the isolated, in-memory rhythm lab only.
// Starts its own loopback servers, never accepts a production URL/database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rhythm-'));
const servers = [], contexts = [], results = [], errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
let browser;
async function start(up = 0, down = 0, jitter = 0) {
  const child = spawn(process.execPath, ['prototypes/rhythm/server.mjs'], { cwd: root, env: { ...process.env,
    PIXELPET_RHYTHM_PORT: '0', PIXELPET_RHYTHM_UP_MS: String(up), PIXELPET_RHYTHM_DOWN_MS: String(down), PIXELPET_RHYTHM_JITTER_MS: String(jitter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
  for (let i = 0; i < 100 && !stdout.includes('\n'); i++) { assert(child.exitCode === null, stderr); await wait(50); }
  assert(stdout.includes('\n'), `server startup timeout: ${stderr}`);
  return JSON.parse(stdout.split('\n')[0]).url;
}
async function open(url, options = {}) {
  const context = await browser.newContext(options); contexts.push(context);
  const page = await context.newPage(), requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { requests.push({ url: req.url(), body: req.postDataJSON?.() }); });
  await page.goto(url); await page.waitForFunction(() => !document.querySelector('#pause').hidden && !document.querySelector('#status').textContent.includes('正在核对'));
  return { page, context, requests };
}
const key = (p, k) => p.keyboard.press(k);
const idle = p => p.waitForFunction(() => !document.querySelector('#status').textContent.includes('正在核对'));
const active = p => p.waitForFunction(() => document.body.classList.contains('active'));
const paused = p => p.waitForFunction(() => !document.querySelector('#pause').hidden && !document.body.classList.contains('active') && !document.querySelector('#status').textContent.includes('正在核对'));
async function readable(page) {
  assert.equal(await page.locator('button').count(), 3);
  assert.equal(await page.locator('.screen button,.screen a,.screen input,.screen [role=button]').count(), 0);
  const issues = await page.evaluate(() => {
    const issues = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim() || ['SCRIPT','STYLE'].includes(n.parentElement.tagName)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) issues.push(n.textContent);
        for (let p = n.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p), r = p.getBoundingClientRect();
          if (['hidden','clip'].includes(s.overflowY) && (box.top < r.top-2 || box.bottom > r.bottom+2)) issues.push(n.textContent);
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], 'layout readable');
  for (const button of await page.locator('button').all()) {
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && el === document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); });
    assert(hit, 'physical key reachable');
  }
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const base = await start();
  // HTTP boundary checks, including actual out-of-order delivery in a second server.
  const post = (url, input, origin = url) => fetch(url + '/lab/command', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:typeof input === 'string' ? input : JSON.stringify(input) });
  assert.equal((await fetch(base + '/api/state')).status, 404);
  assert.equal((await post(base, {kind:'create'}, 'https://example.invalid')).status, 403);
  assert.equal((await post(base, '{')).status, 400);
  assert.equal((await post(base, [])).status, 400);
  assert.equal((await post(base, {padding:'x'.repeat(5000)})).status, 413);
  let response = await post(base, {kind:'create'}), s = (await response.json()).state;
  assert.equal(s.status, 'paused');
  response = await post(base, {kind:'resume', id:s.id, requestId:1}); s = (await response.json()).state;
  assert.equal(s.status, 'playing');
  assert.equal((await post(base, {kind:'answer',id:s.id,requestId:2,key:'A',sequence:0})).status, 409);
  assert.equal((await post(base, {kind:'pause',id:s.id,requestId:3})).status, 200);
  assert.equal((await post(base, {kind:'resume',id:s.id,requestId:2})).status, 409);
  const raceBase = await start(0, 0, 250);
  const raceState = (await (await post(raceBase, {kind:'create'})).json()).state;
  const oldResume = post(raceBase, {kind:'resume',id:raceState.id,requestId:1}); // odd request delayed upstream
  await wait(25);
  assert.equal((await post(raceBase, {kind:'pause',id:raceState.id,requestId:2})).status,200);
  assert.equal((await oldResume).status,409);
  assert.equal((await (await post(raceBase, {kind:'resume',id:raceState.id,requestId:3})).json()).state.observations.length,0);
  results.push('HTTP: same-origin/JSON/body limits/no game API/stale cue and reordered pause-resume');

  const {page, context, requests} = await open(base);
  await readable(page); await page.screenshot({path:join(dir,'desktop-paused.png'),fullPage:true});
  await key(page,'B'); await idle(page);
  await key(page,'A'); await idle(page); assert.equal(await page.locator('#round').textContent(),'0 / 12');
  assert.match(await page.locator('#status').textContent(), /没有消耗/);
  await active(page);
  await page.keyboard.down('A'); await page.keyboard.down('A'); await page.keyboard.up('A');
  await page.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12');
  assert.equal(requests.filter(r => r.body?.kind === 'answer').length,1);
  await key(page,'C'); await paused(page); const n = requests.length;
  await wait(2200); assert.equal(requests.length,n, 'paused has no polling/automatic continuation');
  await key(page,'C'); await idle(page);
  for (let i=1; i<12; i++) {
    await active(page);
    const direction = await page.locator('#direction').textContent();
    await key(page, direction.includes('A') ? 'A' : 'B');
    await page.waitForFunction(n => document.querySelector('#round').textContent === `${n} / 12`,i+1);
    await idle(page);
  }
  assert.match(await page.locator('#status').textContent(), /12 次观测已完成/);
  assert.equal(await page.locator('#observations li').count(),12);
  await readable(page); await page.screenshot({path:join(dir,'desktop-complete.png'),fullPage:true});
  await key(page,'B'); await paused(page); assert.equal(await page.locator('#round').textContent(),'0 / 12');
  await key(page,'A'); assert.match(await page.locator('#selection').textContent(), /从头重开/);
  await key(page,'B'); await paused(page); assert.match(await page.locator('#selection').textContent(), /继续练习/);
  await key(page,'C'); await idle(page); await page.reload(); await paused(page);
  assert.equal(await page.locator('#round').textContent(),'0 / 12');
  assert.deepEqual(await page.evaluate(() => [localStorage.length,sessionStorage.length]),[0,0]);
  assert.equal((await context.cookies()).length,0);
  assert(requests.every(r => new URL(r.url).origin === base && !r.url.includes('/api/')));
  results.push('Desktop: preview/held key/12 real-time cues/restart/refresh/three keys/no storage or production API');

  for (const [label,up,down,jitter] of [['100ms',50,50,0],['300ms asymmetric',250,50,0],['300ms jitter',40,60,200],['800ms',400,400,0]]) {
    const b = await start(up,down,jitter), {page:p,requests:rs} = await open(b);
    await key(p,'B');
    if(up+down+jitter>600) {
      await p.waitForFunction(() => document.querySelector('#status').textContent.includes('中性暂停'));
      await paused(p); assert.equal(await p.locator('#round').textContent(),'0 / 12');
    } else {
      await idle(p); await active(p); await key(p,'A');
      await p.waitForFunction(() => document.querySelector('#round').textContent==='1 / 12'); await idle(p);
      await key(p,'C'); await paused(p);
    }
    const total=rs.length; await wait(1000); assert.equal(rs.length,total);
    results.push(`Synthetic ${label}: ${up+down+jitter>600?'neutral pause, not timing fairness':'response then explicit pause'}`);
  }
  // C cancels in-flight resume and answer; old replies must not repaint/continue.
  const slow = await start(200,200,0), {page:p,requests:rs,context:ctx} = await open(slow);
  await key(p,'B'); await wait(30); await key(p,'C'); await paused(p); await wait(500);
  assert.equal(await p.locator('#round').textContent(),'0 / 12'); assert.equal(await p.locator('#direction').textContent(),'已暂停');
  await key(p,'C'); await idle(p); await active(p); await key(p,'A'); await wait(30); await key(p,'C');
  await paused(p); await wait(500); assert.equal(await p.locator('#direction').textContent(),'已暂停');
  const before = rs.filter(r=>r.body?.kind==='answer').length;
  await key(p,'C'); await idle(p); await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await paused(p);
  await key(p,'C'); await idle(p);
  // Exercise visibility handling without claiming this is an OS background test.
  await p.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
  await paused(p); await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await wait(300); assert.equal(await p.locator('#direction').textContent(),'已暂停');
  await key(p,'C'); await idle(p); await ctx.setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await paused(p);
  const disconnected = rs.length; await wait(700); assert.equal(rs.length,disconnected,'no retry while offline');
  await ctx.setOffline(false); await wait(500); assert.equal(rs.length,disconnected,'no auto reconnect');
  await key(p,'C'); await paused(p); assert.match(await p.locator('#status').textContent(), /重新核对暂停/);
  await key(p,'C'); await idle(p); await key(p,'C'); await paused(p);
  assert.equal(rs.filter(r=>r.body?.kind==='answer').length,before,'never resend old answer');
  results.push('Delayed replies: C cancels resume/answer; simulated blur/visibility; offline and manual recovery without retry');

  await key(p,'C'); await idle(p); await active(p);
  await p.route('**/lab/command', async route => {
    if(route.request().postDataJSON().kind === 'answer') await route.abort('failed'); else await route.continue();
  });
  const droppedBefore = rs.filter(r=>r.body?.kind==='answer').length;
  await key(p,'A'); await paused(p); await wait(600);
  assert.equal(rs.filter(r=>r.body?.kind==='answer').length,droppedBefore+1,'dropped answer never retried');
  assert.match(await p.locator('#status').textContent(), /连接未确认/);
  await p.unroute('**/lab/command');
  results.push('Dropped response request pauses once, never automatically resends answer');
  await key(p,'C'); await idle(p);
  await p.evaluate(() => { const until=performance.now()+1100; while(performance.now()<until) {} });
  await paused(p); assert.match(await p.locator('#status').textContent(), /页面停顿/);
  results.push('Real 1100ms main-thread stall produces neutral pause, no catch-up');

  // A delayed initial create must stay paused even if hidden before it replies.
  const {page:init} = await open(base);
  await init.route('**/lab/command',async route=>{ await wait(300); await route.continue(); });
  await init.reload({waitUntil:'domcontentloaded'});
  await init.evaluate(() => window.dispatchEvent(new Event('blur'))); await paused(init);
  assert.equal(await init.locator('#round').textContent(),'0 / 12');
  results.push('Delayed create during blur remains a usable paused session');

  for(const options of [
    {label:'mobile-touch',viewport:{width:390,height:844},hasTouch:true,isMobile:true},
    {label:'320-double-text',viewport:{width:320,height:740},hasTouch:true,isMobile:true,double:true},
    {label:'reduced-motion',viewport:{width:1000,height:850},reducedMotion:'reduce'},
    {label:'forced-colors',viewport:{width:1000,height:850},forcedColors:'active'},
  ]) {
    const {label,double,...opts}=options, {page:m}=await open(base,opts);
    if(double) await m.evaluate(()=>document.documentElement.style.fontSize='32px');
    await readable(m);
    const press = k => opts.hasTouch ? m.locator(`[data-key="${k}"]`).tap() : key(m,k);
    await press('B'); await idle(m); await active(m);
    const visible = await m.locator('.cue').evaluate(el => {
      const r=el.getBoundingClientRect(), keys=document.querySelector('.keys').getBoundingClientRect();
      return r.top>=0 && r.bottom<=innerHeight && (getComputedStyle(document.querySelector('.keys')).position!=='fixed'||r.bottom<=keys.top);
    });
    assert(visible,'direction and timing visible above keys without test scrolling');
    await m.screenshot({path:join(dir,`${label}-active-viewport.png`)});
    if(opts.reducedMotion) assert.equal(await m.locator('#symbol').evaluate(el=>getComputedStyle(el).animationName),'none');
    await press('A'); await m.waitForFunction(()=>document.querySelector('#round').textContent==='1 / 12');
    await idle(m); await press('C'); await paused(m);
    assert(await m.locator('#selection').evaluate(el=>{const r=el.getBoundingClientRect(),k=document.querySelector('.keys').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&(getComputedStyle(document.querySelector('.keys')).position!=='fixed'||r.bottom<=k.top);}), 'pause selection visible without test scrolling');
    await readable(m);
    await m.screenshot({path:join(dir,`${label}.png`),fullPage:true});
    results.push(`${label}: three-key input, readable text, no horizontal overflow, reachable keys`);
  }
  assert.deepEqual(errors,[],'browser page errors');
  await writeFile(join(dir,'results.json'),JSON.stringify({results,errors,notes:'Synthetic loopback delays and automated input; no physical-phone, OS-background, audio, or fairness claim.'},null,2));
  console.log(JSON.stringify({dir,checks:results.length,results},null,2));
} finally {
  for(const c of contexts) await c.close().catch(()=>{});
  if(browser) await browser.close();
  for(const s of servers) s.kill('SIGTERM');
}
