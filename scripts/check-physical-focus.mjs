// Native Chrome focus regression. Held real replies; explicit 400/connection-loss and presence fixtures are controlled, not OS/SR certification.
import assert from 'node:assert/strict';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { binary, web } = await isolatedTestBuilds({ root });
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-physical-focus-'));
const artifacts = process.env.PIXELPET_TEST_ARTIFACTS || dir;
assert(isAbsolute(artifacts)); await mkdir(artifacts, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
});
const base = `http://127.0.0.1:${port}`, results = [], wait = ms => new Promise(r => setTimeout(r, ms));
let server, browser, startupError, log = '';
async function api(path, body) {
  const res = await fetch(base + '/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(res.ok, await res.clone().text()); return res.json();
}
async function seed() {
  const now = Date.now();
  return api('import', { schema: 1, revision: 1, species: 2, name: '连连看测试伙伴', createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
}
async function key(page, name) {
  await page.locator('.button-' + name + ':not(:disabled)').tap();
  await page.waitForFunction(() => !document.querySelector('.button-b')?.disabled);
}
try {
  server = spawn(binary, [], { cwd: root, env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir,'test.db'), PIXELPET_WEB: web }, stdio: ['ignore','pipe','pipe'] });
  server.once('error', e => { startupError = e; });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i=0;i<100;i++) {
    if (startupError) throw startupError; if (server.exitCode !== null) throw Error(log);
    try { await api('state'); ready = true; break; } catch { await wait(50); }
  }
  assert(ready, log); browser = await chromium.launch({ headless:true, channel:'chrome' });
  for (const mode of [{ width:1200, font:14 }, { width:320, font:28 }]) {
    for (const activation of ['Enter','Space']) for (const scenario of [
      'start','end','hatch','care-replacement','restore-b','restore-c','held','rejected','tab','pointer','other-focus','help','window-blur','hidden','unknown','care',
    ]) {
      const name = `${mode.width}-${mode.font}-${activation}-${scenario}`;
      console.log('RUN',name); await seed();
      if(scenario==='hatch') await api('reset',{confirm:true});
      const context = await browser.newContext({ viewport:{width:mode.width,height:700}, hasTouch:true,
        isMobile:mode.width===320, reducedMotion:'reduce', forcedColors:mode.width===320?'active':'none' });
      let release, held=false; const gate = new Promise(resolve => { release=resolve; });
      try {
        await context.addInitScript(font => document.addEventListener('DOMContentLoaded',() => {document.documentElement.style.fontSize=`${font}px`;}),mode.font);
        await context.addInitScript(() => {
          const calls = [];
          const focus = HTMLElement.prototype.focus;
          HTMLElement.prototype.focus = function(options) {
            if (this.classList?.contains('physical-button')) calls.push({ className: this.className, options: options ?? null });
            return focus.call(this, options);
          };
          Object.defineProperty(window, '__pixelpetFocusCalls', { value: calls });
        });
        const page = await context.newPage(), errors=[], writes=[];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request',r => { if(r.method()==='POST' && new URL(r.url()).pathname==='/api/action') writes.push(r.postDataJSON().kind); });
        await page.goto(base);
        if(scenario==='hatch') {await page.locator('.choose-name').waitFor();await key(page,'b');}
        else {
          await page.locator('.home-caption').waitFor();
          if(scenario==='care'||scenario==='care-replacement') await key(page,'a');
          else {
            for(const k of ['a','a','b','a','b',...(scenario==='start'?[]:['b'])]) await key(page,k);
            if(scenario!=='start') await page.locator('.tile-board').waitFor();
            if(scenario==='restore-c') await key(page,'b');
            if(scenario==='end') {await key(page,'c');await page.locator('.game-abandon').waitFor();}
          }
        }
        const startWrites = writes.length, before=(await api('state')).state;
        await page.route('**/api/action',async route => {
          if(scenario==='rejected') {
            held=true; await gate;
            await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'受控拒绝响应'})});
          } else {
            const response = await route.fetch(); held=true; await gate;
            if(scenario==='unknown') await route.abort('failed'); else await route.fulfill({response});
          }
        });
        const control=scenario==='restore-c'?'c':'b', target=page.locator('.button-'+control);
        await target.focus();
        if(scenario==='held') await page.keyboard.down(activation); else await page.keyboard.press(activation);
        await target.locator(':scope:disabled').waitFor();
        for(let i=0;i<100&&!held;i++) await wait(10);
        assert(held,'response must be held after request');
        await page.waitForFunction(() => document.activeElement===document.body, null, {timeout:2000});
        // Repeated activation while disabled must not create a second write.
        if(scenario==='held') await page.keyboard.down(activation); else await page.keyboard.press(activation);
        assert.equal(writes.length,startWrites+1);
        let expected='body', tabFocus;
        if(scenario==='tab') {
          await page.keyboard.press('Tab'); expected='other'; tabFocus=await page.evaluateHandle(()=>document.activeElement);
          assert(await tabFocus.evaluate(el=>el!==document.body),'native Tab must reach another control');
        }
        if(scenario==='pointer') await page.locator('.shell-bottom').click();
        if(scenario==='other-focus') await page.evaluate(() => {const other=document.querySelector('[aria-label="玩法说明"]');other.focus();other.blur();});
        if(scenario==='help') {await page.getByRole('button',{name:'玩法说明',exact:true}).click();await page.getByRole('dialog').waitFor();expected='dialog';}
        if(scenario==='window-blur') await page.evaluate(() => {window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
        if(scenario==='hidden') await page.evaluate(() => {
          Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
        });
        release();
        if(scenario==='care-replacement') {
          await page.locator('.care-outcome').waitFor();
          const state=(await api('state')).state;
          await api('import',{...state,name:'换来的伙伴',createdAt:state.createdAt-1});
          await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(()=>document.querySelector('.companion-title h2')?.textContent==='换来的伙伴');
        }
        await target.locator(':scope:not(:disabled)').waitFor();
        // Let a later render run as well; cancellation must not merely delay focus.
        await page.waitForTimeout(120);
        if(scenario.startsWith('restore-') || scenario==='held' || scenario==='rejected' || ['care','start','end','hatch'].includes(scenario)) {
          assert(await target.evaluate(el=>el===document.activeElement),'native button focus must recover');
          assert(await page.evaluate(() => window.__pixelpetFocusCalls.some(call =>
            call.className.includes('button-' + (document.activeElement?.className.match(/button-[abc]/)?.[0]?.slice(-1) ?? '')) &&
            call.options?.preventScroll === true)), 'physical focus recovery must use preventScroll');
        } else if(expected==='dialog') {
          assert(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)),'modal focus must stay inside');
          await page.getByRole('button',{name:'关闭',exact:true}).click();
          // External modal controls must return to the physical C key so the
          // LCD's C shortcut remains usable after the ordinary button loses focus.
          assert(await page.locator('.physical-button.button-c').evaluate(el=>el===document.activeElement));
        } else if(expected==='other') {
          assert(await tabFocus.evaluate(el=>el===document.activeElement),'Tab focus must not be stolen');
          await tabFocus.dispose();
        } else assert(await page.evaluate(() => document.activeElement===document.body),'cancelled focus must not replay');
        if(scenario==='held') {await page.keyboard.up(activation);await page.waitForTimeout(100);}
        assert.equal(writes.length,startWrites+1,'reply, restoration or held-key release must not repeat input');
        if(scenario==='unknown') {
          await page.locator('.save-recovery').waitFor();
          // Programmatic global B checks the result; it must not replay old focus or write.
          await page.keyboard.press('b'); await page.locator('.tile-board').waitFor();
          assert(await page.evaluate(()=>document.activeElement===document.body));
          assert.equal(writes.length,startWrites+1);
        }
        if(scenario==='restore-c') {
          await page.screenshot({path:join(artifacts,name+'-focused.png'),fullPage:false});
          await page.keyboard.press(activation); await page.locator('.game-abandon').waitFor();
          assert.equal(writes.length,startWrites+1,'second native C opens abandon, never maps to B');
        }
        const after=(await api('state')).state;
        assert.equal(after.careCount,before.careCount+(['care','care-replacement'].includes(scenario)?1:0));
        if(scenario==='rejected') assert.equal(after.game.tiles.pick,-1);
        else if(!['care','care-replacement','end','hatch'].includes(scenario)) assert.equal(after.game.tiles.pick,['restore-c','start'].includes(scenario)?-1:0);
        if(scenario==='end') assert(!after.game);
        if(scenario==='hatch') assert(after.hatchedAt>0);
        assert.equal(await page.locator('.physical-button').count(),3);
        assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(),0);
        assert.deepEqual(errors,[]);
        results.push({name,writes:writes.slice(startWrites),careCount:after.careCount,focus:await page.evaluate(()=>document.activeElement?.className)});
        await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
      } finally {release();await context.close();}
    }
  }
  console.log(`PASS ${results.length} native disable-focus cases; evidence ${artifacts}`);
} finally {
  if(browser) await browser.close();
  if(server && server.exitCode === null) {server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  await writeFile(join(artifacts,'server.log'),log);
}
