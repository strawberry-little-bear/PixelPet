// Deterministic client event ordering, not a real-device rendering measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSession, command } from './protocol.mjs';
const source = await readFile(new URL('./public/client.mjs', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
async function client(networkMs = 0) {
  let now = 0, frame, state;
  const events = new Map(), commands = [], elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, dataset: {}, style: {},
      firstElementChild: { style: {} }, setAttribute() {}, replaceChildren() {},
      getBoundingClientRect: () => ({ top: 0, height: 100 }) });
    return elements.get(id);
  };
  const buttons = ['A', 'B', 'C'].map(key => ({ dataset: { key }, addEventListener: (_, fn) => events.set(`click-${key}`, fn) }));
  const document = { hidden: false, body: { classList: { toggle() {} } },
    getElementById: element, createElement: () => ({}),
    querySelector: selector => element(selector === '#pause' ? 'pause' : selector),
    querySelectorAll: () => buttons, addEventListener: (name, fn) => events.set(name, fn) };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (name, fn) => events.set(name, fn) };
  vm.runInNewContext(source, { document, window, innerHeight: 700,
    getComputedStyle: () => ({ position: 'static' }), navigator: { onLine: true },
    performance: { now: () => now }, AbortSignal,
    requestAnimationFrame: fn => { frame = fn; },
    fetch: async (url, options) => {
      assert.equal(url, '/lab/command'); const input = JSON.parse(options.body); commands.push(input);
      state = input.kind === 'create' ? createSession('isolated-client') : command(state, input, now);
      const result = { state: structuredClone(state), serverTime: now };
      now += networkMs; // Synthetic RTT for the client estimate, not a transport measurement.
      return { ok: true, json: async () => result };
    },
  });
  await settle();
  const press = async (key, via = 'keyboard') => {
    if (via === 'button') events.get(`click-${key}`)();
    else events.get('keydown')({ key, preventDefault() {} });
    await settle();
  };
  const advance = async (ms, paint = true) => { now += ms; if (paint) frame(); await settle(); };
  const active = async () => { await press('C'); for (let i = 0; i < 3; i++) await advance(600); assert.match(element('phase').textContent, /现在回应/); };
  const keyboard = async (type, key, targetKey, options = {}) => {
    let prevented = false;
    const target = buttons.find(button => button.dataset.key === targetKey) ?? element('unrelated');
    events.get(type)?.({ key, target, ...options, preventDefault() { prevented = true; } });
    // Model the native button default separately; Chrome checks cover actual defaults.
    if (!prevented && buttons.includes(target) &&
      ((type === 'keydown' && key === 'Enter') || (type === 'keyup' && key === ' ')))
      events.get(`click-${targetKey}`)();
    await settle();
    return prevented;
  };
  return { press, advance, active, keyboard, commands, element, state: () => state };
}
for (const via of ['keyboard', 'button']) for (const key of ['A', 'B']) {
  test(`${via} ${key} after a long frame gap pauses before any answer, even before next paint`, async () => {
    const c = await client(); await c.active(); await c.advance(1101, false);
    await c.press(key, via);
    assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'pause']);
    assert.equal(c.state().observations.length, 0); assert.equal(c.state().status, 'paused');
    assert.match(c.element('status').textContent, /页面停顿/);
    await c.advance(5000); assert.equal(c.commands.length, 3, 'no automatic replay or resume');
    await c.press('C'); assert.equal(c.state().status, 'playing');
    assert.equal(c.state().observations.length, 0, 'manual resume creates a new cue, never spends the stale one');
  });
  test(`${via} ${key} past the estimated deadline pauses before an answer without a long frame gap`, async () => {
    const c = await client(); await c.active();
    for (let i = 0; i < 3; i++) await c.advance(500); // last painted at3300, deadline3600
    await c.advance(301, false); await c.press(key, via);
    assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'pause']);
    assert.equal(c.state().observations.length, 0); assert.match(c.element('status').textContent, /已停止提示/);
  });
}
test('normal preview and response are unchanged; C remains pause, not an answer', async () => {
  const c = await client(); await c.press('C'); await c.press('A');
  assert.equal(c.commands.length, 2); assert.match(c.element('status').textContent, /没有消耗/);
  for (let i = 0; i < 3; i++) await c.advance(600);
  await c.press('A'); assert.equal(c.state().observations.length, 1);
  assert.equal(c.state().observations[0].directionMatches, true);
  await c.press('C'); assert.equal(c.state().status, 'paused');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'answer', 'pause']);
});
test('animation frame still pauses a long gap when there is no input', async () => {
  const c = await client(); await c.active(); await c.advance(1101);
  assert.equal(c.state().status, 'paused'); assert.match(c.element('status').textContent, /页面停顿/);
  assert.equal(c.state().observations.length, 0);
});

