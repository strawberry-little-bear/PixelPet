// Read-only recovery browsing + explicit import, real HTTP/SQLite/Chrome.
// All pets and recovery points are constructed in an isolated temporary DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const { binary, web } = await isolatedTestBuilds();
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'pixelpet-recovery-points-'));
const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms)), results = [];
let server, browser, log = '', startupError;
async function api(path, body) {
 const r = await fetch(`${base}/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 assert(r.ok, await r.clone().text()); return r.json();
}
async function makePoint(name) {
 const at = Date.now();
 await api('import', { schema: 1, revision: 0, species: 2, name, createdAt: at-3600000, hatchedAt: at-3600000, lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [] });
 await api('reset', { confirm: true });
 return (await api('snapshots')).snapshots.find(p => p.pet?.name === name);
}
async function open(page) { await page.getByRole('button', { name: '存档盒', exact: true }).click(); await page.getByRole('button', { name: '自动恢复点 · 查看', exact: true }).click(); await page.locator('.recovery-point-list[aria-busy=false]').waitFor(); }
async function choose(page, point) {
 const button = page.getByRole('button', { name: `预览恢复点 #${point.id}：${point.pet.name}`, exact: true });
 await button.focus(); await page.keyboard.press('Enter');
 await page.getByText('尚未导入 · B 确认替换，A / C 取消', { exact: true }).waitFor();
 assert(await page.locator('.button-c').evaluate(el => document.activeElement === el), 'preview should focus C');
 assert.equal(await page.locator('.lcd button,.lcd a,.lcd input,.lcd [role=button]').count(), 0);
}
async function layout(page) {
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'horizontal page overflow');
 assert.equal(await page.locator('.physical-button').count(), 3);
 const issues = await page.locator('.recovery-point-list').evaluate(el => {
  const box = el.getBoundingClientRect(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), issues = []; let node;
  while ((node = walker.nextNode())) {
   const range = document.createRange(); range.selectNodeContents(node);
   for (const r of range.getClientRects()) if (r.width && r.height && (r.left < box.left-1 || r.right > box.right+1)) issues.push(node.textContent);
  } return issues;
 }); assert.deepEqual(issues, [], 'list text clipped horizontally');
 const retry = page.getByRole('button', { name: '重新读取恢复点', exact: true }); await retry.scrollIntoViewIfNeeded();
 assert(await retry.evaluate(el => { const r=el.getBoundingClientRect(), p=el.closest('.tools-menu').getBoundingClientRect(); return r.top>=p.top-1 && r.bottom<=p.bottom+1; }), 'list bottom must be reachable');
}
try {
 server = spawn(binary, [], { env: { ...process.env, PIXELPET_ADDR: `127.0.0.1:${port}`, PIXELPET_DB: join(dir, 'test.db'), PIXELPET_WEB: web }, stdio: ['ignore','pipe','pipe'] });
 server.once('error', e => { startupError=e; }); server.stdout.on('data', b => { log+=b; }); server.stderr.on('data', b => { log+=b; });
 let ready=false; for(let i=0;i<100;i++) { if(startupError) throw startupError; assert.equal(server.exitCode,null,log); try {if((await fetch(base+'/api/state')).ok){ready=true;break;}}catch{} await wait(100); } assert(ready,log);
 browser = await chromium.launch({ channel: 'chrome', headless: true });
 const modes = [{width:1200,height:800,font:14},{width:320,height:568,font:14},{width:320,height:568,font:28},{width:320,height:380,font:28,forcedColors:'active'}];
 for(const [index,mode] of modes.entries()) {
  const point=await makePoint(`恢复伙伴${index}`);
  const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},forcedColors:mode.forcedColors,reducedMotion:'reduce'}), page=await context.newPage(), errors=[], imports=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>{if(r.method()==='POST' && new URL(r.url()).pathname==='/api/import') imports.push(r);});
  await page.addInitScript(font=>{ document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}); },mode.font);
  try {
   await page.goto(base); await page.locator('.button-b:not([disabled])').waitFor();
   const before=await api('state'); await open(page); await layout(page);
   const after=await api('state'); assert.equal(after.state.revision,before.state.revision); assert.equal(after.saveGeneration,before.saveGeneration); assert.equal(imports.length,0);
   await page.screenshot({path:join(dir,`list-${index}.png`),fullPage:true});
   await choose(page,point);
   const note=page.getByText('尚未导入 · B 确认替换，A / C 取消',{exact:true}); await note.scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'preview overflow');
   await page.screenshot({path:join(dir,`preview-${index}.png`),fullPage:true});
   await page.keyboard.press('c'); await page.locator('.import-preview').waitFor({state:'hidden'});
   assert.equal(imports.length,0); assert.equal((await api('state')).state.hatchedAt,0);
   await open(page); await choose(page,point); await page.keyboard.press('b'); await page.locator('.import-preview').waitFor({state:'hidden'});
   assert.equal(imports.length,1); assert.equal(imports[0].headers()['x-pixelpet-generation'],before.saveGeneration);
   assert.equal(JSON.parse(imports[0].postData()).name,point.pet.name);
   let restored=await api('state'); assert.equal(restored.state.name,point.pet.name); assert.notEqual(restored.saveGeneration,before.saveGeneration);
   const retained=(await api('snapshots')).snapshots; assert(retained.some(p=>p.pet?.stage==='egg'),'state before restore retained');
   await page.reload(); await page.getByRole('heading',{name:point.pet.name,exact:true}).waitFor(); assert.equal((await api('state')).state.name,point.pet.name);
   assert.deepEqual(errors,[]); results.push({mode,readOnly:true,cancel:true,restore:true,refresh:true});
  } finally {await context.close();}
 }
 // A point removed after listing must fail explicitly, never substitute a newer one.
 {
  const point=await makePoint('即将清理的伙伴'), context=await browser.newContext(), page=await context.newPage(), writes=[];
  page.on('request',r=>{if(r.method()==='POST' && new URL(r.url()).pathname==='/api/import') writes.push(r);});
  await page.goto(base); await page.locator('.button-b:not([disabled])').waitFor(); await open(page);
  await page.getByRole('button',{name:`预览恢复点 #${point.id}：${point.pet.name}`,exact:true}).waitFor();
  for(let i=0;i<12;i++) await api('reset',{confirm:true});
  await page.getByRole('button',{name:`预览恢复点 #${point.id}：${point.pet.name}`,exact:true}).click();
  await page.getByRole('alert').filter({hasText:'恢复点已不存在'}).waitFor(); assert.equal(writes.length,0); assert.equal(await page.locator('.import-preview').count(),0);
  results.push({prunedSelection:'explicit failure without replacement'}); await context.close();
 }
 // Generation changes between preview and B are rejected by the ordinary import endpoint.
 {
  const point=await makePoint('过期确认的伙伴'),context=await browser.newContext(),page=await context.newPage();
  await page.goto(base);await page.locator('.button-b:not([disabled])').waitFor();await open(page);await choose(page,point);
  const replacement=await api('reset',{confirm:true});
  const rejection=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/import' && r.request().method()==='POST');
  await page.keyboard.press('b');assert.equal((await rejection).status(),409);
  assert.equal((await api('state')).saveGeneration,replacement.saveGeneration);assert.equal((await api('state')).state.hatchedAt,0);
  results.push({staleConfirmation:'409 and current egg preserved'});await context.close();
 }
 await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify({passed:results.length,artifacts:dir,results},null,2));
} finally { await browser?.close(); if(server && server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));} }
