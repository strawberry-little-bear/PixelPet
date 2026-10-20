import { describe, expect, it } from "vitest";
import { treasureClue } from "./treasure";
import type { TreasureHunt } from "./types";

const model = (opened: number[] = []): TreasureHunt => ({
  layout: [1, 2, 3, 0, 0, 0, 0, 0, 0], opened, step: 0, paused: false,
});

describe("latest explored empty-cell clue", () => {
  it.each([
    { index: 6, neighbors: [3, 4, 7], nearby: 0 },
    { index: 3, neighbors: [0, 1, 4, 6, 7], nearby: 2 },
    { index: 4, neighbors: [0, 1, 2, 3, 5, 6, 7, 8], nearby: 3 },
  ])("marks only geometric neighbors of $index, including diagonals", ({ index, neighbors, nearby }) => {
    expect(treasureClue(model([index]))).toEqual({ index, neighbors, nearby });
  });
  it("keeps found objects in the count and range, retaining the empty source after finding one", () => {
    const n = model([3, 0]);
    expect(treasureClue(n)).toEqual({ index: 3, neighbors: [0, 1, 4, 6, 7], nearby: 2 });
    n.opened.push(7);
    expect(treasureClue(n)).toEqual({ index: 7, neighbors: [3, 4, 5, 6, 8], nearby: 0 });
  });
  it.each([[], [0], [0, 1], [0, 1, 2], [3, 4, 5, 6, 7, 8]].map(opened => ({ opened })))("has no clue without an explored empty source or after finishing: $opened", ({ opened }) => {
    expect(treasureClue(model(opened))).toBeNull();
  });
  it("derives the same clue after pause and saved-session reload without mutating the model", () => {
    const n = model([3, 0]), before = structuredClone(n), expected = treasureClue(n);
    expect(n).toEqual(before);
    n.paused = true;
    expect(treasureClue(JSON.parse(JSON.stringify(n)))).toEqual(expected);
  });
  it("does not choose a source or neighbor subset based on unopened object positions", () => {
    const n = model([3]);
    const moved = { ...n, layout: [0, 2, 0, 0, 0, 1, 3, 0, 0] };
    // Both layouts expose the same number at cell 3, but hide different objects.
    expect(treasureClue(moved)).toEqual(treasureClue(n));
  });
});
