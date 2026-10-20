import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TetrisGame, tetrisOptions } from "./TetrisGame";
import type { PetState } from "./types";

const now = Date.parse("2026-10-21T04:00:00Z");
function fixture(): PetState {
  return { schema: 17, revision: 1, species: 2, name: "积木伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "tetris", startedAt: now,
      round: 0, score: 0, lastBeat: -1, tetris: { board: Array<number>(96).fill(0),
        active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7],
        lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: now } } };
}
const hints = [
  "B / C 继续下落，A 只切换选项。",
  "B 顺时针旋转一次后继续下落；转不动则保持原位。",
  "B 把当前积木直接放到底并固定，再继续下落。",
  "B 打开放弃确认；再次确认前不会丢掉本局。",
  "B 重看玩法；返回后仍暂停，等你手动继续。",
];
afterEach(cleanup);
describe("Tetris pause operation consequences", () => {
  it.each(hints.map((hint, choice) => ({ hint, choice })))("explains choice $choice without changing the saved board", ({ hint, choice }) => {
    const pet = fixture(), before = structuredClone(pet);
    const view = render(<TetrisGame pet={pet} now={now} active choice={choice} />);
    const note = view.container.querySelector(".tetris-operation-hint");
    expect(note?.textContent).toBe(hint);
    expect(note?.getAttribute("aria-live")).toBe("polite");
    expect(note?.getAttribute("aria-atomic")).toBe("true");
    expect(view.container.querySelector(".tetris-overlay .selected")?.textContent).toContain(tetrisOptions[choice]);
    expect(view.container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(pet).toEqual(before);
  });
  it("updates the explanation when only the local menu selection changes", () => {
    const pet = fixture(), view = render(<TetrisGame pet={pet} now={now} active choice={1} />);
    expect(view.container.querySelector(".tetris-operation-hint")?.textContent).toBe(hints[1]);
    view.rerender(<TetrisGame pet={pet} now={now} active choice={2} />);
    expect(view.container.querySelectorAll(".tetris-operation-hint")).toHaveLength(1);
    expect(view.container.querySelector(".tetris-operation-hint")?.textContent).toBe(hints[2]);
  });
  it("also explains a local pause after refreshing a server-running game", () => {
    const pet = fixture(); pet.game!.tetris!.paused = false;
    const view = render(<TetrisGame pet={pet} now={now} active={false} choice={2} />);
    expect(view.container.querySelector(".tetris-operation-hint")?.textContent).toBe(hints[2]);
    expect(pet.game!.tetris!.paused).toBe(false);
  });
  it("does not show pause instructions on a running board", () => {
    const pet = fixture(); pet.game!.tetris!.paused = false;
    const view = render(<TetrisGame pet={pet} now={now} active choice={2} />);
    expect(view.container.querySelector(".tetris-operation-hint")).toBeNull();
    expect(view.container.querySelector(".tetris-overlay")).toBeNull();
  });
  it.each(["won", "stacked", "limit"] as const)("keeps the %s result focused on explicit collection", end => {
    const pet = fixture(); pet.game!.tetris!.end = end; delete pet.game!.tetris!.active;
    const view = render(<TetrisGame pet={pet} now={now} active={false} choice={2} />);
    expect(view.container.querySelector(".tetris-operation-hint")).toBeNull();
    expect(view.container.querySelector(".tetris-overlay")?.textContent).toContain("B / C 收好成绩");
  });
});
