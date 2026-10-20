// Native keyboard reading for journal, memories and collections; isolated service/save/random port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-memory-keyboard-')), dbPath = join(dir, 'test.db'), results = [];
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
  for (let i = 0; i < 10 && !await panel.evaluate(el => document.activeElement === el); i++) await page.keyboard.press('Shift+Tab');
  assert(await panel.evaluate(el => document.activeElement === el), 'Native Tab must reach the read-only memory region');
  assert.equal(await panel.getAttribute('tabindex'), '0');
  const id = await panel.getAttribute('aria-describedby');
  assert.match(await page.locator(`[id="${id}"]`).innerText(), /↑\/↓ 或空格滚动/);
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
  await page.locator('.memory-reading-region').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = Array.from(range.getClientRects(), r => ({top:r.top + scrollY,left:r.left,width:r.width,height:r.height}));
      for (const line of lines) {
        window.scrollTo({top:line.top - 12,behavior:'instant'});
        const top = line.top - scrollY, hit = document.elementFromPoint(line.left + line.width / 2, top + line.height / 2);
        if (line.left < -1 || line.left + line.width > innerWidth + 1 || top < 0 || top + line.height > innerHeight || !hit || !text.parentElement.contains(hit))
          throw new Error('Memory line clipped/unreachable: ' + text.textContent);
      }
    }
  });
}
const readers = [
  { kind:'journal', label:'成长日记阅读区', menu:5, selector:'.screen-journal' },
  { kind:'album', label:'永久纪念册阅读区', menu:8, selector:'.album-directory' },
  { kind:'fish', label:'池塘鱼图鉴阅读区', menu:10, selector:'.fish-album' },
  { kind:'park', label:'公园沿途发现阅读区', menu:11, selector:'.park-album' },
];
const modes = [{width:1200,height:700,font:14}, {width:320,height:380,font:28}];
async function seed(stage, sleeping, empty, paused, reader) {
  const at = Date.now(), age = {baby:1,growing:25,adult:80}[stage]*3600000;
  const fixture = (await api('import', {schema:1,revision:1,species:2,name:'回忆伙伴',createdAt:at-age,hatchedAt:at-age,
    lastTick:at,sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,logs:[]})).state;
  fixture.logs = empty ? [] : [
    {at:at-1000,text:'一起散步：'+'看见树叶和水纹，慢慢照顾，留下共同经历。'.repeat(8)},
    {at:at-2000,text:'早些的回忆：一起吃饭。'},
  ];
  if (!empty) for (const kind of ['meal','bath','goodnight']) fixture.album.entries.push({kind,at:fixture.lastTick,source:'shared'});
  const discoveries = ids => ids.map(id => ({id,count:2,firstAt:fixture.lastTick,lastAt:fixture.lastTick}));
  fixture.pond.fish = discoveries(empty ? [] : ['reed-minnow','rain-koi']);
  fixture.park.finds = discoveries(empty ? [] : ['leaf','flower']);
  await api('import',fixture);
  if (sleeping) await api('action',{kind:'sleep'});
  if (paused) {
    const game = (await api('action',{kind:reader.kind==='fish'?'play-fishing':'play-walk'})).state.game;
    if (reader.kind==='fish') await api('action',{kind:'fish-pause',gameId:game.id,step:game.fishing.step});
  }
  const before = (await api('state')).state;
  assert.equal(before.growth.stage,stage); assert.equal(before.sleeping,sleeping);
  if (empty) {
    assert.equal(before.logs.length,0);
    assert.equal(before.pond.fish?.length ?? 0,0); assert.equal(before.park.finds?.length ?? 0,0);
  }
  return before;
}
async function selection(page, kind) {
  if (kind==='fish') return page.locator('.fish-album-grid > div').evaluateAll(items => items.findIndex(el => el.getAttribute('aria-current')==='true'));
  if (kind==='park') return page.locator('.park-album > header').innerText();
  if (kind==='journal') return page.locator('.screen-journal > span').innerText();
  if (await page.locator('.album-directory').count()) return page.locator('.album-directory [aria-current="true"]').innerText();
  return page.locator('.album-panel').evaluate(el => [el.dataset.albumPage,el.dataset.albumKind]);
}
try {
  await start(); browser = await chromium.launch({channel:'chrome',headless:true});
  const cases = [];
  for (const reader of readers) for (const stage of ['baby','growing','adult']) for (const sleeping of [false,true])
    for (const mode of modes) cases.push({reader,stage,sleeping,mode,empty:false,paused:false});
  for (const reader of readers) cases.push({reader,stage:'baby',sleeping:false,mode:modes[1],empty:true,paused:false});
  for (const reader of readers.filter(r => ['fish','park'].includes(r.kind))) for (const mode of modes)
    cases.push({reader,stage:'baby',sleeping:false,mode,empty:false,paused:true});
  for (const {reader,stage,sleeping,mode,empty,paused} of cases.filter(c => !process.argv.includes("--edge-cases") || c.empty || c.paused)) {
    const before = await seed(stage,sleeping,empty,paused,reader);
    const context = await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,isMobile:mode.width<700,
      reducedMotion:'reduce',forcedColors:mode.font===28?'active':'none'});
    const page = await context.newPage(), errors = [], writes = [], movements = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror',e => errors.push(e.message));
    page.on('request',r => { if (r.method()!=='GET' && !['/api/state','/api/visit'].includes(new URL(r.url()).pathname)) writes.push(r.url()); });
    await page.addInitScript(font => document.addEventListener('DOMContentLoaded',() => { document.documentElement.style.fontSize=`${font}px`; }),mode.font);
    // A hatched current save legitimately requires its hatch memory. Model an
    // old reply with omitted optional collections, never an invalid import.
    if (empty) await page.route(/\/api\/(?:state|visit)(?:\?.*)?$/, async route => {
      const response = await route.fetch(), reply = await response.json();
      delete reply.state.album; delete reply.state.pond; delete reply.state.park;
      await route.fulfill({response,json:reply});
    });
    const label = `${reader.kind}-${stage}-${sleeping}-${mode.width}-${empty}-${paused}`;
    try {
      console.log('RUN',label);
      await page.goto(base); await page.locator(paused?(reader.kind==='fish'?'.fishing-pause':'.walk-pause'):'.home-caption').waitFor();
      const preference = await page.evaluate(() => JSON.stringify(localStorage));
      await key(page,'A'); if (!paused) for (let i=0;i<reader.menu;i++) await key(page,'A'); await key(page,'B');
      await page.locator(reader.selector).waitFor();
      if (reader.kind==='journal') {
        const box = await page.locator('.screen-journal [data-care-reading-start]').boundingBox();
        assert(box && box.y>=-1 && box.y+box.height<=mode.height+1,'Journal date/empty message must be visible after entry');
      }
      const panel = page.getByRole('region',{name:reader.label});
      assert.equal(await panel.count(),1,'Memory page needs a named read-only Tab stop');
      await nativeStop(page,panel);
      if (empty && reader.kind!=='album') assert.match(await page.locator(reader.selector).innerText(),
        reader.kind==='journal'?/0 条记录/:reader.kind==='fish'?/已发现 0 \/ 7/:/0 \/ 6 种/);
      await panel.evaluate(el => { el.dataset.syncProbe='same-node'; });
      assert.equal(await page.locator('.physical-button').count(),3);
      assert.equal(await page.locator('.lcd button,.lcd input,.lcd a,.lcd [role=button]').count(),0);
      assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),mode.font);
      const selected = await selection(page,reader.kind);
      if (stage==='baby' && !sleeping) await page.screenshot({path:join(dir,`focus-${label}.png`)});
      for (const [k,direction] of [['ArrowDown',1],['Space',1],['Shift+Space',-1],['End',1],['PageUp',-1],['Home',-1],['PageDown',1]]) {
        await settledScroll(page);
        await page.evaluate(direction => {
          const max=document.documentElement.scrollHeight-innerHeight;
          scrollTo({top:max*(direction>0?.2:.8),behavior:'instant'});
        },direction);
        const top = await page.evaluate(() => scrollY); await page.keyboard.press(k);
        await page.waitForFunction(({top,direction}) => direction*(scrollY-top)>1,{top,direction},{timeout:2500});
        await settledScroll(page); movements.push({key:k,before:top,after:await page.evaluate(() => scrollY)});
        assert.deepEqual(await selection(page,reader.kind),selected); assert(await panel.evaluate(el => document.activeElement===el));
        assert.deepEqual(writes,[]);
      }
      for (const k of ['Space','ArrowDown','Enter']) {
        await page.keyboard.down(k); await page.keyboard.down(k); await page.keyboard.up(k);
        assert.deepEqual(await selection(page,reader.kind),selected); assert.deepEqual(writes,[]);
      }
      await settledScroll(page); await readAll(page);
      if (stage==='baby' && !sleeping) await page.screenshot({path:join(dir,`read-${label}.png`)});
      const position = await settledScroll(page), content = await panel.innerText();
      const sync = page.waitForResponse(r => ['/api/state','/api/visit'].includes(new URL(r.url()).pathname));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sync; await wait(150);
      assert.equal(await page.evaluate(() => scrollY),position,'Ordinary sync moved reading position');
      assert(await panel.evaluate(el => document.activeElement===el)); assert.equal(await panel.getAttribute('data-sync-probe'),'same-node');
      assert.equal(await panel.innerText(),content);
      // ABC still navigate explicitly, with a single outer node across album directory/cards.
      if (reader.kind==='album') {
        await page.keyboard.press('b'); await page.locator('.album-panel').waitFor();
        if (empty) assert.match(await page.locator('.album-panel').innerText(),/纪念册尚未开启/);
        assert(await panel.evaluate(el => document.activeElement===el)); await readAll(page);
        await page.keyboard.press('a'); await page.keyboard.press('b');
        assert(await panel.evaluate(el => document.activeElement===el)); await readAll(page);
        await page.keyboard.press('c'); await page.locator('.album-directory').waitFor();
        assert(await panel.evaluate(el => document.activeElement===el)); await readAll(page);
      } else {
        await page.keyboard.press('a');
        if (!empty) assert.notDeepEqual(await selection(page,reader.kind),selected);
        assert(await panel.evaluate(el => document.activeElement===el));
        if (reader.kind==='journal') {
          const box = await page.locator('.screen-journal [data-care-reading-start]').boundingBox();
          assert(box && box.y>=-1 && box.y+box.height<=mode.height+1,'Journal date/empty message must be visible after explicit A');
        }
        await readAll(page);
        await page.keyboard.press('b'); assert(await panel.evaluate(el => document.activeElement===el));
      }
      // Native Tab, not test-side focus(), reaches original physical A. Space and Enter each turn once.
      for (let i=0;i<12 && await focusedKey(page)!=='a';i++) await page.keyboard.press('Tab');
      assert.equal(await focusedKey(page),'a');
      for (const k of ['Space','Enter']) {
        const selected = await selection(page,reader.kind); await page.keyboard.press(k);
        if (!empty) assert.notDeepEqual(await selection(page,reader.kind),selected);
        assert.equal(await focusedKey(page),'a');
      }
      await page.keyboard.press('Escape');
      const target = paused?(reader.kind==='fish'?'.fishing-pause':'.walk-pause'):'.home-caption';
      await page.locator(target).waitFor(); assert.equal(await panel.count(),0);
      if (paused) { await page.reload(); await page.locator(target).waitFor(); }
      const after = (await api('state')).state;
      for (const field of ['game','pond','park','careCount','economy','logs','album']) assert.deepEqual(after[field],before[field],field);
      for (const k of ['nutrition','play','clean','lastFeed','lastPlay','lastClean']) assert.equal(after.growth.care[k],before.growth.care[k]);
      assert.equal(after.sleeping,sleeping); assert.deepEqual(writes,[]); assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)),preference);
      results.push({kind:reader.kind,stage,sleeping,empty,paused,...mode,movements});
      await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2));
    } catch (e) {
      await page.screenshot({path:join(dir,`failure-${label}.png`),fullPage:true});
      await writeFile(join(dir,`failure-${label}.json`),JSON.stringify({errors,writes,text:await page.locator('body').innerText()},null,2)); throw e;
    } finally { await context.close(); }
  }
  await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify({groups:results.length,artifacts:dir,port}));
} finally {
  console.error('Artifacts:',dir); if (browser) await browser.close(); await stop(); await writeFile(join(dir,'server.log'),log);
}
