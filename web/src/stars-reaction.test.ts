import { expect, it } from "vitest";
import { starsReactionFor, starsReactionMatches } from "./stars-reaction";
import type { PetState } from "./types";
type Game = NonNullable<PetState["game"]>;
const before: Game = { id: "stars-local", startedAt: 100, round: 1, score: 1, lastBeat: 0 };
const after: Game = { ...before, round: 2, score: 2, lastBeat: 1 };
it("describes only the one newly acknowledged catch", () => {
  expect(starsReactionFor(before, after, 1)).toEqual({ gameId: before.id, round: 2, score: 2, beat: 1, lane: 1 });
});
it.each([0, 1, 2])("accepts the real beat lane %s", lane => {
  expect(starsReactionFor({ ...before, lastBeat: -1 }, { ...after, lastBeat: lane }, lane)).not.toBeNull();
});
it.each([undefined, null, -1, 3, 0.5, "1", NaN, Infinity])("ignores invalid lane %s", lane => {
  expect(starsReactionFor(before, after, lane)).toBeNull();
});
it.each([
  {}, { id: "other" }, { id: undefined }, { kind: "tiles" }, { startedAt: 101 },
  { round: 1 }, { round: 3 }, { score: 1 }, { score: 3 }, { lastBeat: 0 }, { lastBeat: -1 },
  { lastBeat: 1.5 }, { lastBeat: 2 },
] satisfies Partial<Game>[])("ignores reads or incompatible replies %j", change => {
  const next = Object.keys(change).length ? { ...after, ...change } : before;
  expect(starsReactionFor(before, next, 1)).toBeNull();
});
it.each([
  { id: undefined }, { kind: "tiles" }, { round: -1 }, { round: 1.5 }, { round: 4 },
  { score: -1 }, { score: 2 }, { score: 0.5 }, { lastBeat: -2 }, { lastBeat: 0.5 },
] satisfies Partial<Game>[])("ignores invalid starting game %j", change => {
  expect(starsReactionFor({ ...before, ...change }, after, 1)).toBeNull();
});
it("does not invent a reaction without a game, including the final fifth catch", () => {
  expect(starsReactionFor(undefined, after, 1)).toBeNull();
  expect(starsReactionFor(before, undefined, 1)).toBeNull();
  expect(starsReactionFor({ ...before, round: 4 }, { ...after, round: 5 }, 1)).toBeNull();
});
it.each([{ id: "other" }, { kind: "tiles" }, { round: 3 }, { score: 1 }, { lastBeat: 4 }] satisfies Partial<Game>[])("does not render a stale reaction %j", change => {
  expect(starsReactionMatches(starsReactionFor(before, after, 1), { ...after, ...change }, 1)).toBe(false);
});
it("matches only the current lane and acknowledged game", () => {
  const r = starsReactionFor(before, after, 1);
  expect(starsReactionMatches(r, after, 1)).toBe(true);
  expect(starsReactionMatches(r, after, 2)).toBe(false);
  expect(starsReactionMatches(null, after, 1)).toBe(false);
  expect(starsReactionMatches(r, undefined, 1)).toBe(false);
});
