import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only the isolated child has controlled clocks. No OS time, player service,
// browser clock, production API, or database is changed by this HTTP fixture.
async function lab(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rhythm-clock-'));
  let child;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM'); await once(child, 'exit');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const clockFile = join(dir, 'clock.json');
  const setClock = async (elapsed, wallOffset = 0) => {
    await writeFile(clockFile + '.next', JSON.stringify({ elapsed, wallOffset }));
    await rename(clockFile + '.next', clockFile);
  };
  await setClock(0);
  const preload = join(dir, 'clock.mjs');
  await writeFile(preload, `
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const fixture = () => JSON.parse(readFileSync(${JSON.stringify(clockFile)}, 'utf8'));
const origin = Date.now();
Date.now = () => { const clock = fixture(); return origin + clock.elapsed + clock.wallOffset; };
Object.defineProperty(performance, 'now', { value: () => fixture().elapsed });
`);
  child = spawn(process.execPath, ['--import', pathToFileURL(preload).href,
    fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PIXELPET_RHYTHM_STORE: '', PIXELPET_RHYTHM_PORT: '0', PIXELPET_RHYTHM_UP_MS: '0',
      PIXELPET_RHYTHM_DOWN_MS: '0', PIXELPET_RHYTHM_JITTER_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => errors += data);
  for (let i = 0; i < 100 && !output.includes('\n'); i++) {
    assert.equal(child.exitCode, null, errors); await wait(20);
  }
  assert(output.includes('\n'), `lab startup: ${errors}`);
  const base = JSON.parse(output.split('\n')[0]).url;
  const post = async input => {
    const response = await fetch(base + '/lab/command', { method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return { status: response.status, ...await response.json() };
  };
  const ok = async input => {
    const reply = await post(input); assert.equal(reply.status, 200, JSON.stringify(reply)); return reply;
  };
  return { post, ok, setClock };
}
const action = (reply, kind, requestId, extra = {}) =>
  ({ id: reply.state.id, lease: reply.lease, kind, requestId, ...extra });
const assertCue = reply => {
  assert.equal(reply.state.cue.target - reply.serverTime, 1800);
  assert.equal(reply.state.cue.deadline - reply.state.cue.target, 1800);
};

test('forward wall-clock jump preserves observations, recovery lease and fresh cue timing', async t => {
  const { ok, post, setClock } = await lab(t);
  let r = await ok({ kind: 'create' }); const started = r.serverTime;
  r = await ok(action(r, 'resume', 1)); assertCue(r);
  await setClock(1800);
  r = await ok(action(r, 'answer', 2, { key: r.state.cue.key, sequence: r.state.sequence }));
  assert.equal(r.state.observations[0].arrival, 'inside');
  const before = r;
  await setClock(2000, 3600000);
  r = await ok({ kind: 'recover', id: r.state.id });
  assert.equal(r.serverTime - started, 2000);
  assert.equal(r.state.status, 'paused'); assert.equal(r.state.cue, null);
  assert.deepEqual(r.state.observations, before.state.observations);
  assert.equal(r.state.sequence, before.state.sequence);
  assert.notEqual(r.lease, before.lease);
  const stale = await post(action(before, 'answer', 999, { key: 'B', sequence: before.state.sequence }));
  assert.equal(stale.status, 409); assert.equal(stale.code, 'lease_replaced');
  r = await ok(action(r, 'resume', 1)); assertCue(r);
  assert.equal(r.state.sequence, before.state.sequence + 1);
  assert.equal(r.state.observations.length, 1);
});

test('backward wall-clock jump cannot turn an on-target response into an early observation', async t => {
  const { ok, setClock } = await lab(t);
  let r = await ok({ kind: 'create' }); const started = r.serverTime;
  r = await ok(action(r, 'resume', 1));
  await setClock(1800, -86400000);
  r = await ok(action(r, 'answer', 2, { key: r.state.cue.key, sequence: r.state.sequence }));
  assert.equal(r.serverTime - started, 1800);
  assert.equal(r.state.observations[0].arrivalDeltaMs, 0);
  assert.equal(r.state.observations[0].arrival, 'inside'); assertCue(r);
  const observations = r.state.observations;
  await setClock(1900, -172800000);
  r = await ok(action(r, 'pause', 3));
  assert.equal(r.serverTime - started, 1900);
  assert.equal(r.state.status, 'paused'); assert.equal(r.state.cue, null);
  assert.deepEqual(r.state.observations, observations);
});

test('idle expiration follows elapsed time, retains exact boundary and refreshes only the touched session', async t => {
  const { ok, post, setClock } = await lab(t);
  const stale = await ok({ kind: 'create' });
  let active = await ok({ kind: 'create' });
  // Exactly ten elapsed minutes remains recoverable despite a wall-clock jump.
  await setClock(600000, 86400000);
  active = await ok({ kind: 'recover', id: active.state.id });
  assert.equal(active.state.status, 'paused');
  // One elapsed millisecond later, the untouched session really has expired.
  await setClock(600001, -86400000);
  let expired = await post({ kind: 'recover', id: stale.state.id });
  assert.equal(expired.status, 410); assert.equal(expired.code, 'session_expired');
  active = await ok({ kind: 'recover', id: active.state.id });
  await setClock(1200002, -172800000);
  expired = await post({ kind: 'recover', id: active.state.id });
  assert.equal(expired.status, 410); assert.equal(expired.code, 'session_expired');
  // Moving wall time back again cannot resurrect an expired session.
  await setClock(1200003, -259200000);
  assert.equal((await post({ kind: 'recover', id: active.state.id })).status, 410);
  const fresh = await ok({ kind: 'create' });
  assert.notEqual(fresh.state.id, active.state.id); assert.equal(fresh.state.status, 'paused');
});
