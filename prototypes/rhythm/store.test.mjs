import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, rename, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openStore, decodeSnapshot } from './store.mjs';
import { command, createSession } from './protocol.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const action = (reply, kind, requestId, extra = {}) => ({ id: reply.state.id, lease: reply.lease, kind, requestId, ...extra });
async function freePort() {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pixelpet-rhythm-store-')), children = new Set();
  t.after(async () => {
    for (const child of children) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
    await rm(dir, { recursive: true, force: true }); await rm(dir + '-moved', { recursive: true, force: true });
  });
  const port = await freePort(), path = join(dir, 'observations.json');
  const start = async (env = {}, expectFailure = false) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, PIXELPET_RHYTHM_PORT: String(port), PIXELPET_RHYTHM_STORE: path,
        PIXELPET_RHYTHM_UP_MS: '0', PIXELPET_RHYTHM_DOWN_MS: '0', PIXELPET_RHYTHM_JITTER_MS: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child); child.once('exit', () => children.delete(child));
    let output = '', errors = '';
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => errors += data);
    for (let i = 0; i < 150 && !output.includes('\n') && child.exitCode === null; i++) await wait(20);
    if (expectFailure) {
      assert.notEqual(child.exitCode, null, errors); assert.notEqual(child.exitCode, 0); assert.equal(output, '');
      return errors;
    }
    assert(output.includes('\n'), errors); const metadata = JSON.parse(output.split('\n')[0]), base = metadata.url;
    const post = async input => {
      const response = await fetch(base + '/lab/command', { method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(input) });
      return { status: response.status, ...await response.json() };
    };
    return { base, metadata, post, ok: async input => {
      const reply = await post(input); assert.equal(reply.status, 200, JSON.stringify(reply)); return reply;
    }, stop: async () => { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } };
  };
  return { dir, path, port, start };
}

test('acknowledged observations survive abrupt restart; no live cue, timing or credentials persist', async t => {
  const f = await fixture(t); let lab = await f.start(), r = await lab.ok({ kind: 'create' });
  assert.equal(lab.metadata.persistent, true);
  r = await lab.ok(action(r, 'resume', 1));
  r = await lab.ok(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence }));
  const before = r, disk = JSON.parse(await readFile(f.path, 'utf8'));
  assert.deepEqual(Object.keys(disk.sessions[0]).sort(), ['id', 'observations', 'sequence']);
  assert.deepEqual(disk.sessions[0].observations, r.state.observations);
  await lab.stop(); lab = await f.start();
  assert.equal((await lab.post(action(before, 'answer', 999, { key: 'B', sequence: before.state.sequence }))).code, 'lease_replaced');
  r = await lab.ok({ kind: 'recover', id: before.state.id });
  assert.deepEqual(r.state.observations, before.state.observations);
  assert.equal(r.state.sequence, before.state.sequence); assert.equal(r.state.status, 'paused'); assert.equal(r.state.cue, null);
  assert.notEqual(r.lease, before.lease);
  r = await lab.ok(action(r, 'resume', 1)); assert.equal(r.state.sequence, before.state.sequence + 1);
  assert.equal(r.state.cue.target - r.serverTime > 0, true);
  assert.equal((await lab.post(action(r, 'answer', 2, { key: 'B', sequence: before.state.sequence }))).status, 409);
});

test('twelve completed observations survive; explicit restart alone clears them and keeps sequence', async t => {
  const f = await fixture(t); let lab = await f.start(), r = await lab.ok({ kind: 'create' });
  r = await lab.ok(action(r, 'resume', 1));
  for (let i = 0; i < 12; i++) r = await lab.ok(action(r, 'answer', i + 2, { key: r.state.cue.key, sequence: r.state.sequence }));
  const before = r.state; await lab.stop(); lab = await f.start();
  r = await lab.ok({ kind: 'recover', id: before.id }); assert.deepEqual(r.state, before);
  r = await lab.ok(action(r, 'restart', 1)); await lab.stop(); lab = await f.start();
  r = await lab.ok({ kind: 'recover', id: before.id });
  assert.equal(r.state.status, 'paused'); assert.deepEqual(r.state.observations, []); assert.equal(r.state.sequence, before.sequence);
});

