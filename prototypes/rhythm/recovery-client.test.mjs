// Controlled DOM/network/clock; not real-device or production-save evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createSession, command } from './protocol.mjs';
const source = await readFile(new URL('./public/client.mjs', import.meta.url), 'utf8');
const pointer = 'pixelpet.rhythm.session.v1', id = 'ab000000-0000-4000-8000-000000000001';
const settle = () => new Promise(r => setImmediate(r));
async function client({ server = {}, storage = new Map(), blocked = false } = {}) {
  let now = 0, frame; const commands = [], events = new Map(), elements = new Map(), failures = [], holds = [];
  const element = key => {
    if (!elements.has(key)) elements.set(key, { textContent: '', hidden: false, dataset: {}, style: {}, firstElementChild: { style: {} },
      setAttribute() {}, replaceChildren() {}, getBoundingClientRect: () => ({ top: 0, height: 100 }) });
    return elements.get(key);
  };
  const buttons = ['A', 'B', 'C'].map(key => ({ dataset: { key }, addEventListener: (_, fn) => events.set(`click-${key}`, fn) }));
  const document = { hidden: false, body: { classList: { toggle() {} } }, getElementById: element, createElement: () => ({}),
    querySelector: s => element(s === '#pause' ? 'pause' : s), querySelectorAll: () => buttons, addEventListener: (name, fn) => events.set(name, fn) };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (name, fn) => events.set(name, fn) };
  const checkStorage = () => { if (blocked) throw new Error('Storage blocked'); };
  vm.runInNewContext(source, { document, window, innerHeight: 700, getComputedStyle: () => ({ position: 'static' }), navigator: { onLine: true },
    performance: { now: () => now }, AbortSignal, requestAnimationFrame: fn => { frame = fn; }, sessionStorage: {
      getItem: key => { checkStorage(); return storage.get(key) ?? null; }, setItem: (key, value) => { checkStorage(); storage.set(key, value); },
      removeItem: key => { checkStorage(); storage.delete(key); } },
    fetch: async (url, options) => {
      assert.equal(url, '/lab/command'); const input = JSON.parse(options.body); commands.push(input);
      const index = failures.findIndex(f => f.kind === input.kind), fail = index < 0 ? null : failures.splice(index, 1)[0];
      if (fail?.before) throw new Error('synthetic drop before apply');
      let error, code, status = 200;
      if (input.kind === 'create') { server.state = createSession(id); server.lease = `lease-${(server.generation ?? 0) + 1}`; server.generation = (server.generation ?? 0) + 1; server.lastRequest = 0; }
      else if (!server.state || input.id !== server.state.id) { status = 410; code = 'session_expired'; error = 'expired'; }
      else if (input.kind === 'recover') { server.state = command(server.state, { kind: 'pause' }, now); server.lease = `lease-${++server.generation}`; server.lastRequest = 0; }
      else if (input.lease !== server.lease) { status = 409; code = 'lease_replaced'; error = 'lease replaced'; }
      else if (input.requestId <= server.lastRequest) { status = 409; error = 'old request'; }
      else { server.state = command(server.state, input, now); server.lastRequest = input.requestId; }
      if (fail?.after) throw new Error('synthetic lost acknowledgement');
      const result = status === 200 ? { state: structuredClone(server.state), lease: server.lease, serverTime: now } : { code, error };
      const hold = holds.find(h => h.kind === input.kind && !h.used);
      if (hold) { hold.used = true; await hold.promise; }
      return { ok: status === 200, json: async () => result };
    } });
  await settle();
  const press = async key => { events.get('keydown')({ key, preventDefault() {} }); await settle(); };
  const advance = async ms => { now += ms; frame(); await settle(); };
  const answer = async () => { for (let i = 0; i < 3; i++) await advance(600); await press(server.state.cue.key); };
  const interrupt = async type => {
    if (type === 'visibilitychange') document.hidden = true;
    events.get(type)({ target: window }); await settle(); document.hidden = false;
  };
  const emit = async (type, detail = {}) => { events.get(type)?.({ target: window, ...detail }); await settle(); };
  const hold = kind => {
    let release; const promise = new Promise(resolve => { release = resolve; });
    holds.push({ kind, promise }); return async () => { release(); await settle(); };
  };
  return { commands, storage, server, failures, press, answer, element, advance, interrupt, emit, hold };
}
test('same-tab refresh recovers one acknowledged answer, stays paused and stores only a pointer', async () => {
  const c = await client(); await c.press('C'); await c.answer(); const before = structuredClone(c.server.state);
  assert.equal(before.observations.length, 1);
  assert.deepEqual([...c.storage], [[pointer, id]]);
  const next = await client(c); assert.deepEqual(next.commands.map(x => x.kind), ['recover']);
  assert.equal(next.server.state.status, 'paused'); assert.equal(next.server.state.cue, null);
  assert.deepEqual(next.server.state.observations, before.observations); assert.equal(next.server.state.sequence, before.sequence);
  await next.advance(5000); assert.equal(next.commands.length, 1); assert.match(next.element('status').textContent, /核对本局观测并暂停/);
  await next.press('C'); assert.equal(next.server.state.sequence, before.sequence + 1); assert.equal(next.server.state.status, 'playing');
  assert.equal(next.commands[1].lease, next.server.lease);
});
test('recovery retains completed observations; only explicitly confirmed B restarts', async () => {
  const c = await client(); await c.press('C'); for (let i = 0; i < 12; i++) await c.answer();
  const next = await client(c); assert.equal(next.element('round').textContent, '12 / 12');
  assert.equal(next.server.state.status, 'done'); assert.deepEqual(next.commands.map(x => x.kind), ['recover']);
  await next.press('A'); await next.press('C'); assert.equal(next.commands.length, 1);
  await next.press('B'); assert.deepEqual(next.commands.map(x => x.kind), ['recover']);
  await next.press('B'); assert.deepEqual(next.commands.map(x => x.kind), ['recover', 'restart']);
  assert.equal(next.server.state.status, 'paused'); assert.equal(next.server.state.observations.length, 0);
});
for (const value of ['garbage', '{"id":"fake","score":12}', '', 'a'.repeat(1000)]) test(`invalid saved pointer ${value.length} chars is not trusted or sent`, async () => {
  const c = await client({ storage: new Map([[pointer, value]]) });
  assert.deepEqual(c.commands.map(x => x.kind), ['create']); assert.equal(c.commands[0].id, null);
  assert.deepEqual([...c.storage], [[pointer, id]]);
});
test('unavailable session storage does not prevent manual three-key practice', async () => {
  const c = await client({ blocked: true }); await c.press('C'); await c.answer();
  assert.equal(c.server.state.observations.length, 1); assert.equal(c.storage.size, 0);
});
test('expired session is explained, cleared, and never silently creates or resumes', async () => {
  const c = await client({ storage: new Map([[pointer, id]]) });
  assert.deepEqual(c.commands.map(x => x.kind), ['recover']); assert.equal(c.storage.size, 0);
  assert.match(c.element('status').textContent, /旧观测无法恢复/);
  await c.advance(5000); await c.press('A'); assert.equal(c.commands.length, 1);
  await c.press('B'); assert.deepEqual(c.commands.map(x => x.kind), ['recover', 'create']); assert.equal(c.server.state.status, 'paused');
  await c.press('C'); assert.equal(c.server.state.status, 'playing');
});
test('lease replaced elsewhere stops old page; manual recovery pauses, another C resumes', async () => {
  const c = await client(); const other = await client(c); const currentLease = other.server.lease;
  await c.press('C'); assert.equal(c.server.state.status, 'paused'); assert.equal(c.server.lease, currentLease);
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'pause']);
  await c.advance(5000); assert.equal(c.commands.length, 3);
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'recover'); assert.equal(c.server.state.status, 'paused');
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'resume'); assert.equal(c.server.state.status, 'playing');
});
test('accepted answer with lost acknowledgement is not retried and remains once after refresh', async () => {
  const c = await client(); await c.press('C'); c.failures.push({ kind: 'answer', after: true }); await c.answer();
  assert.equal(c.server.state.status, 'paused'); assert.equal(c.server.state.observations.length, 1);
  assert.equal(c.commands.filter(x => x.kind === 'answer').length, 1);
  const next = await client(c); assert.equal(next.server.state.observations.length, 1); assert.equal(next.server.state.status, 'paused');
  assert.deepEqual(next.commands.map(x => x.kind), ['recover']);
});
test('failed neutral pause requires manual recovery, not replay or automatic resume', async () => {
  const c = await client(); await c.press('C');
  c.failures.push({ kind: 'pause', before: true }); await c.press('C');
  assert.equal(c.server.state.status, 'playing'); assert.match(c.element('status').textContent, /暂停未确认/);
  assert.match(c.element('selection').textContent, /核对本局并暂停/); assert.equal(c.element('pause-help').textContent, 'A 不操作 · B / C 手动核对');
  const count = c.commands.length; await c.advance(5000); assert.equal(c.commands.length, count);
  c.failures.push({ kind: 'recover', after: true }); await c.press('C');
  assert.equal(c.server.state.status, 'paused'); assert.equal(c.commands.at(-1).kind, 'recover');
  const n = c.commands.length; await c.advance(5000); assert.equal(c.commands.length, n, 'lost recovery reply has no retry loop');
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'recover'); assert.equal(c.server.state.status, 'paused');
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'resume'); assert.equal(c.server.state.observations.length, 0);
});


