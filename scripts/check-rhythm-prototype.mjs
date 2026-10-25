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
async function open(url, options = {}, init) {
  const context = await browser.newContext(options); contexts.push(context);
  if (init) await context.addInitScript(init);
  const page = await context.newPage(), requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { requests.push({ url: req.url(), body: req.postDataJSON?.() }); });
  await page.goto(url); await page.waitForFunction(() => !document.querySelector('#pause').hidden && !document.querySelector('#status').textContent.includes('正在核对'), null, { polling: 50 });
  return { page, context, requests };
}
const key = (p, k) => p.keyboard.press(k);
const idle = p => p.waitForFunction(() => !document.querySelector('#status').textContent.includes('正在核对'), null, { polling: 50 });
const active = p => p.waitForFunction(() => document.body.classList.contains('active'), null, { polling: 50 });
const paused = p => p.waitForFunction(() => !document.querySelector('#pause').hidden && !document.body.classList.contains('active') && !document.querySelector('#status').textContent.includes('正在核对'), null, { polling: 50 });
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
  const leases = new Map();
  const post = async (url, input, origin = url) => {
    const response = await fetch(url + '/lab/command', { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'},
      body:typeof input === 'string' ? input : Array.isArray(input) ? JSON.stringify(input) : JSON.stringify({lease:leases.get(url + input.id),...input}) });
    if (response.ok) { const r = await response.clone().json(); leases.set(url + r.state.id, r.lease); }
    return response;
  };
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

  // Playwright sends browser keyboard input, including repeat:true while held.
  // Capture actual protocol writes: one held native key must not toggle C or
  // turn restart/selection/Space release into a second action after a reply.
  for (const native of ['Enter', 'Space']) {
    const { page: p, requests: writes, context: isolated } = await open(base);
    const kinds = () => writes.filter(r => r.body).map(r => r.body.kind);
    await p.locator('[data-key="A"]').focus();
    await p.keyboard.down(native);
    await p.waitForFunction(() => document.querySelector('#selection').textContent.includes('从头重开'));
    await p.keyboard.down(native); await p.keyboard.up(native);
    assert.match(await p.locator('#selection').textContent(), /从头重开/);
    await p.locator('[data-key="B"]').focus();
    await p.keyboard.down(native); await paused(p);
    await p.keyboard.down(native); await wait(100); await p.keyboard.up(native); await wait(100);
    assert.deepEqual(kinds(), ['create'], 'held B/release must not confirm its own restart prompt');
    assert.match(await p.locator('#selection').textContent(), /清空本局 0 次观测/);
    await p.keyboard.down(native); await paused(p);
    await p.keyboard.down(native); await p.keyboard.up(native); await wait(100);
    assert.deepEqual(kinds(), ['create', 'restart'], 'separate B confirms once; held repeats/release must not resume');
    await p.locator('[data-key="C"]').focus();
    await p.keyboard.down(native); await idle(p);
    assert.equal(await p.locator('#pause').isVisible(), false, 'native C acts on first down');
    for (let i = 0; i < 3; i++) { await p.keyboard.down(native); await wait(100); }
    await p.keyboard.up(native); await wait(100);
    assert.deepEqual(kinds(), ['create', 'restart', 'resume'], 'held C/release must not toggle pause');
    await p.keyboard.down(native); await paused(p);
    for (let i = 0; i < 3; i++) { await p.keyboard.down(native); await wait(100); }
    await p.keyboard.up(native); await wait(100);
    assert.deepEqual(kinds(), ['create', 'restart', 'resume', 'pause'], 'pause must stay paused until a distinct press');
    await p.keyboard.press(native); await idle(p); await active(p);
    await p.locator('[data-key="A"]').focus();
    await p.keyboard.down(native);
    await p.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12');
    await idle(p); await active(p); // A new live cue must not consume the still-held key.
    for (let i = 0; i < 3; i++) { await p.keyboard.down(native); await wait(80); }
    await p.keyboard.up(native); await wait(100);
    assert.equal(writes.filter(r => r.body?.kind === 'answer').length, 1);
    await key(p, 'C'); await paused(p);
    const before = kinds();
    await p.locator('h1').evaluate(el => { el.tabIndex = -1; el.focus(); });
    await p.keyboard.press(native); await wait(100);
    assert.deepEqual(kinds(), before, 'native Enter/Space outside keys must not play');
    await p.screenshot({ path: join(dir, `native-${native}-paused.png`), fullPage: true });
    await isolated.close();
    results.push(`Focused ${native}: A selection, B restart, C pause/resume and live A respond once per press; held repeats/release and unrelated focus never add writes`);
  }

  // Reproduce an input task that runs after a real stall but before the next RAF.
  // Synchronous DOM dispatch is intentional ordering control, not physical-device input.
  for (const via of ['keyboard', 'button']) for (const letter of ['A', 'B']) {
    const { page: stalled, requests: sent, context: isolated } = await open(base,
      via === 'button' ? { viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true } : {});
    await key(stalled, 'C'); await idle(stalled); await active(stalled);
    await stalled.evaluate(({ via, letter }) => {
      const until = performance.now() + 1101;
      while (performance.now() < until) {} // Real main-thread block; no clock mocking.
      if (via === 'button') document.querySelector(`[data-key="${letter}"]`).click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true }));
    }, { via, letter });
    await idle(stalled);
    await stalled.screenshot({ path: join(dir, `stale-${via}-${letter}.png`), fullPage: true });
    assert.equal(sent.filter(r => r.body?.kind === 'answer').length, 0, 'stale input must pause before sending an answer');
    await paused(stalled); assert.equal(await stalled.locator('#round').textContent(), '0 / 12');
    assert.match(await stalled.locator('#status').textContent(), /页面停顿/);
    const count = sent.length; await wait(250); assert.equal(sent.length, count, 'no stale input replay');
    await key(stalled, 'C'); await idle(stalled); await active(stalled);
    await key(stalled, 'A'); await stalled.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12');
    await idle(stalled); await key(stalled, 'C'); await paused(stalled);
    assert.equal(sent.filter(r => r.body?.kind === 'answer').length, 1, 'only the fresh manual answer is recorded');
    await isolated.close();
    results.push(`Stale ${via} ${letter}: real 1101ms stall, input before RAF pauses without observation; explicit resume and fresh answer work`);
  }

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
  const completeObservations = await page.locator('#observations').textContent();
  const savedId = await page.evaluate(()=>sessionStorage.getItem('pixelpet.rhythm.session.v1'));
  await page.reload(); await idle(page);
  await page.waitForFunction(()=>document.querySelector('#round').textContent==='12 / 12');
  assert.equal(await page.locator('#observations').textContent(),completeObservations);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pixelpet.rhythm.session.v1')),savedId);
  assert.match(await page.locator('#direction').textContent(),/本次观测完成/);
  results.push('Completed refresh keeps all 12 observations, with no implicit restart or rewards');
  const completedWrites = requests.filter(r => r.body).length;
  await key(page,'B'); await paused(page); assert.match(await page.locator('#selection').textContent(), /清空本局 12 次观测/);
  assert.equal(await page.locator('#observations').textContent(), completeObservations);
  await readable(page); await page.screenshot({path:join(dir,'desktop-complete-restart-confirm.png'),fullPage:true});
  await key(page,'C'); assert.equal(await page.locator('#pause').isVisible(), false);
  assert.equal(requests.filter(r => r.body).length, completedWrites);
  assert.equal(await page.locator('#round').textContent(), '12 / 12');
  await key(page,'B'); await key(page,'B'); await paused(page); assert.equal(await page.locator('#round').textContent(),'0 / 12');
  await key(page,'A'); assert.match(await page.locator('#selection').textContent(), /从头重开/);
  await key(page,'B'); await key(page,'B'); await paused(page); assert.match(await page.locator('#selection').textContent(), /继续练习/);
  results.push('Completed twelve observations survive opening/cancelling restart; only a separate B clears once to paused');
  await key(page,'C'); await idle(page); await page.reload(); await paused(page);
  assert.equal(await page.locator('#round').textContent(),'0 / 12');
  assert.deepEqual(await page.evaluate(() => [localStorage.length,sessionStorage.length]),[0,1]);
  assert.equal(requests.filter(r=>r.body?.kind==='create').length,1);
  assert.equal(requests.at(-1).body.kind,'recover');
  assert.equal((await context.cookies()).length,0);
  assert(requests.every(r => new URL(r.url).origin === base && !r.url.includes('/api/')));
  results.push('Desktop: preview/held key/12 real-time cues/restart/refresh/three keys/lab pointer only/no production API');

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
  await key(p,'C'); await paused(p); assert.match(await p.locator('#status').textContent(), /核对本局观测并暂停/);
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

  // Drop an acknowledgement only AFTER the real lab has accepted one answer.
  const {page:lost,requests:lostRequests}=await open(base);
  await key(lost,'C'); await idle(lost); await active(lost);
  await lost.route('**/lab/command',async route=>{
    if(route.request().postDataJSON().kind==='answer') { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await key(lost,'A'); await paused(lost);
  await lost.waitForFunction(()=>document.querySelector('#round').textContent==='1 / 12');
  assert.equal(lostRequests.filter(r=>r.body?.kind==='answer').length,1);
  await lost.unroute('**/lab/command'); await lost.reload(); await paused(lost);
  assert.equal(await lost.locator('#round').textContent(),'1 / 12');
  assert.equal(lostRequests.filter(r=>r.body?.kind==='answer').length,1);
  const stable=lostRequests.length; await wait(2100); assert.equal(lostRequests.length,stable);
  await lost.screenshot({path:join(dir,'recovery-lost-answer.png'),fullPage:true});
  results.push('Real accepted answer with dropped acknowledgement: one observation survives refresh, no answer retry or auto-resume');

  // Transient recovery failure preserves the pointer and waits for a human key.
  await lost.route('**/lab/command',async route=>{ await route.abort('failed'); });
  await lost.reload(); await lost.waitForFunction(()=>document.querySelector('#status').textContent.includes('连接未确认'));
  const failedRecovery=lostRequests.length; await wait(1200); assert.equal(lostRequests.length,failedRecovery);
  assert.equal(lostRequests.filter(r=>r.body?.kind==='create').length,1);
  await lost.unroute('**/lab/command'); await key(lost,'C'); await paused(lost);
  assert.equal(await lost.locator('#round').textContent(),'1 / 12');
  assert.equal(lostRequests.at(-1).body.kind,'recover');
  results.push('Failed refresh recovery waits without creation/retry; explicit C recovers to paused, not playing');

  // A confirmed restart can be saved even if its acknowledgement is lost.
  const {page:reset,requests:resetWrites} = await open(base);
  await key(reset,'C'); await idle(reset); await active(reset);
  await key(reset,(await reset.locator('#direction').textContent()).includes('A')?'A':'B');
  await reset.waitForFunction(()=>document.querySelector('#round').textContent==='1 / 12');
  await idle(reset); await key(reset,'C'); await paused(reset);
  await key(reset,'A'); await key(reset,'B');
  await reset.evaluate(()=>window.dispatchEvent(new Event('blur'))); await paused(reset);
  assert.equal(await reset.locator('#round').textContent(),'1 / 12');
  assert.match(await reset.locator('#selection').textContent(),/继续练习/);
  await key(reset,'A'); await key(reset,'B');
  let acceptedReset;
  await reset.route('**/lab/command',async route=>{
    const kind=route.request().postDataJSON().kind;
    if(kind==='restart') { const response=await route.fetch({maxRetries:0}); acceptedReset=await response.json(); return route.abort('failed'); }
    if(kind==='pause') return route.abort('failed');
    await route.continue();
  });
  await key(reset,'B'); await reset.waitForFunction(()=>document.querySelector('#status').textContent.includes('暂停未确认'));
  assert.equal(acceptedReset.state.observations.length,0); assert.equal(acceptedReset.state.status,'paused');
  const failedResetWrites=resetWrites.filter(r=>r.body).length; await wait(800);
  assert.equal(resetWrites.filter(r=>r.body).length,failedResetWrites);
  await reset.unroute('**/lab/command'); await key(reset,'B'); await paused(reset);
  assert.equal(resetWrites.at(-1).body.kind,'recover'); assert.equal(await reset.locator('#round').textContent(),'0 / 12');
  assert.equal(resetWrites.filter(r=>r.body?.kind==='restart').length,1);
  results.push('Interrupted consent is cancelled; confirmed saved restart with lost reply/failed neutral pause requires manual recovery, never restart replay');

  // A server restart/eviction is represented by a well-formed unknown pointer.
  await lost.evaluate(()=>sessionStorage.setItem('pixelpet.rhythm.session.v1','00000000-0000-4000-8000-000000000000'));
  await lost.reload(); await lost.waitForFunction(()=>document.querySelector('#status').textContent.includes('旧观测无法恢复'));
  assert.equal(await lost.evaluate(()=>sessionStorage.getItem('pixelpet.rhythm.session.v1')),null);
  const expired=lostRequests.length; await wait(800); assert.equal(lostRequests.length,expired);
  await key(lost,'B'); await paused(lost); assert.equal(await lost.locator('#round').textContent(),'0 / 12');
  assert.equal(lostRequests.at(-1).body.kind,'create');
  results.push('Unknown/expired lab pointer explains loss, clears only the pointer, and requires explicit B for a new paused practice');

  // Deliberately control RAF delivery while keeping the real DOM, HTTP service
  // and performance clock. This measures cue consistency under this scheduler,
  // not physical-device frame rates, reader speech latency or player fairness.
  const cueBase = await start();
  for (const compact of [false, true]) {
    const { page: cuePage, requests: cueWrites, context: cueContext } = await open(cueBase,
      compact ? { viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true,
        reducedMotion: 'reduce', forcedColors: 'active' } : {}, () => {
        window.labFrames = []; window.labPaints = 0;
        window.requestAnimationFrame = callback => { window.labFrames.push(callback); return window.labFrames.length; };
        window.labPaint = () => { window.labPaints++; for (const callback of window.labFrames.splice(0)) callback(performance.now()); };
        window.labCueChanges = 0;
        document.addEventListener('DOMContentLoaded', () => new MutationObserver(records => { window.labCueChanges += records.length; })
          .observe(document.getElementById('phase'), { subtree: true, childList: true, characterData: true }));
      });
    if (compact) await cuePage.evaluate(() => document.documentElement.style.fontSize = '32px');
    const cuePress = k => compact ? cuePage.locator(`[data-key="${k}"]`).tap() : key(cuePage, k);
    const paint = () => cuePage.evaluate(() => window.labPaint());
    await paint(); const paints = await cuePage.evaluate(() => window.labPaints);
    await cuePress('C'); await idle(cuePage);
    assert.match(await cuePage.locator('#phase').textContent(), /准备.*左侧圆形.*A/);
    assert.equal(await cuePage.evaluate(() => window.labPaints), paints, 'reply presents preparation without another RAF');
    assert.equal(await cuePage.locator('#phase').getAttribute('role'), 'status');
    assert.equal(await cuePage.locator('#phase').getAttribute('aria-atomic'), 'true');
    const changes = await cuePage.evaluate(() => window.labCueChanges);
    for (let i = 0; i < 3; i++) { await wait(200); await paint(); }
    await cuePress('A'); // Early preview input changes the explanatory receipt only.
    assert.equal(await cuePage.evaluate(() => window.labCueChanges), changes, 'preview frames do not rewrite the live phase');
    const respond = async expected => {
      for (let i = 0; i < 15 && !await cuePage.locator('body').evaluate(el => el.classList.contains('active')); i++) {
        await wait(200); await paint();
      }
      await active(cuePage);
      assert.match(await cuePage.locator('#phase').textContent(), new RegExp(`现在回应.*${expected}`));
    };
    for (const [expected, next] of [['A', 'B'], ['B', 'B'], ['B', 'A']]) {
      await respond(expected);
      const paintsBeforeReply = await cuePage.evaluate(() => window.labPaints);
      await cuePress(expected); await idle(cuePage);
      assert.match(await cuePage.locator('#phase').textContent(), new RegExp(`准备.*${next}`));
      assert.equal(await cuePage.evaluate(() => window.labPaints), paintsBeforeReply);
      assert.equal(await cuePage.locator('body').evaluate(el => el.classList.contains('active')), false);
      assert.equal(await cuePage.locator('#symbol').textContent(), next === 'A' ? '●' : '▲');
    }
    assert.equal(await cuePage.locator('#round').textContent(), '3 / 12');
    await respond('A');
    if (compact) assert.equal(await cuePage.locator('#symbol').evaluate(el => getComputedStyle(el).animationName), 'none');
    if (compact) {
      const visible = await cuePage.evaluate(() => {
        const cue = document.querySelector('.cue').getBoundingClientRect(), keys = document.querySelector('.keys').getBoundingClientRect();
        return cue.top >= 0 && cue.bottom <= keys.top;
      });
      assert(visible, 'shape, direction and response text stay above the fixed key dock');
    }
    await readable(cuePage);
    await cuePage.screenshot({ path: join(dir, compact ? 'cue-320-double-reduced-forced.png' : 'cue-desktop.png'), fullPage: true });
    // Layout inspection may consume the response window; explicitly pause and
    // create a fresh cue before observing the pending-response boundary.
    await cuePress('C'); await paused(cuePage); await cuePress('C'); await idle(cuePage); await respond('A');
    const captured = Promise.withResolvers(), release = Promise.withResolvers(), delivered = Promise.withResolvers();
    await cuePage.route('**/lab/command', async route => {
      if (route.request().postDataJSON().kind !== 'answer') { await route.continue(); return; }
      const response = await route.fetch(); captured.resolve();
      await release.promise; await route.fulfill({ response }); delivered.resolve();
    });
    // Reset lastFrame after screenshot work; all clocks and windows stay real.
    await paint(); await cuePress('A');
    let captureTimer;
    try { await Promise.race([captured.promise, new Promise((_, reject) => { captureTimer = setTimeout(() => reject(new Error('expected answer was not received')), 10000); })]); }
    finally { clearTimeout(captureTimer); }
    assert.equal(await cuePage.locator('#direction').textContent(), '正在核对');
    assert.doesNotMatch(await cuePage.locator('#phase').textContent(), /现在回应/);
    const answerCount = cueWrites.filter(r => r.body?.kind === 'answer').length;
    await cuePress('B'); assert.equal(cueWrites.filter(r => r.body?.kind === 'answer').length, answerCount);
    await cuePress('C'); await paused(cuePage);
    release.resolve(); await delivered.promise; await wait(100); await paused(cuePage);
    assert.doesNotMatch(await cuePage.locator('#phase').textContent(), /现在回应|准备/);
    await cueContext.close();
    results.push(`${compact ? '320px double text, reduced motion, forced colors, touch' : 'Desktop keyboard'}: controlled 200ms RAF cadence, immediate matching direction/phase through repeated B, discrete live-region writes, held reply and C pause without audio`);
  }

  // Controlled lifecycle ordering exercises the cached-document path even when
  // this Chrome configuration chooses a full history reload. These dispatched
  // events are not evidence of OS backgrounding or actual BFCache eligibility.
  const navigationBase = await start();
  const navigationEvent = (page, type) => page.evaluate(type =>
    window.dispatchEvent(new PageTransitionEvent(type, { persisted: true })), type);
  const { page: restored, requests: restoredWrites, context: restoredContext } = await open(navigationBase,
    { viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true });
  await restored.evaluate(() => document.documentElement.style.fontSize = '32px');
  await key(restored, 'C'); await idle(restored); await active(restored); await key(restored, 'A');
  await restored.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12'); await idle(restored);
  const beforeHide = restoredWrites.length;
  await navigationEvent(restored, 'pagehide'); await key(restored, 'C'); await wait(200);
  assert.equal(restoredWrites.length, beforeHide, 'departed document cannot send new operations');
  await navigationEvent(restored, 'pageshow'); await paused(restored);
  await readable(restored);
  await restored.screenshot({ path: join(dir, 'history-restore-320-double-text.png'), fullPage: true });
  assert.match(await restored.locator('#phase').textContent(), /先核对本局/);
  await restored.locator('[data-key="C"]').tap(); await paused(restored);
  assert.equal(restoredWrites.at(-1).body.kind, 'recover');
  assert.equal(await restored.locator('#round').textContent(), '1 / 12');
  await restored.locator('[data-key="C"]').tap(); await idle(restored);
  assert.equal(restoredWrites.at(-1).body.kind, 'resume');
  await restoredContext.close();
  results.push('Dispatched pagehide/pageshow: old cue stops, 320px double-text recovery is readable, touch C reconciles then separately resumes');

  for (const kind of ['resume', 'answer', 'restart']) {
    const { page: cached, requests: cachedWrites, context: cachedContext } = await open(navigationBase);
    if (kind !== 'resume') {
      await key(cached, 'C'); await idle(cached); await active(cached); await key(cached, 'A');
      await cached.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12'); await idle(cached);
    }
    if (kind === 'restart') { await key(cached, 'C'); await paused(cached); await key(cached, 'A'); await key(cached, 'B'); }
    if (kind === 'answer') await active(cached);
    const captured = Promise.withResolvers(), release = Promise.withResolvers(), delivered = Promise.withResolvers();
    let held = false;
    await cached.route('**/lab/command', async route => {
      if (route.request().postDataJSON().kind !== kind || held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch(); captured.resolve(await response.json());
      await release.promise; await route.fulfill({ response }); delivered.resolve();
    });
    await key(cached, kind === 'restart' ? 'B' : kind === 'answer' ? 'A' : 'C');
    const applied = await captured.promise;
    await navigationEvent(cached, 'pagehide'); await navigationEvent(cached, 'pageshow');
    await key(cached, 'B'); await paused(cached);
    assert.equal(cachedWrites.at(-1).body.kind, 'recover');
    assert.equal(await cached.locator('#round').textContent(), `${applied.state.observations.length} / 12`);
    const writes = cachedWrites.length;
    release.resolve(); await delivered.promise; await wait(150); await paused(cached);
    assert.match(await cached.locator('#status').textContent(), /核对本局观测并暂停/);
    assert.equal(cachedWrites.length, writes, 'late response must not resurrect play or send a follow-up');
    await key(cached, 'C'); await idle(cached);
    assert.equal(cachedWrites.at(-1).body.kind, 'resume');
    await cachedContext.close();
    results.push(`Dispatched history restore with real accepted ${kind} and held reply: manual recovery preserves authoritative observations; late reply is ignored, never replayed`);
  }

  // A genuine navigate/back covers the browser's chosen history path. Record
  // whether it reused a document; do not label a full reload as a BFCache pass.
  const { page: history, requests: historyWrites, context: historyContext } = await open(navigationBase);
  await history.evaluate(() => { window.labRestored = false; window.addEventListener('pageshow', e => { window.labRestored = e.persisted; }); });
  await key(history, 'C'); await idle(history); await active(history); await key(history, 'A');
  await history.waitForFunction(() => document.querySelector('#round').textContent === '1 / 12'); await idle(history);
  await history.goto(navigationBase + '/styles.css');
  const backWrites = historyWrites.length;
  await history.goBack(); await paused(history);
  const reusedDocument = await history.evaluate(() => window.labRestored === true);
  assert.equal(await history.locator('#round').textContent(), '1 / 12');
  assert.equal(historyWrites.slice(backWrites).filter(r => ['resume', 'answer', 'restart'].includes(r.body?.kind)).length, 0);
  if (reusedDocument) { await key(history, 'C'); await paused(history); assert.equal(historyWrites.at(-1).body.kind, 'recover'); }
  await key(history, 'C'); await idle(history); assert.equal(historyWrites.at(-1).body.kind, 'resume');
  await historyContext.close();
  results.push(`Real navigation/back (${reusedDocument ? 'cached document' : 'full history reload'}): one observation retained, no automatic play, explicit C resumes`);

  // A delayed recovery must stay paused even if blurred before it replies.
  const {page:init} = await open(base);
  await init.route('**/lab/command',async route=>{ await wait(300); await route.continue(); });
  await init.reload({waitUntil:'domcontentloaded'});
  await init.evaluate(() => window.dispatchEvent(new Event('blur'))); await paused(init);
  assert.equal(await init.locator('#round').textContent(),'0 / 12');
  results.push('Delayed recovery during blur remains a usable paused session');
  await init.evaluate(()=>sessionStorage.removeItem('pixelpet.rhythm.session.v1'));
  await init.reload({waitUntil:'domcontentloaded'});
  await init.evaluate(()=>window.dispatchEvent(new Event('blur'))); await paused(init);
  assert.equal(await init.locator('#round').textContent(),'0 / 12');
  results.push('Delayed initial create during blur also remains paused, never auto-starts');

  for(const options of [
    {label:'mobile-touch',viewport:{width:390,height:844},hasTouch:true,isMobile:true},
    {label:'320-double-text',viewport:{width:320,height:740},hasTouch:true,isMobile:true,double:true},
    {label:'reduced-motion',viewport:{width:1000,height:850},reducedMotion:'reduce'},
    {label:'forced-colors',viewport:{width:1000,height:850},forcedColors:'active'},
  ]) {
    const {label,double,...opts}=options, {page:m,requests:mobileRequests}=await open(base,opts);
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
    const beforeConfirm = mobileRequests.filter(r => r.body).length;
    await press('A'); await press('B'); await paused(m);
    assert.match(await m.locator('#selection').textContent(), /清空本局 1 次观测/);
    await readable(m); await m.locator('#pause').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      if (rects.some(r => r.width && (r.left < -1 || r.right > innerWidth + 1))) throw new Error('confirmation text clipped');
    });
    await m.screenshot({path:join(dir,`${label}-restart-confirm.png`),fullPage:true});
    await press('A'); assert.equal(await m.locator('#round').textContent(), '1 / 12');
    assert.equal(mobileRequests.filter(r => r.body).length, beforeConfirm, 'opening and cancelling confirmation must be read-only');
    await press('A'); await press('B'); // Refresh while confirmation is open.
    const mobileId=await m.evaluate(()=>sessionStorage.getItem('pixelpet.rhythm.session.v1'));
    if(double) await m.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.fontSize='32px'));
    await m.reload(); await paused(m);
    assert.equal(await m.locator('#round').textContent(),'1 / 12');
    assert.equal(await m.evaluate(()=>sessionStorage.getItem('pixelpet.rhythm.session.v1')),mobileId);
    assert.equal(mobileRequests.filter(r=>r.body?.kind==='create').length,1);
    assert.equal(mobileRequests.at(-1).body.kind,'recover');
    await readable(m); await m.screenshot({path:join(dir,`${label}-recovered.png`),fullPage:true});
    results.push(`${label}: three-key input, same-session paused refresh, readable text, no horizontal overflow, reachable keys`);
  }
  assert.deepEqual(errors,[],'browser page errors');
  await writeFile(join(dir,'results.json'),JSON.stringify({results,errors,notes:'Synthetic loopback delays and automated input; no physical-phone, OS-background, audio, or fairness claim.'},null,2));
  console.log(JSON.stringify({dir,checks:results.length,results},null,2));
} finally {
  for(const c of contexts) await c.close().catch(()=>{});
  if(browser) await browser.close();
  for(const s of servers) s.kill('SIGTERM');
}