test('accepted response lost downstream is recovered once without replaying the answer', async t => {
  const f = await fixture(t); let lab = await f.start({ PIXELPET_RHYTHM_DOWN_MS: '300' }), r = await lab.ok({ kind: 'create' });
  r = await lab.ok(action(r, 'resume', 1));
  const abandoned = lab.post(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence })).catch(() => null);
  let accepted = false;
  for (let i = 0; i < 100; i++) {
    if (JSON.parse(await readFile(f.path, 'utf8')).sessions[0].observations.length === 1) { accepted = true; break; }
    await wait(5);
  }
  assert(accepted); await lab.stop(); assert.equal(await abandoned, null); lab = await f.start();
  r = await lab.ok({ kind: 'recover', id: r.state.id }); assert.equal(r.state.observations.length, 1);
  r = await lab.ok({ kind: 'recover', id: r.state.id }); assert.equal(r.state.observations.length, 1);
});

test('write failure gives no success, latches unavailable, and restart recovers last saved state', async t => {
  const f = await fixture(t); let lab = await f.start(), r = await lab.ok({ kind: 'create' });
  const saved = await readFile(f.path, 'utf8');
  await rename(f.dir, f.dir + '-moved');
  const failed = await lab.post(action(r, 'resume', 1)); assert.equal(failed.status, 503); assert.equal(failed.code, 'lab_store_unavailable');
  await rename(f.dir + '-moved', f.dir);
  assert.equal((await lab.post({ kind: 'recover', id: r.state.id })).status, 503);
  assert.equal((await lab.post({ kind: 'create' })).status, 503); assert.equal(await readFile(f.path, 'utf8'), saved);
  await lab.stop(); lab = await f.start(); r = await lab.ok({ kind: 'recover', id: r.state.id });
  assert.equal(r.state.sequence, 0); assert.deepEqual(r.state.observations, []);
});

test('same port excludes a second writer; another port cannot claim or modify the store', async t => {
  const f = await fixture(t), lab = await f.start(); await lab.ok({ kind: 'create' });
  const before = await readFile(f.path, 'utf8');
  assert.match(await f.start({}, true), /EADDRINUSE/);
  assert.match(await f.start({ PIXELPET_RHYTHM_PORT: String(await freePort()) }, true), /incompatible/);
  assert.equal(await readFile(f.path, 'utf8'), before);
});

test('simultaneous first claims on different ports cannot both become writers', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.start(), f.start({ PIXELPET_RHYTHM_PORT: String(await freePort()) })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled').value;
  await winner.ok({ kind: 'create' }); assert.equal(JSON.parse(await readFile(f.path, 'utf8')).sessions.length, 1);
});

test('corrupt, unrelated, newer or oversize files refuse startup unchanged', async t => {
  const f = await fixture(t), lab = await f.start(); await lab.stop();
  const good = JSON.parse(await readFile(f.path, 'utf8'));
  for (const text of ['{', '{}', JSON.stringify({ ...good, version: 2 }), ' '.repeat(256 * 1024 + 1)]) {
    await writeFile(f.path, text); await f.start({}, true); assert.equal(await readFile(f.path, 'utf8'), text);
  }
});

test('store rejects symlinks, hardlinks, repository paths and random port before writing', async t => {
  const f = await fixture(t), other = join(f.dir, 'other.json'); await writeFile(other, '{}');
  await symlink(other, f.path); await f.start({}, true); assert.equal(await readFile(other, 'utf8'), '{}');
  await rm(f.path); await link(other, f.path); await f.start({}, true); assert.equal(await readFile(other, 'utf8'), '{}');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await assert.rejects(openStore(join(root, 'rhythm-test-must-not-exist.json'), f.port), /outside/);
  await symlink(root, join(f.dir, 'repo'), 'dir');
  await assert.rejects(openStore(join(f.dir, 'repo', 'rhythm-test-must-not-exist.json'), f.port), /outside/);
  await assert.rejects(openStore(join(f.dir, 'new.json'), 0), /fixed port/);
  await assert.rejects(openStore('relative.json', f.port), /absolute external path/);
});