async function openRestartWithOneObservation(c) {
  await c.press('C'); await c.answer(); await c.press('C');
  await c.press('A'); await c.press('B');
}
for (const cancel of ['A', 'C']) test(`restart confirmation: ${cancel} cancels without any write or lost observation`, async () => {
  const c = await client(); await openRestartWithOneObservation(c);
  assert.match(c.element('selection').textContent, /清空本局 1 次观测/);
  assert.match(c.element('pause-help').textContent, /A \/ C 取消.*B 确认重开/);
  const before = structuredClone(c.server.state), writes = c.commands.length;
  await c.press(cancel); await c.advance(5000);
  assert.deepEqual(c.server.state, before); assert.equal(c.commands.length, writes);
  assert.equal(c.element('pause').hidden, false); assert.match(c.element('status').textContent, /已取消重开/);
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'resume');
  assert.equal(c.server.state.observations.length, 1);
});
test('restart confirmation: only a separate B clears observations once and stays paused', async () => {
  const c = await client(); await openRestartWithOneObservation(c);
  assert.equal(c.commands.filter(x => x.kind === 'restart').length, 0);
  await c.press('B'); assert.equal(c.commands.filter(x => x.kind === 'restart').length, 1);
  assert.equal(c.server.state.observations.length, 0); assert.equal(c.server.state.status, 'paused');
  await c.advance(5000); assert.equal(c.commands.filter(x => x.kind === 'resume').length, 1);
});
test('restart confirmation: completed results also require confirmation and cancel retains all twelve', async () => {
  const c = await client(); await c.press('C'); for (let i = 0; i < 12; i++) await c.answer();
  assert.equal(c.server.state.status, 'done'); const before = structuredClone(c.server.state);
  await c.press('B'); assert.equal(c.element('pause').hidden, false);
  assert.match(c.element('selection').textContent, /清空本局 12 次观测/);
  await c.press('C'); assert.deepEqual(c.server.state, before); assert.equal(c.element('pause').hidden, true);
  await c.press('B'); await c.press('B'); assert.equal(c.server.state.observations.length, 0);
  assert.equal(c.server.state.status, 'paused'); assert.equal(c.commands.filter(x => x.kind === 'restart').length, 1);
});
test('restart confirmation: refresh discards the prompt, not saved observations', async () => {
  const c = await client(); await openRestartWithOneObservation(c); const next = await client(c);
  assert.equal(next.server.state.observations.length, 1); assert.equal(next.server.state.status, 'paused');
  assert.match(next.element('selection').textContent, /继续练习/);
  assert.deepEqual(next.commands.map(x => x.kind), ['recover']);
});
for (const event of ['blur', 'offline', 'visibilitychange']) test(`restart confirmation: ${event} cancels stale consent before later B`, async () => {
  const c = await client(); await openRestartWithOneObservation(c); await c.interrupt(event);
  assert.equal(c.server.state.observations.length, 1); assert.doesNotMatch(c.element('selection').textContent, /清空本局 1 次/);
  await c.press('B'); assert.equal(c.commands.at(-1).kind, 'resume');
  assert.equal(c.commands.filter(x => x.kind === 'restart').length, 0);
});
test('restart confirmation: lost restart acknowledgement recovers without replaying destructive input', async () => {
  const c = await client(); await openRestartWithOneObservation(c);
  c.failures.push({ kind: 'restart', after: true }, { kind: 'pause', before: true }); await c.press('B');
  assert.equal(c.server.state.observations.length, 0); assert.equal(c.server.state.status, 'paused');
  const writes = c.commands.length; await c.advance(5000); assert.equal(c.commands.length, writes);
  await c.press('B'); assert.equal(c.commands.at(-1).kind, 'recover');
  assert.equal(c.commands.filter(x => x.kind === 'restart').length, 1);
  assert.equal(c.server.state.status, 'paused');
});


