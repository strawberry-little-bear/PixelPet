import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetOffsetBounds } from './rhythm-timing-bounds.mjs';

const sample = { sentMs: 100, receivedMs: 400, serverMs: 10000, targetMs: 11800, eventMs: 2050 };
test('the report exposes the whole RTT envelope rather than asserting its midpoint is the server clock', () => {
  assert.deepEqual(targetOffsetBounds(sample), {
    available: true, minMs: -150, maxMs: 150, widthMs: 300, position: 'includes-target',
  });
});
test('the same RTT cannot distinguish opposite one-way paths or remove their uncertainty', () => {
  for (const [up, down] of [[250, 50], [50, 250], [0, 300], [300, 0]]) {
    const serverOffset = 9000;
    const sentMs = 100, serverMs = sentMs + up + serverOffset, receivedMs = sentMs + up + down;
    const targetMs = serverMs + 1800;
    // Observe at the midpoint estimate; the actual server time differs with each leg.
    const eventMs = receivedMs + 1800 - (up + down) / 2;
    const bounds = targetOffsetBounds({ sentMs, receivedMs, serverMs, targetMs, eventMs });
    const actualDeltaMs = eventMs + serverOffset - targetMs;
    assert.equal(bounds.position, 'includes-target');
    assert.equal(bounds.widthMs, 300);
    assert(actualDeltaMs >= bounds.minMs && actualDeltaMs <= bounds.maxMs);
  }
});
test('classification preserves inclusive boundaries and exact zero RTT', () => {
  assert.equal(targetOffsetBounds({ ...sample, eventMs: 1800 }).position, 'before-target');
  assert.equal(targetOffsetBounds({ ...sample, eventMs: 2300 }).position, 'after-target');
  for (const eventMs of [1900, 2200]) assert.equal(targetOffsetBounds({ ...sample, eventMs }).position, 'includes-target');
  assert.deepEqual(targetOffsetBounds({ sentMs: 0, receivedMs: 0, serverMs: 10, targetMs: 20, eventMs: 10 }),
    { available: true, minMs: 0, maxMs: 0, widthMs: 0, position: 'includes-target' });
});
test('clock disagreement suppresses the envelope instead of turning a stopped clock into a narrow estimate', () => {
  assert.deepEqual(targetOffsetBounds({ ...sample, clockUncertain: true }), { available: false, reason: 'clock-discontinuity' });
  assert.throws(() => targetOffsetBounds({ ...sample, clockUncertain: 'false' }), TypeError);
});
test('invalid or unordered observations cannot generate a plausible report', () => {
  for (const key of ['sentMs', 'receivedMs', 'serverMs', 'eventMs', 'targetMs']) {
    for (const value of [NaN, Infinity, undefined, '100']) assert.throws(() => targetOffsetBounds({ ...sample, [key]: value }), RangeError);
  }
  assert.throws(() => targetOffsetBounds({ ...sample, receivedMs: 99 }), RangeError);
  assert.throws(() => targetOffsetBounds({ ...sample, eventMs: 399 }), RangeError);
  assert.throws(() => targetOffsetBounds({ ...sample, serverMs: Number.MAX_VALUE, targetMs: -Number.MAX_VALUE }), RangeError);
});
test('fractional monotonic timings and epoch-sized server timestamps retain the observed RTT width', () => {
  const bounds = targetOffsetBounds({ sentMs: 10.25, receivedMs: 110.75, eventMs: 1810.5,
    serverMs: 1792930000000.25, targetMs: 1792930001800.25 });
  assert.equal(bounds.widthMs, 100.5);
  assert.equal(bounds.minMs, -100.25);
  assert.equal(bounds.maxMs, 0.25);
});