test('input uses the same RTT-adjusted cutoff as painting, not the later raw deadline', async () => {
  const c = await client(100); await c.active();
  for (let i = 0; i < 3; i++) await c.advance(500);
  await c.advance(201, false); await c.press('B');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'pause']);
  assert.equal(c.state().observations.length, 0); assert.match(c.element('status').textContent, /已停止提示/);
});
test('the existing inclusive 1000ms frame-gap boundary still permits a live response', async () => {
  const c = await client(); await c.active(); await c.advance(1000, false); await c.press('A');
  assert.equal(c.state().observations.length, 1); assert.equal(c.commands.at(-1).kind, 'answer');
});
for (const networkMs of [0, 100]) test(`the exact existing cutoff stays inclusive (synthetic RTT ${networkMs}ms)`, async () => {
  const c = await client(networkMs); await c.active();
  for (let i = 0; i < 3; i++) await c.advance(500);
  await c.advance(networkMs ? 200 : 300, false); await c.press('A');
  assert.equal(c.state().observations.length, 1); assert.equal(c.commands.at(-1).kind, 'answer');
});

for (const key of ['Enter', ' ']) test(`focused C ${JSON.stringify(key)} activates once per press, not on repeats or release`, async () => {
  const c = await client();
  assert.equal(await c.keyboard('keydown', key, 'C'), true);
  assert.equal(c.state().status, 'playing');
  for (let i = 0; i < 3; i++) {
    assert.equal(await c.keyboard('keydown', key, 'C', { repeat: true }), true);
    assert.equal(c.state().status, 'playing');
  }
  await c.keyboard('keyup', key, 'C');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume']);
  await c.keyboard('keydown', key, 'C');
  await c.keyboard('keyup', key, 'C');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'resume', 'pause']);
});
for (const key of ['Enter', ' ']) test(`focused A/B ${JSON.stringify(key)} retain selection/confirmation, with no release double action`, async () => {
  const c = await client();
  await c.keyboard('keydown', key, 'A');
  await c.keyboard('keydown', key, 'A', { repeat: true });
  await c.keyboard('keyup', key, 'A');
  assert.match(c.element('selection').textContent, /从头重开/);
  await c.keyboard('keydown', key, 'B');
  await c.keyboard('keydown', key, 'B', { repeat: true });
  await c.keyboard('keyup', key, 'B');
  assert.equal(c.state().status, 'paused');
  assert.deepEqual(c.commands.map(x => x.kind), ['create', 'restart']);
});
for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }])
  test(`IME/modifier guard also suppresses native focused-button activation: ${JSON.stringify(options)}`, async () => {
    const c = await client();
    for (const key of ['Enter', ' ']) {
      await c.keyboard('keydown', key, 'C', options);
      await c.keyboard('keyup', key, 'C', options);
    }
    await c.keyboard('keydown', 'C', undefined, options);
    assert.deepEqual(c.commands.map(x => x.kind), ['create']);
  });
test('Enter/Space outside the three buttons keep native behavior; letter repeat stays inert', async () => {
  const c = await client();
  for (const key of ['Enter', ' ']) for (const type of ['keydown', 'keyup'])
    assert.equal(await c.keyboard(type, key), false);
  await c.keyboard('keydown', 'C', undefined, { repeat: true });
  assert.deepEqual(c.commands.map(x => x.kind), ['create']);
  await c.press('C'); assert.equal(c.state().status, 'playing');
});