test('history restore stops a live cue until explicit reconciliation and a separate resume', async () => {
  const c = await client(); await c.press('C'); await c.answer();
  const before = structuredClone(c.server.state), writes = c.commands.length;
  await c.emit('pagehide', { persisted: true });
  for (const event of ['blur', 'visibilitychange', 'offline']) await c.interrupt(event);
  await c.press('A'); await c.press('C'); await c.advance(5000);
  assert.equal(c.commands.length, writes, 'a departed page cannot submit, resume or poll');
  await c.emit('pageshow', { persisted: true });
  assert.match(c.element('status').textContent, /页面已恢复.*核对/);
  assert.match(c.element('selection').textContent, /核对本局并暂停/);
  await c.press('A'); await c.advance(5000); assert.equal(c.commands.length, writes);
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'recover');
  assert.equal(c.server.state.status, 'paused'); assert.equal(c.server.state.cue, null);
  assert.deepEqual(c.server.state.observations, before.observations);
  await c.press('C'); assert.equal(c.commands.at(-1).kind, 'resume');
  assert.equal(c.server.state.sequence, before.sequence + 1);
});
for (const kind of ['resume', 'answer', 'pause', 'restart', 'recover'])
  test(`history restore ignores a delayed ${kind} reply and never resends that operation`, async () => {
    const c = await client();
    if (kind === 'restart') await openRestartWithOneObservation(c);
    else if (kind !== 'resume') { await c.press('C'); await c.answer(); }
    if (kind === 'recover') {
      await c.emit('pagehide'); await c.emit('pageshow', { persisted: true });
    }
    if (kind === 'answer') for (let i = 0; i < 3; i++) await c.advance(600);
    const release = c.hold(kind);
    await c.press(kind === 'answer' ? c.server.state.cue.key : kind === 'restart' ? 'B' : 'C');
    assert.equal(c.commands.at(-1).kind, kind);
    const observations = structuredClone(c.server.state.observations), count = c.commands.length;
    await c.emit('pagehide', { persisted: true }); await c.emit('pageshow', { persisted: true });
    await c.press('B'); assert.equal(c.commands.at(-1).kind, 'recover');
    assert.equal(c.commands.length, count + 1);
    assert.equal(c.server.state.status, 'paused');
    await release(); await c.advance(5000);
    assert.match(c.element('status').textContent, /核对本局观测并暂停/);
    assert.deepEqual(c.server.state.observations, observations);
    assert.equal(c.commands.length, count + 1, 'late acknowledgement cannot trigger pause or replay');
    await c.press('C'); assert.equal(c.commands.at(-1).kind, 'resume');
  });
