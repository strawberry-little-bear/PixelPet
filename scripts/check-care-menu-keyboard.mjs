// Native care-menu keyboard reading, isolated HTTP service/save/random port.
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
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-menu-keyboard-')), dbPath = join(dir, 'test.db'), results = [];
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
const current = '.care-menu [aria-current="true"]';
async function focusedKey(page) {
  return page.evaluate(() => ['a', 'b', 'c'].find(k => document.activeElement?.classList.contains(`button-${k}`)) ?? null);
}
async function nativeStop(page, panel) {
  assert.equal(await focusedKey(page), 'a');
  for (let i = 0; i < 10 && !await panel.evaluate(el => document.activeElement === el); i++) await page.keyboard.press('Shift+Tab');
  assert(await panel.evaluate(el => document.activeElement === el), 'Native Tab must reach the read-only care-menu region');
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
  await page.locator('.care-menu-reading').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({top:r.top + scrollY,left:r.left,width:r.width,height:r.height}));
      for (const line of lines) {
        window.scrollTo({top:line.top - 12,behavior:'instant'});
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit))
          throw new Error('Menu line clipped/unreachable: ' + text.textContent);
      }
    }
  });
}
try {
  await start(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const stage of ['baby', 'growing', 'adult']) for (const sleeping of [false, true]) {
    for (const mode of [{width:1200,height:700,font:14}, {width:320,height:700,font:28}, {width:320,height:380,font:28}]) {
      const at = Date.now(), age = {baby:1,growing:25,adult:80}[stage] * 3600000;
      await api('import', { schema:1,revision:1,species:2,name:'慢慢读，再照顾',createdAt:at-age,hatchedAt:at-age,lastTick:at,
        sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,logs:[] });
      if (sleeping) await api('action', {kind:'sleep'}); // Actual session, not invented sleep progress.
      const before = (await api('state')).state; assert.equal(before.growth.stage, stage);
      const context = await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width<700,
        reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'});
      const page = await context.newPage(), errors = [], writes = [], movements = [];
      page.setDefaultTimeout(6000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && !['/api/state','/api/visit'].includes(new URL(r.url()).pathname)) writes.push(r.postDataJSON().kind); });
      await page.addInitScript(font => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = `${font}px`; }), mode.font);
      const label = `${stage}-${sleeping}-${mode.width}-${mode.height}`;
      try {
        await page.goto(base); await page.locator('.home-caption').waitFor();
        await key(page, 'A'); if (sleeping) for (let i=0;i<3;i++) await key(page, 'A');
        const panel = page.getByRole('region', {name:'照顾菜单阅读区'});
        const selection = await page.locator(current).innerText(); await nativeStop(page, panel);
        if (stage==='baby') await page.screenshot({path:join(dir,`focus-${label}.png`)});
        if (sleeping) assert.equal(await page.locator('.sleep-progress').count(), 1);
        assert.equal(await page.locator('.physical-button').count(), 3);
        assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
        const font = parseFloat(await page.locator('.care-preview p').first().evaluate(el => getComputedStyle(el).fontSize));
        assert(Math.abs(font - mode.font * 12 / 14) < .1, 'actual paragraph text doubles');
        for (const [k,direction] of [['ArrowDown',1],['Space',1],['Shift+Space',-1],['End',1],['PageUp',-1],['Home',-1],['PageDown',1]]) {
          await page.evaluate(direction => {
            const max = document.documentElement.scrollHeight - innerHeight;
            scrollTo({top:max*(direction>0?.2:.8),behavior:'instant'});
          }, direction);
          await wait(200); const top = await page.evaluate(() => scrollY);
          await page.keyboard.press(k);
          await page.waitForFunction(({top,direction}) => direction*(scrollY-top)>1, {top,direction}, {timeout:2500});
          await wait(200); movements.push({key:k,before:top,after:await page.evaluate(() => scrollY)});
          assert.equal(await page.locator(current).innerText(), selection);
          assert(await panel.evaluate(el => document.activeElement===el)); assert.deepEqual(writes, []);
        }
        for (const k of ['Space','ArrowDown','Enter']) {
          await page.keyboard.down(k); await page.keyboard.down(k); await page.keyboard.up(k);
          assert.equal(await page.locator(current).innerText(), selection); assert.deepEqual(writes, []);
        }
        await settledScroll(page);
        await readAll(page);
        const position = await settledScroll(page);
        if (stage==='baby') await page.screenshot({path:join(dir,`reading-${label}.png`)});
        const read = page.waitForResponse(r => ['/api/visit','/api/state'].includes(new URL(r.url()).pathname));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await read; await wait(150);
        assert(await panel.evaluate(el => document.activeElement===el)); assert.equal(await page.evaluate(() => scrollY), position);
        const after = (await api('state')).state;
        assert.equal(after.sleeping, sleeping); assert.equal(after.careCount, before.careCount);
        for (const k of ['nutrition','play','clean','lastFeed','lastPlay','lastClean']) assert.equal(after.growth.care[k], before.growth.care[k]);
        assert.deepEqual(writes, []);
        // Native Tab leaves reading and reaches original physical A then B.
        for (let i=0;i<8 && await focusedKey(page)!=='a';i++) await page.keyboard.press('Tab');
        assert.equal(await focusedKey(page), 'a');
        await page.keyboard.press('Tab'); assert.equal(await focusedKey(page), 'b');
        const kind = sleeping ? 'sleep' : 'feed', confirm = mode.height===380 ? 'Space' : 'Enter';
        const pending = page.waitForResponse(r => new URL(r.url()).pathname==='/api/action' && r.request().postDataJSON().kind===kind);
        await page.keyboard.press(confirm); const acknowledged = await (await pending).json();
        assert.equal(acknowledged.state.sleeping, false); assert.deepEqual(writes, [kind]);
        assert.deepEqual(errors, []);
        if (stage==='baby') await page.screenshot({path:join(dir,`${label}.png`),fullPage:true});
        results.push({stage,sleeping,...mode,movements,confirm,writes});
      } catch (e) {
        await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});
        await writeFile(join(dir,`failure-${label}.json`), JSON.stringify({errors,writes,text:await page.locator('body').innerText()},null,2)); throw e;
      } finally { await context.close(); }
    }
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify({groups:results.length,artifacts:dir}));
} catch (e) { console.error('Artifacts:',dir); throw e; }
finally { if(browser) await browser.close(); await stop(); await writeFile(join(dir,'server.log'),log); }
