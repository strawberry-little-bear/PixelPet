import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, command, pattern, leadMs, lateMs, earlyMs } from './protocol.mjs';
const at = 1700000000000;
const resume = state => command(state, { kind: 'resume' }, at);
const answer = (state, key = state.cue.key, now = state.cue.target) => command(state, { kind: 'answer', key, sequence: state.cue.sequence }, now);
test('start is paused without any cue, save data, score, reward, or resource', () => {
  assert.deepEqual(createSession('test'), { id: 'test', status: 'paused', sequence: 0, cue: null, observations: [] });
});
test('explicit resume previews one immutable server cue and cannot resume twice', () => {
  const before = createSession('test'), state = resume(before);
  assert.equal(before.status, 'paused'); assert.equal(state.cue.target, at + leadMs);
  assert.equal(state.cue.deadline, at + leadMs + lateMs); assert.equal(state.cue.key, pattern[0]);
  assert.throws(() => resume(state));
});
for (const [delta, arrival] of [[-earlyMs - 1, 'early'], [-earlyMs, 'inside'], [0, 'inside'], [lateMs, 'inside'], [lateMs + 1, 'late']]) {
  test(`arrival ${delta} is observation ${arrival}, not a miss`, () => {
    const before = resume(createSession('test')), state = answer(before, before.cue.key, before.cue.target + delta);
    assert.equal(state.observations[0].arrival, arrival); assert.equal(state.observations[0].arrivalDeltaMs, delta);
    assert.equal(state.observations[0].directionMatches, true); assert.equal(before.observations.length, 0);
    assert.equal(state.status, 'playing'); assert.equal(state.cue.sequence, 2);
  });
}
test('wrong direction is recorded honestly without a fabricated correct result', () => {
  const state = answer(resume(createSession('test')), 'B');
  assert.equal(state.observations[0].directionMatches, false); assert.equal(state.observations[0].key, 'B');
});
test('stale/duplicate inputs and invalid keys do not change the session', () => {
  const playing = resume(createSession('test')), next = answer(playing), before = structuredClone(next);
  for (const input of [{ kind: 'answer', key: 'B', sequence: 1 }, { kind: 'answer', key: 'C', sequence: 2 }, { kind: 'unknown' }]) assert.throws(() => command(next, input, at));
  assert.deepEqual(next, before);
});
test('pause discards the cue, does not consume a round, and resume changes sequence', () => {
  const playing = resume(createSession('test')), paused = command(playing, { kind: 'pause' }, at + 1000);
  assert.equal(paused.status, 'paused'); assert.equal(paused.cue, null); assert.equal(paused.observations.length, 0);
  const next = command(paused, { kind: 'resume' }, at + 60000);
  assert.equal(next.cue.sequence, 2); assert.equal(next.cue.target, at + 60000 + leadMs);
  assert.throws(() => command(next, { kind: 'answer', sequence: 1, key: 'A' }, at + 60001));
});
test('answer/pause races retain only one arrival, never auto-resume', () => {
  const playing = resume(createSession('test'));
  const firstAnswer = command(answer(playing), { kind: 'pause' }, at + 5000);
  assert.equal(firstAnswer.status, 'paused'); assert.equal(firstAnswer.observations.length, 1);
  const firstPause = command(playing, { kind: 'pause' }, at + 5000);
  assert.throws(() => answer({ ...firstPause, cue: playing.cue }));
  assert.equal(firstPause.observations.length, 0);
});
test('restart clears observations but cannot reuse a sequence for an old in-flight input', () => {
  const playing = answer(resume(createSession('test'))), oldSequence = playing.cue.sequence;
  const fresh = resume(command(playing, { kind: 'restart' }, at));
  assert.equal(fresh.observations.length, 0); assert(fresh.cue.sequence > oldSequence);
  assert.throws(() => command(fresh, { kind: 'answer', key: 'B', sequence: oldSequence }, at));
});
test('twelve responses end without issuing a thirteenth cue or rewards', () => {
  let state = resume(createSession('test'));
  for (const expected of pattern) { assert.equal(state.cue.key, expected); state = answer(state); }
  assert.equal(state.status, 'done'); assert.equal(state.cue, null); assert.equal(state.observations.length, 12);
  assert.throws(() => command(state, { kind: 'answer', sequence: 12, key: 'A' }, at));
  assert.throws(() => resume(state));
  assert.equal(command(state, { kind: 'pause' }, at).status, 'done');
  for (const key of ['score', 'coins', 'growth', 'care', 'reward']) assert.equal(state[key], undefined);
});
