// Actual random boards, solver-assisted API setup, then physical A/B/C actions.
// Held real replies and synthetic blur test UI boundaries, not natural OS timing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedTestBuilds } from './browser-test-builds.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {binary,web}=await isolatedTestBuilds({root});
const {chromium}=await import(process.env.PIXELPET_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'pixelpet-board-collection-'));
const artifacts=process.env.PIXELPET_TEST_ARTIFACTS||dir;
assert(isAbsolute(artifacts));await mkdir(artifacts,{recursive:true});
const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});
});
const base=`http://127.0.0.1:${port}`,wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
let server,browser,startupError,log='';
async function api(path,body){
  const r=await fetch(base+'/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await r.json();assert(r.ok,JSON.stringify(value));return value;
}
async function command(state,kind,extra={}){
  return (await api('action',{kind,gameId:state.game.id,step:(state.game.snake??state.game.tetris).step,...extra})).state;
}
async function key(page,letter){
  await page.locator('.button-'+letter+':not(:disabled)').tap();
  await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled);
}
const count=(state,kind)=>kind==='snake'?state.game.snake.eaten:state.game.tetris.lines;
const directions=[[1,0],[0,1],[-1,0],[0,-1]];
function snakePath(n){
  const queue=[{body:n.body,dir:n.direction,path:[]}],seen=new Set();
  for(let i=0;i<queue.length&&i<100000;i++){
    const {body,dir,path}=queue[i];
    for(const turn of [0,-1,1]){
      const heading=(dir+turn+4)%4,[dx,dy]=directions[heading],head={x:body[0].x+dx,y:body[0].y+dy};
      if(head.x<0||head.x>=12||head.y<0||head.y>=10)continue;
      const eating=head.x===n.food.x&&head.y===n.food.y;
      if((eating?body:body.slice(0,-1)).some(p=>p.x===head.x&&p.y===head.y))continue;
      const route=[...path,turn];if(eating)return route;
      const next=[head,...body.slice(0,-1)],id=heading+':'+next.map(p=>p.x+','+p.y).join(';');
      if(seen.has(id))continue;seen.add(id);queue.push({body:next,dir:heading,path:route});
    }
  }
  assert.fail('no legal route to the genuine fruit');
}
const shapes=[[[0,0],[1,0],[2,0],[3,0]],[[0,0],[1,0],[0,1],[1,1]],[[1,0],[0,1],[1,1],[2,1]],[[1,0],[2,0],[0,1],[1,1]],[[0,0],[1,0],[1,1],[2,1]],[[0,0],[0,1],[1,1],[2,1]],[[2,0],[0,1],[1,1],[2,1]]];
function cells(kind,rotation){
  let points=shapes[kind-1];
  for(let i=0;i<(kind===2?0:rotation);i++){
    points=points.map(([x,y])=>[3-y,x]);const mx=Math.min(...points.map(p=>p[0])),my=Math.min(...points.map(p=>p[1]));
    points=points.map(([x,y])=>[x-mx,y-my]);
  }
  return points;
}
function placements(board,kind){
  const options=[];
  for(let rotation=0;rotation<(kind===2?1:4);rotation++){
    const points=cells(kind,rotation),width=Math.max(...points.map(p=>p[0]))+1;
    for(let x=0;x<=8-width;x++){
      const fits=y=>points.every(([dx,dy])=>y+dy<12&&!board[(y+dy)*8+x+dx]);
      if(!fits(0))continue;let y=0;while(fits(y+1))y++;
      const locked=[...board];for(const [dx,dy]of points)locked[(y+dy)*8+x+dx]=kind;
      const kept=[];let cleared=0;
      for(let row=0;row<12;row++){const values=locked.slice(row*8,row*8+8);if(values.every(Boolean))cleared++;else kept.push(...values);}
      const next=[...Array(cleared*8).fill(0),...kept],heights=[];let holes=0;
      for(let col=0;col<8;col++){let top=12;for(let row=0;row<12;row++){if(next[row*8+col])top=Math.min(top,row);else if(top<12)holes++;}heights.push(12-top);}
      const bump=heights.slice(1).reduce((sum,h,i)=>sum+Math.abs(h-heights[i]),0);
      const score=cleared*10-holes*8-heights.reduce((a,b)=>a+b,0)*.5-bump*.3-Math.max(...heights)*.5;
      options.push({rotation,x,cleared,score,board:next});
    }
  }
  return options;
}
async function prepare(kind){
  let state=(await api('state')).state;
  if(kind==='snake'){
    const path=snakePath(state.game.snake);
    state=await command(state,'snake-resume');
    for(const turn of path.slice(0,-1)){
      await wait(Math.max(0,state.game.snake.lastMoveAt+620-Date.now()));
      state=await command(state,'snake-step',{turn});assert(!state.game.snake.end);
    }
    state=await command(state,'snake-pause');return {state,turn:path.at(-1)};
  }
  for(let pieces=0;pieces<40;pieces++){
    const n=state.game.tetris;assert(!n.end,'setup must not silently discard a failed board');
    const options=placements(n.board,n.active.kind);
    for(const option of options){
      const next=placements(option.board,n.next);
      option.total=option.score+.7*Math.max(-1000,...next.map(v=>v.score));
    }
    options.sort((a,b)=>b.total-a.total);const best=options[0];assert(best);
    if(!n.paused)state=await command(state,'tetris-pause');
    for(let r=0;r<best.rotation;r++){
      state=await command(state,'tetris-rotate');state=await command(state,'tetris-pause');
    }
    state=await command(state,'tetris-resume');
    while(state.game.tetris.active.x!==best.x){
      state=await command(state,'tetris-move',{turn:Math.sign(best.x-state.game.tetris.active.x)});
    }
    state=await command(state,'tetris-pause');
    if(best.cleared)return {state,turn:0,cleared:best.cleared,board:best.board};
    state=await command(state,'tetris-drop');
  }
  assert.fail('no genuine line clear prepared within 40 pieces');
}
async function observeSnakeProgress(page) {
  await page.evaluate(() => {
    window.snakeProgressChanges = [];
    const progress = document.querySelector('.snake-progress');
    new MutationObserver(() => window.snakeProgressChanges.push({
      text: progress.textContent, live: progress.getAttribute('aria-live'),
    })).observe(progress, { subtree: true, childList: true, characterData: true });
  });
}
async function trigger(page,kind,turn,held=false){
  if(kind==='snake'){
    await key(page,'c');if(turn)await key(page,turn<0?'a':'b');
  }else{
    await key(page,'a');await key(page,'a');
    const preview=page.locator('.tetris-drop-preview');await preview.waitFor();
    const rows=await page.locator('.tetris-preview-row').evaluateAll(els=>els.map(el=>Number(el.dataset.previewRow)));
    assert(rows.length>0,'prepared genuine clear must be previewed');
    assert.equal(await preview.textContent(),`落底预览：预计消除 ${rows.length} 行（第 ${rows.join('、')} 行）。按 B 才固定。`);
    if(held)await page.locator('.button-b:not(:disabled)').tap();else await key(page,'b');
  }
}
try{
  server=spawn(binary,[],{cwd:root,env:{...process.env,PIXELPET_ADDR:`127.0.0.1:${port}`,PIXELPET_DB:join(dir,'test.db'),PIXELPET_WEB:web},stdio:['ignore','pipe','pipe']});
  server.once('error',e=>{startupError=e;});server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
  let ready=false;
  for(let i=0;i<100;i++){if(startupError)throw startupError;assert.equal(server.exitCode,null,log);try{await api('state');ready=true;break;}catch{await wait(50);}}
  assert(ready,log);browser=await chromium.launch({headless:true,channel:'chrome'});
  for(const mode of [{name:'desktop',width:1200,height:900,font:14},{name:'phone-large',width:320,height:480,font:28,contrast:true}])for(const kind of ['snake','tetris']){
    const now=Date.now();await api('import',{schema:1,revision:1,species:2,name:'收集反馈测试',createdAt:now-3600000,hatchedAt:now-3600000,lastTick:now,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[]});
    await api('action',{kind:`play-${kind}`});
    const context=await browser.newContext({viewport:{width:mode.width,height:mode.height},hasTouch:true,reducedMotion:'reduce',forcedColors:mode.contrast?'active':'none'});
    let release=()=>{};
    try{
      const initial=await prepare(kind),page=await context.newPage(),errors=[],actions=[];
      page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/action')actions.push(r.postDataJSON());});
      await page.addInitScript(font=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;}),mode.font);
      const gate=new Promise(r=>{release=r;});let heldReply,failed;
      const handler=async route=>{
        const action=route.request().postDataJSON();
        if(action.kind!==(kind==='snake'?'snake-step':'tetris-drop'))return route.continue();
        try{const response=await route.fetch();assert(response.ok());heldReply=await response.json();assert(count(heldReply.state,kind)>count(initial.state,kind));await gate;await route.fulfill({response});}catch(e){failed=e;}
      };
      await page.route('**/api/action',handler);await page.goto(base);await page.locator(`.${kind}-overlay`).waitFor();
      if(kind==='snake')await observeSnakeProgress(page);
      await trigger(page,kind,initial.turn,true);
      for(let i=0;i<500&&!heldReply&&!failed;i++)await wait(10);if(failed)throw failed;assert(heldReply,'genuine collection reply must be held');
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));release();
      await page.waitForFunction(kind=>!document.querySelector('.button-b')?.disabled&&document.querySelector(`.${kind}-overlay`),kind);
      assert.equal(await page.locator(`.${kind}-companion`).getAttribute('data-motion'),'waiting','late collection must not play behind a paused board');
      if(kind==='snake')assert.deepEqual(await page.evaluate(()=>window.snakeProgressChanges), [{text:`果子 ${count(heldReply.state,kind)}/8`,live:'off'}], 'late fruit acknowledgement must be readable without a live announcement');
      const committed=(await api('state')).state;assert.equal(count(committed,kind),count(heldReply.state,kind));
      if(kind==='tetris'){
        assert.equal(committed.game.tetris.lines-initial.state.game.tetris.lines,initial.cleared,'actual first clear matches the predicted rows');
        assert.deepEqual(committed.game.tetris.board,initial.board,'actual first board matches the landing and clear');
        // Blur retains the selected option. Preview the newly accepted active
        // piece, without replaying the previous piece's collection animation.
        const n=committed.game.tetris;
        const nextLanding=placements(n.board,n.active.kind).find(p=>p.rotation===n.active.rotation&&p.x===n.active.x);
        assert(nextLanding,'the accepted next piece has a landing');
        assert.equal(await page.locator('.tetris-preview-row').count(),nextLanding.cleared);
        await page.locator('.tetris-drop-preview').waitFor();
      }
      assert.equal(committed.careCount,0);assert.equal(committed.economy.coins,initial.state.economy.coins);
      await page.unroute('**/api/action',handler);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await wait(200);const writes=actions.length;await wait(1100);assert.equal(actions.length,writes,'no automatic resume after blur');
      // Prepare a second real collection, still without awarding or importing a score.
      const second=await prepare(kind);await page.reload();await page.locator(`.${kind}-overlay`).waitFor();
      if(kind==='snake')await observeSnakeProgress(page);
      if(kind==='tetris'){
        await key(page,'a');await key(page,'a');
        await page.locator('.tetris-drop-preview').scrollIntoViewIfNeeded();
        await page.screenshot({path:join(artifacts,`${mode.name}-drop-preview.png`),fullPage:true});
        // Return to the same default option used by trigger.
        for(let i=0;i<3;i++)await key(page,'a');
      }
      await trigger(page,kind,second.turn);await page.locator(`.${kind}-companion.collecting`).waitFor();
      if(kind==='snake')assert.deepEqual(await page.evaluate(()=>window.snakeProgressChanges), [{text:`果子 ${count(second.state,kind)+1}/8`,live:'polite'}], 'active fruit must announce once');
      await page.locator('.button-c:not(:disabled)').tap();await page.locator(`.${kind}-overlay`).waitFor();
      assert.equal(await page.locator(`.${kind}-companion`).getAttribute('data-motion'),'waiting','C must clear feedback before the 900ms expiry');
      await page.waitForFunction(()=>!document.querySelector('.button-b')?.disabled);
      await key(page,'c');assert.equal(await page.locator(`.${kind}-companion`).getAttribute('data-motion'),'waiting','resume must not replay the old collection');await key(page,'c');
      if(kind==='snake')assert.deepEqual(await page.evaluate(()=>window.snakeProgressChanges), [{text:`果子 ${count(second.state,kind)+1}/8`,live:'polite'}], 'resume must not rewrite old progress');
      const after=(await api('state')).state;assert(count(after,kind)>count(second.state,kind));
      if(kind==='tetris'){
        assert.equal(after.game.tetris.lines-second.state.game.tetris.lines,second.cleared,'actual second clear matches the preview');
        assert.deepEqual(after.game.tetris.board,second.board);
      }
      assert.equal(after.careCount,0);assert.equal(after.economy.coins,initial.state.economy.coins);
      assert.equal(await page.locator('.lcd button,.lcd [role="button"]').count(),0);assert.deepEqual(errors,[]);
      await page.screenshot({path:join(artifacts,`${mode.name}-${kind}.png`),fullPage:true});
      results.push({mode:mode.name,kind,first:count(committed,kind),second:count(after,kind),care:after.careCount,predictedClears:kind==='tetris'?[initial.cleared,second.cleared]:undefined,actions});
      await writeFile(join(artifacts,'results.json'),JSON.stringify(results,null,2));
    }finally{release();await context.close();}
  }
  console.log(`Real board collection interruption: ${results.length} journeys passed. ${artifacts}`);
}finally{
  if(browser)await browser.close();if(server&&server.exitCode===null){const closed=new Promise(r=>server.once('exit',r));server.kill();await closed;}
  await writeFile(join(artifacts,'server.log'),log);
}
