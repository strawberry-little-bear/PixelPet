// Native care-outcome keyboard reading, isolated HTTP service/save/random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-outcome-keyboard-')), dbPath = join(dir, 'test.db'), results = [];
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
async function focusedKey(page) {
  return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null);
}
async function nativeStop(page, panel) {
  assert.equal(await focusedKey(page), 'c');
  for (let i = 0; i < 10 && !await panel.evaluate(el => document.activeElement === el); i++) await page.keyboard.press('Shift+Tab');
  assert(await panel.evaluate(el => document.activeElement === el), 'Native Tab must reach the read-only care-outcome region');
  assert.equal(await panel.getAttribute('tabindex'), '0');
  const id = await panel.getAttribute('aria-describedby');
  assert.match(await page.locator(`[id="${id}"]`).innerText(), /Enter 不操作/);
  assert.deepEqual(await panel.evaluate(el => { const css = getComputedStyle(el); return [css.outlineWidth, css.outlineStyle]; }), ['2px', 'solid']);
}
// Native repeated key scrolling may still animate after keyup. Wait for the
// browser to stop before measuring sync stability; do not disable scrolling.
async function settledScroll(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    let previous = scrollY, stable = 0;
    const deadline = performance.now() + 3000;
    function frame() {
      stable = scrollY === previous ? stable + 1 : 0;
      previous = scrollY;
      if (stable >= 12) return resolve(scrollY);
      if (performance.now() > deadline) return reject(new Error('Native scroll did not settle'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
}
async function readAll(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
  await page.locator('.care-outcome-reading').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({top:r.top + scrollY,left:r.left,width:r.width,height:r.height}));
      for (const line of lines) {
        window.scrollTo({top:line.top - 12,behavior:'instant'});
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit))
          throw new Error('Outcome line clipped/unreachable: ' + text.textContent);
      }
    }
  });
}
try {
  await start(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const care of ['feed', 'clean', 'bedtime', 'wake']) {
    for (const mode of [{width:1200,height:700,font:14}, {width:320,height:700,font:28}, {width:320,height:380,font:28}]) {
      const at = Date.now(), age = 30 * 3600000, kind = ['bedtime','wake'].includes(care) ? 'sleep' : care;
      await api('import', {schema:1,revision:1,species:2,name:'照顾后慢慢读',createdAt:at-age,hatchedAt:at-age,lastTick:at,
        sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,logs:[]});
      if (care === 'wake') { await api('action', {kind:'sleep'}); await wait(1200); }
      const context = await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width<700,
        reducedMotion:'reduce',forcedColors:mode.height===380?'active':'none'});
      const page = await context.newPage(), errors = [], writes = [], movements = [];
      page.setDefaultTimeout(6000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && !['/api/state','/api/visit'].includes(new URL(r.url()).pathname)) writes.push(r.postDataJSON().kind); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      const label = `${care}-${mode.width}-${mode.height}`;
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor();
        assert.equal(await page.getByRole('region',{name:'照顾结果阅读区'}).count(), 0);
        await key(page, 'A');
        for (let i=0;i<(care==='feed'?0:care==='clean'?2:3);i++) await key(page, 'A');
        const reply = page.waitForResponse(r => new URL(r.url()).pathname==='/api/action');
        await key(page, 'B'); const ack = await (await reply).json();
        assert(ack.careFeedback?.effect, 'Real acknowledged care effect required');
        assert.equal(ack.state.sleeping, care==='bedtime');
        // C skips only the current clip; it does not navigate away from home.
        await key(page, 'C'); await page.locator('.care-outcome').waitFor();
        const panel = page.getByRole('region', {name:'照顾结果阅读区'});
        // Fail precisely here against the old build, not on a later scroll timeout.
        assert.equal(await panel.count(), 1, 'Home receipt needs its named read-only Tab stop');
        const text = await panel.locator('.care-outcome').innerText();
        assert.match(text, new RegExp(`本页上次已确认 · ${{feed:'喂食',clean:'洗澡',bedtime:'入睡',wake:'起床'}[care]}`));
        if (care==='wake') { assert.equal(await page.locator('.sleep-summary').count(),1); assert(ack.careFeedback.sleepSummary); }
        await nativeStop(page, panel);
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(),0);
        const font = parseFloat(await panel.locator('.care-outcome').evaluate(el => getComputedStyle(el).fontSize));
        assert(Math.abs(font - mode.font * 12/14)<.1, 'actual receipt text doubles');
        const headingFont = parseFloat(await panel.locator('.care-outcome > h3').evaluate(el => getComputedStyle(el).fontSize));
        assert(Math.abs(headingFont - mode.font)<.1 && headingFont>font, 'Receipt heading stays above readable numeric details');
        for (const selector of ['.care-outcome dt', '.care-outcome > small', '.care-learning > small']) {
          const sizes = await panel.locator(selector).evaluateAll(els => els.map(el => {
            const css = getComputedStyle(el); return {font:parseFloat(css.fontSize),opacity:css.opacity};
          }));
          assert(sizes.length>0);
          for (const size of sizes) {
            assert(size.font>=font-.1, 'Secondary receipt text must retain the reading minimum');
            assert.equal(size.opacity,'1', 'Secondary text must not lose contrast through opacity');
          }
        }
        await page.screenshot({path:join(dir,`focus-${label}.png`)});
        for (const [k,direction] of [['ArrowDown',1],['Space',1],['Shift+Space',-1],['End',1],['PageUp',-1],['Home',-1],['PageDown',1]]) {
          await settledScroll(page);
          await page.evaluate(direction => {
            const max = document.documentElement.scrollHeight-innerHeight;
            scrollTo({top:max*(direction>0?.2:.8),behavior:'instant'});
          },direction);
          const top = await page.evaluate(() => scrollY); await page.keyboard.press(k);
          await page.waitForFunction(({top,direction}) => direction*(scrollY-top)>1,{top,direction},{timeout:2500});
          await settledScroll(page); movements.push({key:k,before:top,after:await page.evaluate(()=>scrollY)});
          assert(await panel.evaluate(el => document.activeElement===el));
          assert.equal(await page.locator('.home-caption').count(),1); assert.deepEqual(writes,[kind]);
        }
        for (const k of ['Space','ArrowDown','Enter']) {
          await page.keyboard.down(k); await page.keyboard.down(k); await page.keyboard.up(k);
          assert.equal(await page.locator('.home-caption').count(),1); assert.deepEqual(writes,[kind]);
        }
        await settledScroll(page); await readAll(page);
        await page.screenshot({path:join(dir,`read-${label}.png`)});
        // Wait for the real eight-second transient toast expiry, without faking clocks.
        await page.locator('[data-feedback="idle"]').waitFor({timeout:10000});
        assert.equal(await panel.locator('.care-outcome').innerText(),text);
        assert(await panel.evaluate(el => document.activeElement===el));
        await panel.evaluate(el => { el.dataset.syncProbe = 'same-node'; });
        const before = (await api('state')).state, position = await settledScroll(page);
        const read = page.waitForResponse(r => ['/api/visit','/api/state'].includes(new URL(r.url()).pathname));
        await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await read; await wait(200);
        assert.equal(await panel.getAttribute('data-sync-probe'),'same-node');
        assert(await panel.evaluate(el => document.activeElement===el)); assert.equal(await page.evaluate(()=>scrollY),position);
        assert.equal(await panel.locator('.care-outcome').innerText(),text);
        const after = (await api('state')).state;
        assert.equal(after.careCount,before.careCount); assert.deepEqual(after.economy,before.economy);
        assert.equal(after.sleeping,care==='bedtime');
        // Natural sleeping rest/growth may advance; reading must not add discrete care.
        for (const k of ['nutrition','play','clean','lastFeed','lastPlay','lastClean']) assert.equal(after.growth.care[k],before.growth.care[k]);
        assert.deepEqual(writes,[kind]);
        // Letter navigation stays explicit; native activation on physical B opens only the menu.
        await page.keyboard.press('a'); await page.locator('.care-menu').waitFor(); await page.keyboard.press('c');
        await panel.waitFor();
        for (let i=0;i<10 && await focusedKey(page)!=='b';i++) await page.keyboard.press('Tab');
        assert.equal(await focusedKey(page),'b');
        const confirm = mode.height===380?'Space':'Enter'; await page.keyboard.press(confirm); await page.locator('.care-menu').waitFor();
        assert.deepEqual(writes,[kind]); assert.deepEqual(errors,[]);
        if (care==='feed' || care==='clean') {
          await page.keyboard.press('c'); await page.keyboard.press('a');
          for (let i=0;i<5;i++) await page.keyboard.press('a');
          await page.keyboard.press('b');
          const diary = page.locator('.screen-journal'); await diary.waitFor();
          assert.equal(await diary.locator('p').textContent(),ack.state.logs[0].text, 'Diary preserves the complete saved sentence');
          const primary = parseFloat(await diary.locator('.journal-primary').evaluate(el => getComputedStyle(el).fontSize));
          const detail = parseFloat(await diary.locator('.journal-detail').evaluate(el => getComputedStyle(el).fontSize));
          assert(Math.abs(primary-mode.font)<.1 && primary>detail, 'Diary voice stays above numeric detail');
          assert(Math.abs(detail-font)<.1, 'Diary details scale with the reading minimum');
          assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1), 'Diary horizontal overflow');
          await page.screenshot({path:join(dir,`diary-${label}.png`),fullPage:true});
          assert.deepEqual(writes,[kind], 'Reading the diary must not write care');
          assert.deepEqual(errors,[]);
        }
        results.push({care,...mode,movements,confirm,writes,feedback:ack.careFeedback});
      } catch(e) {
        await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});
        await writeFile(join(dir,`failure-${label}.json`),JSON.stringify({errors,writes,text:await page.locator('body').innerText()},null,2)); throw e;
      } finally { await context.close(); }
    }
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify({groups:results.length,artifacts:dir}));
} catch(e) { console.error('Artifacts:',dir); throw e; }
finally { if(browser) await browser.close(); await stop(); await writeFile(join(dir,'server.log'),log); }