test('snapshot validation rejects inconsistent observations and extra live data', () => {
  let state = command(createSession(randomUUID()), { kind: 'resume' }, 0);
  state = command(state, { kind: 'answer', key: 'A', sequence: 1 }, 1800);
  const session = { id: state.id, sequence: state.sequence, observations: state.observations };
  const good = { format: 'pixelpet-rhythm-observations', version: 1, port: 12345, sessions: [session] };
  assert.equal(decodeSnapshot(good, 12345)[0].status, 'paused');
  for (const mutate of [
    s => { s.sessions[0].cue = state.cue; }, s => { s.sessions[0].sequence = 0; },
    s => { s.sessions[0].observations[0].expected = 'B'; },
    s => { s.sessions[0].observations[0].directionMatches = false; },
    s => { s.sessions[0].observations[0].arrival = 'late'; },
    s => { s.sessions[0].observations[0].arrivalDeltaMs = null; },
    s => { s.sessions.push(s.sessions[0]); }, s => { s.sessions[0].id = '../save'; },
    s => { s.sessions[0].id = [s.sessions[0].id]; },
    s => { s.sessions[0].observations.push(s.sessions[0].observations[0]); },
  ]) { const invalid = structuredClone(good); mutate(invalid); assert.throws(() => decodeSnapshot(invalid, 12345)); }
});

test('snapshot writes preserve ordering: later pause overtakes upstream-delayed answer', async t => {
  const f = await fixture(t), lab = await f.start({ PIXELPET_RHYTHM_JITTER_MS: '80' });
  let r = await lab.ok({ kind: 'create' }); r = await lab.ok(action(r, 'resume', 1));
  r = await lab.ok(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence }));
  const old = lab.post(action(r, 'answer', 3, { key: 'B', sequence: r.state.sequence })); await wait(15);
  const paused = await lab.ok(action(r, 'pause', 4)); assert.equal((await old).status, 409);
  assert.equal(paused.state.status, 'paused'); assert.equal(paused.state.observations.length, 1);
  assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')).sessions[0].observations, paused.state.observations);
});

test('expiry is saved even for rejected recovery and cannot resurrect on restart', async t => {
  const f = await fixture(t), clock = join(f.dir, 'elapsed.json'), preload = join(f.dir, 'clock.mjs');
  await writeFile(clock, '0');
  await writeFile(preload, `import {readFileSync} from 'node:fs'; import {performance} from 'node:perf_hooks';
    Object.defineProperty(performance, 'now', { value: () => JSON.parse(readFileSync(${JSON.stringify(clock)}, 'utf8')) });`);
  let lab = await f.start({ NODE_OPTIONS: `--import=${preload}` }); const r = await lab.ok({ kind: 'create' });
  await writeFile(clock, '600001'); assert.equal((await lab.post({ kind: 'recover', id: r.state.id })).status, 410);
  assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')).sessions, []);
  await lab.stop(); lab = await f.start(); assert.equal((await lab.post({ kind: 'recover', id: r.state.id })).status, 410);
});

test('uncertain failure after replacement is not acknowledged or retried; manual recovery reads it once', async t => {
  const f = await fixture(t), marker = join(f.dir, 'fail-directory-sync'), preload = join(f.dir, 'fault.mjs');
  await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const original = fs.promises.open;
    fs.promises.open = async function(path, ...args) {
      const file = await original(path, ...args);
      if (path === fs.realpathSync(${JSON.stringify(f.dir)}) && fs.existsSync(${JSON.stringify(marker)}))
        file.sync = async () => { throw new Error('Fixture: directory sync unconfirmed after replacement'); };
      return file;
    };
    syncBuiltinESMExports();`);
  let lab = await f.start({ NODE_OPTIONS: `--import=${preload}` }), r = await lab.ok({ kind: 'create' });
  r = await lab.ok(action(r, 'resume', 1)); await writeFile(marker, 'fail');
  assert.equal((await lab.post(action(r, 'answer', 2, { key: 'A', sequence: r.state.sequence }))).status, 503);
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).sessions[0].observations.length, 1);
  assert.equal((await lab.post({ kind: 'recover', id: r.state.id })).status, 503);
  await lab.stop(); lab = await f.start(); r = await lab.ok({ kind: 'recover', id: r.state.id });
  assert.equal(r.state.status, 'paused'); assert.equal(r.state.observations.length, 1);
  r = await lab.ok({ kind: 'recover', id: r.state.id }); assert.equal(r.state.observations.length, 1);
});