test('history restore cancels restart consent but retains all twelve completed observations', async () => {
  const c = await client(); await c.press('C'); for (let i = 0; i < 12; i++) await c.answer();
  await c.press('B'); assert.match(c.element('selection').textContent, /清空本局 12 次/);
  const count = c.commands.length;
  await c.emit('pagehide'); await c.emit('pageshow', { persisted: true });
  await c.press('B'); assert.equal(c.commands.at(-1).kind, 'recover');
  assert.equal(c.server.state.observations.length, 12); assert.equal(c.server.state.status, 'done');
  assert.equal(c.commands.length, count + 1);
  await c.press('B'); assert.match(c.element('selection').textContent, /清空本局 12 次/);
  assert.equal(c.commands.length, count + 1, 'B must request fresh consent, not reuse pre-navigation consent');
});
test('history restore before a create reply does not auto-create or resurrect an unknown session', async () => {
  const c = await client();
  // Expire the known pointer so the next explicit action creates a new session.
  c.server.state = null; await c.press('C');
  const release = c.hold('create'); await c.press('C');
  const count = c.commands.length;
  await c.emit('pagehide'); await c.emit('pageshow', { persisted: true });
  await release(); await c.advance(5000);
  assert.equal(c.commands.length, count); assert.equal(c.storage.has(pointer), false);
  assert.match(c.element('status').textContent, /新建暂停练习/);
  await c.press('B'); assert.equal(c.commands.at(-1).kind, 'create');
  assert.equal(c.server.state.status, 'paused');
});
test('initial pageshow does not interrupt an ordinary first load', async () => {
  const c = await client(); await c.emit('pageshow', { persisted: false }); await c.press('C');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume']);
});
