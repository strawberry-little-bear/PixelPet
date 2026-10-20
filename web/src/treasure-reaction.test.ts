import { describe, expect, it } from "vitest";
import type { PetState } from "./types";
import { treasureReactionFor } from "./treasure-reaction";

type Game = NonNullable<PetState["game"]>;
const game = (): Game => ({ id: "saved-game", kind: "treasure", startedAt: 1, round: 0, score: 0, lastBeat: -1,
  treasure: { layout: [1, 2, 3, 0, 0, 0, 0, 0, 0], opened: [], step: 1, paused: false } });
function dig(before: Game, cell: number) {
  const after = structuredClone(before);
  after.treasure!.opened.push(cell); after.treasure!.step++;
  return after;
}
describe("accepted local treasure reaction", () => {
  it.each([0, 1, 2, 3])("reports only newly opened cell %s", cell => {
    const before = game(), after = dig(before, cell);
    expect(treasureReactionFor(before, after, cell, 7)).toEqual({ gameId: before.id, step: 2, cell, item: before.treasure!.layout[cell], serial: 7 });
    expect(before.treasure!.opened).toEqual([]);
  });
  it.each([
    (a: Game, b: Game) => { b.id = "another-game"; },
    (a: Game, b: Game) => { a.kind = "walk"; },
    (a: Game, b: Game) => { b.kind = "walk"; },
    (a: Game) => { a.id = ""; },
    (a: Game) => { a.treasure!.paused = true; },
    (a: Game, b: Game) => { b.treasure!.step--; },
    (a: Game, b: Game) => { b.treasure!.step++; },
    (a: Game, b: Game) => { b.treasure!.opened.push(1); },
    (a: Game, b: Game) => { b.treasure!.opened = [1]; },
    (a: Game, b: Game) => { a.treasure!.opened = [0]; },
    (a: Game, b: Game) => { b.treasure!.layout[0] = 0; },
    (a: Game, b: Game) => { b.treasure!.layout.pop(); },
    (a: Game, b: Game) => { a.treasure!.layout.pop(); },
    (a: Game) => { delete a.treasure; },
    (a: Game, b: Game) => { delete b.treasure; },
  ])("does not replay reads, resume, different/changed models or duplicate cells (%#)", mutate => {
    const before = game(), after = dig(before, 0); mutate(before, after);
    expect(treasureReactionFor(before, after, 0, 1)).toBeNull();
  });
  it("requires the same ordered history, not just the same length", () => {
    const before = game(); before.treasure!.opened = [1, 3];
    const after = dig(before, 0); after.treasure!.opened = [3, 1, 0];
    expect(treasureReactionFor(before, after, 0, 1)).toBeNull();
  });
  it.each([undefined, null, "0", -1, 9, .5, NaN])("ignores invalid cell %s", cell => {
    const before = game(); expect(treasureReactionFor(before, dig(before, 0), cell, 1)).toBeNull();
  });
  it("requires both snapshots", () => {
    expect(treasureReactionFor(undefined, game(), 0, 1)).toBeNull();
    expect(treasureReactionFor(game(), undefined, 0, 1)).toBeNull();
  });
  it("final reveal does not turn unsearched objects into discoveries", () => {
    const before = game(); before.treasure!.opened = [3, 4, 5, 6, 7];
    const after = dig(before, 8); after.treasure!.paused = true;
    expect(treasureReactionFor(before, after, 8, 1)?.item).toBe(0);
    expect(treasureReactionFor(before, after, 0, 1)).toBeNull();
  });
});
