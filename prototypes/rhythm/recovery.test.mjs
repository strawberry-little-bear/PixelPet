// Real isolated HTTP processes; no production database, port or frontend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function lab(t, jitter = 0) {
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PIXELPET_RHYTHM_STORE: '',
    PIXELPET_RHYTHM_PORT: '0', PIXELPET_RHYTHM_UP_MS: '0', PIXELPET_RHYTHM_DOWN_MS: '0', PIXELPET_RHYTHM_JITTER_MS: String(jitter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  let output = '', errors = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => errors += d);
  for (let i = 0; i < 100 && !output.includes('\n'); i++) { assert.equal(child.exitCode, null, errors); await wait(20); }
  assert(output.includes('\n'), errors); const base = JSON.parse(output.split('\n')[0]).url;
  const post = async input => {
    const response = await fetch(base + '/lab/command', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, ...await response.json() };
  };
  const ok = async input => { const r = await post(input); assert.equal(r.status, 200, JSON.stringify(r)); return r; };
  return { post, ok };
}
const action = (r, kind, requestId, extra = {}) => ({ id: r.state.id, lease: r.lease, kind, requestId, ...extra });
test('recover keeps acknowledged observations, clears old cue and rotates page lease', async t => {
  const { ok, post } = await lab(t); let r = await ok({ kind: 'create' });
  assert.equal(typeof r.lease, 'string'); const lease = r.lease;
  r = await ok(action(r, 'resume', 1)); r = await ok(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence }));
  const before = r.state;
  const recovered = await ok({ kind: 'recover', id: before.id });
  assert.equal(recovered.state.id, before.id); assert.equal(recovered.state.status, 'paused'); assert.equal(recovered.state.cue, null);
  assert.equal(recovered.state.sequence, before.sequence); assert.deepEqual(recovered.state.observations, before.observations);
  assert.notEqual(recovered.lease, lease);
  for (const kind of ['resume', 'answer', 'pause', 'restart']) {
    const refused = await post(action(r, kind, 999, { key: 'B', sequence: before.sequence }));
    assert.equal(refused.status, 409); assert.equal(refused.code, 'lease_replaced');
  }
  const resumed = await ok(action(recovered, 'resume', 1));
  assert.equal(resumed.state.sequence, before.sequence + 1); assert.equal(resumed.state.observations.length, 1);
  assert.equal((await post(action(resumed, 'answer', 2, { key: 'A', sequence: before.sequence }))).status, 409);
});
test('recover fences a delayed old-page resume, even with a larger request id', async t => {
  const { ok, post } = await lab(t, 80), r = await ok({ kind: 'create' });
  const old = post(action(r, 'resume', 999)); await wait(15);
  const recovered = await ok({ kind: 'recover', id: r.state.id });
  assert.equal((await old).status, 409); assert.equal(recovered.state.sequence, 0); assert.equal(recovered.state.status, 'paused');
  const next = await ok(action(recovered, 'resume', 1)); assert.equal(next.state.sequence, 1);
});
test('recover before delayed answer prevents an observation; after accepted answer keeps it once', async t => {
  const { ok, post } = await lab(t, 80); let r = await ok({ kind: 'create' });
  r = await ok(action(r, 'resume', 1)); r = await ok(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence }));
  const old = post(action(r, 'answer', 3, { key: 'B', sequence: r.state.sequence })); await wait(15);
  let recovered = await ok({ kind: 'recover', id: r.state.id });
  assert.equal((await old).status, 409); assert.equal(recovered.state.observations.length, 1);
  recovered = await ok({ kind: 'recover', id: r.state.id });
  assert.equal(recovered.state.observations.length, 1); assert.equal(recovered.state.sequence, r.state.sequence);
  assert.equal(recovered.state.cue, null);
});
test('completed observations survive recovery; restart remains explicit and same session', async t => {
  const { ok } = await lab(t); let r = await ok({ kind: 'create' }); r = await ok(action(r, 'resume', 1));
  for (let i = 0; i < 12; i++) r = await ok(action(r, 'answer', i + 2, { key: r.state.cue.key, sequence: r.state.sequence }));
  const saved = r.state; r = await ok({ kind: 'recover', id: saved.id });
  assert.deepEqual(r.state, saved); assert.equal(r.state.status, 'done');
  r = await ok(action(r, 'restart', 1)); assert.equal(r.state.id, saved.id); assert.equal(r.state.status, 'paused');
  assert.equal(r.state.sequence, saved.sequence); assert.deepEqual(r.state.observations, []);
});
test('repeated refresh does not allocate sessions or grow the cue sequence', async t => {
  const { ok } = await lab(t); let r = await ok({ kind: 'create' }); const id = r.state.id;
  for (let i = 0; i < 40; i++) r = await ok({ kind: 'recover', id });
  assert.equal(r.state.sequence, 0); assert.equal(r.state.id, id); assert.equal(r.state.status, 'paused');
});
test('missing lease and unknown session fail closed with distinct recovery information', async t => {
  const { ok, post } = await lab(t), r = await ok({ kind: 'create' });
  const noLease = await post({ kind: 'resume', id: r.state.id, requestId: 1 });
  assert.equal(noLease.status, 409); assert.equal(noLease.code, 'lease_replaced');
  const expired = await post({ kind: 'recover', id: 'missing' });
  assert.equal(expired.status, 410); assert.equal(expired.code, 'session_expired');
});
