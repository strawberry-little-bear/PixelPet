import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const wait = ms => new Promise(r => setTimeout(r,ms));
async function lab(t, jitter = 0) {
  const child = spawn(process.execPath, [new URL('./server.mjs',import.meta.url).pathname], {env:{...process.env,
    PIXELPET_RHYTHM_PORT:'0', PIXELPET_RHYTHM_UP_MS:'0', PIXELPET_RHYTHM_DOWN_MS:'0', PIXELPET_RHYTHM_JITTER_MS:String(jitter)},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{ if(child.exitCode === null) { child.kill('SIGTERM'); await once(child,'exit'); } });
  let output='', stderr=''; child.stdout.on('data',d=>output+=d); child.stderr.on('data',d=>stderr+=d);
  for(let i=0;i<100&&!output.includes('\n');i++) { assert.equal(child.exitCode,null,stderr); await wait(20); }
  assert(output.includes('\n'),'lab startup'); const base=JSON.parse(output.split('\n')[0]).url;
  const leases = new Map();
  const post = (input, extra={}) => fetch(base+'/lab/command',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...extra},body:typeof input === 'string'?input:JSON.stringify({lease:leases.get(input.id),...input})});
  const state = async input => { const res=await post(input); assert.equal(res.status,200,await res.clone().text()); const reply=await res.json(); leases.set(reply.state.id,reply.lease); return reply.state; };
  return {base,post,state};
}
test('loopback lab serves only static allowlist; same-origin JSON and bounded body required',async t=>{
  const {base,post}=await lab(t);
  for(const path of ['/','/client.mjs','/styles.css']) {
    const res=await fetch(base+path); assert.equal(res.status,200);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.match(res.headers.get('content-security-policy'),/connect-src 'self'/);
  }
  for(const path of ['/api/state','/api/action','/data/pixelpet.db','/server.mjs','/protocol.mjs','/unknown']) assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/lab/command')).status,404);
  assert.equal((await post({kind:'create'},{Origin:'https://example.invalid'})).status,403);
  assert.equal((await post({kind:'create'},{'Content-Type':'text/plain'})).status,403);
  for(const body of ['{','null','[]','123']) assert.equal((await post(body)).status,400);
  assert.equal((await post({pad:'字'.repeat(4096)})).status,413);
});
test('HTTP sequence, request ordering and invalid command cannot consume observations',async t=>{
  const {post,state}=await lab(t); const initial=await state({kind:'create'});
  assert.equal(initial.status,'paused'); let s=await state({kind:'resume',id:initial.id,requestId:1});
  for(const requestId of [undefined,0,-1,1,1.5,'2']) assert.equal((await post({kind:'pause',id:s.id,requestId})).status,409);
  for(const input of [{kind:'unknown'},{kind:'answer',key:'C',sequence:s.sequence},{kind:'answer',key:'A',sequence:0}]) assert.equal((await post({id:s.id,requestId:2,...input})).status,409);
  s=await state({kind:'answer',id:s.id,requestId:2,key:'A',sequence:s.sequence});
  assert.equal(s.observations.length,1); assert.equal(s.observations[0].arrival,'early');
  assert.equal((await post({kind:'answer',id:s.id,requestId:2,key:'A',sequence:1})).status,409);
  s=await state({kind:'pause',id:s.id,requestId:3}); assert.equal(s.status,'paused');
  assert.equal(s.observations.length,1);
  assert.equal((await post({kind:'resume',id:'missing',requestId:4})).status,410);
});
test('later pause overtakes resume with real alternating upstream jitter',async t=>{
  const {post,state}=await lab(t,80), s=await state({kind:'create'});
  const old=post({kind:'resume',id:s.id,requestId:1}); await wait(15);
  const paused=await state({kind:'pause',id:s.id,requestId:2}); assert.equal(paused.status,'paused');
  assert.equal((await old).status,409);
  const next=await state({kind:'resume',id:s.id,requestId:3});
  assert.equal(next.sequence,1,'superseded resume never created a cue'); assert.equal(next.observations.length,0);
});
test('later pause overtakes answer; old answer cannot spend a round',async t=>{
  const {post,state}=await lab(t,80); let s=await state({kind:'create'});
  s=await state({kind:'resume',id:s.id,requestId:1});
  // Consume one even-index response, then delay the next answer upstream.
  s=await state({kind:'answer',id:s.id,requestId:2,key:'A',sequence:s.sequence});
  const old=post({kind:'answer',id:s.id,requestId:3,key:'B',sequence:s.sequence}); await wait(15);
  const paused=await state({kind:'pause',id:s.id,requestId:4});
  assert.equal((await old).status,409); assert.equal(paused.status,'paused'); assert.equal(paused.observations.length,1);
});
test('lab caps in-memory sessions and never returns reward/save fields',async t=>{
  const {post,state}=await lab(t);
  for(let i=0;i<32;i++) {
    const s=await state({kind:'create'});
    assert.deepEqual(Object.keys(s).sort(),['cue','id','observations','sequence','status']);
  }
  assert.equal((await post({kind:'create'})).status,429);
});
