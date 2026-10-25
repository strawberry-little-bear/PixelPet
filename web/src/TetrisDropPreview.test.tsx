import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TetrisGame, tetrisLanding } from "./TetrisGame";
import type { Falling, PetState, Tetris } from "./types";

const now = Date.parse("2026-10-25T04:00:00Z");
function boardWithGaps(rows: number[], gaps: number[]) {
  const board = Array<number>(96).fill(0);
  for (const row of rows) for (let col = 0; col < 8; col++) if (!gaps.includes(col)) board[row * 8 + col] = 6;
  return board;
}
function game(board = Array<number>(96).fill(0), active: Falling = { kind: 1, rotation: 1, x: 7, y: 0 }): Tetris {
  return { board, active, next: 2, bag: [3, 4, 5, 6, 7], lines: 0, pieces: 0, step: 0, lastFallAt: now, paused: true };
}
function pet(n = game()): PetState {
  return { schema: 17, revision: 1, species: 2, name: "积木伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "tetris", startedAt: now, round: 0,
      score: 0, lastBeat: -1, tetris: n } };
}
afterEach(cleanup);

describe("Tetris landing calculation", () => {
  it.each([0, 1, 2, 3, 4])("predicts %i cleared rows for a vertical I without changing the saved state", count => {
    const rows = Array.from({ length: count }, (_, i) => 12 - count + i);
    const n = game(boardWithGaps(rows, [7])), before = structuredClone(n);
    const landing = tetrisLanding(n);
    expect(landing).toEqual({ cells: [8, 9, 10, 11].map(y => ({ x: 7, y })), rows });
    expect(n).toEqual(before);
  });
  it("predicts a two-row O placement and a horizontal I placement", () => {
    expect(tetrisLanding(game(boardWithGaps([10, 11], [3, 4]), { kind: 2, rotation: 3, x: 3, y: 0 }))).toEqual({
      cells: [{ x: 3, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 11 }, { x: 4, y: 11 }], rows: [10, 11],
    });
    expect(tetrisLanding(game(boardWithGaps([11], [2, 3, 4, 5]), { kind: 1, rotation: 0, x: 2, y: 4 }))).toEqual({
      cells: [2, 3, 4, 5].map(x => ({ x, y: 11 })), rows: [11],
    });
  });
  it("does not predict filling a hole below a ledge the piece cannot pass", () => {
    const n = game(boardWithGaps([11], [7])); n.board[9 * 8 + 7] = 2;
    expect(tetrisLanding(n)).toEqual({ cells: [5, 6, 7, 8].map(y => ({ x: 7, y })), rows: [] });
  });
  it("can clear separated rows while retaining the incomplete row between them", () => {
    expect(tetrisLanding(game(boardWithGaps([8, 10, 11], [7])))?.rows).toEqual([8, 10, 11]);
  });
  it.each(Array.from({ length: 28 }, (_, i) => ({ kind: Math.floor(i / 4) + 1, rotation: i % 4 })))(
    "lands kind $kind rotation $rotation at the floor without mutation", ({ kind, rotation }) => {
      const n = game(undefined, { kind, rotation, x: 2, y: 0 }), before = structuredClone(n);
      const landing = tetrisLanding(n)!;
      expect(landing.cells).toHaveLength(4);
      expect(new Set(landing.cells.map(p => p.y * 8 + p.x)).size).toBe(4);
      expect(Math.max(...landing.cells.map(p => p.y))).toBe(11);
      expect(landing.cells.every(p => p.x >= 2 && p.x < 6 && p.y >= 8 && p.y <= 11)).toBe(true);
      expect(landing.rows).toEqual([]); expect(n).toEqual(before);
    });
  it("has no landing without an active piece", () => {
    const n = game(); delete n.active; expect(tetrisLanding(n)).toBeNull();
  });
});

describe("read-only hard-drop preview", () => {
  it("outlines and describes the predicted rows using one existing announcement region", () => {
    const n = game(boardWithGaps([8, 9, 10, 11], [7])), saved = pet(n), before = structuredClone(saved);
    const view = render(<TetrisGame pet={saved} now={now} active choice={2} />);
    expect(view.container.querySelector(".tetris-drop-preview")?.textContent).toBe("落底预览：预计消除 4 行（第 9、10、11、12 行）。按 B 才固定。");
    expect(Array.from(view.container.querySelectorAll(".tetris-preview-row"), el => [el.getAttribute("data-preview-row"), el.getAttribute("y")])).toEqual([
      ["9", "81"], ["10", "91"], ["11", "101"], ["12", "111"],
    ]);
    expect(view.container.querySelectorAll(".tetris-operation-hint[aria-live=polite][aria-atomic=true]")).toHaveLength(1);
    expect(view.container.querySelector(".tetris-drop-preview")?.closest("[aria-live]")).toBe(view.container.querySelector(".tetris-operation-hint"));
    expect(view.container.querySelectorAll(".ghost-block")).toHaveLength(4);
    expect(view.container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(view.container.querySelector(".tetris-companion")?.getAttribute("data-motion")).toBe("waiting");
    expect(saved).toEqual(before);
  });
  it("explicitly says when the piece clears no row", () => {
    const view = render(<TetrisGame pet={pet()} now={now} active choice={2} />);
    expect(view.container.querySelector(".tetris-drop-preview")?.textContent).toBe("落底预览：本块落下后暂不消行。按 B 才固定。");
    expect(view.container.querySelectorAll(".tetris-preview-row")).toHaveLength(0);
  });
  it.each([0, 1, 3, 4])("hides the preview on pause option %i while retaining the landing ghost", choice => {
    const view = render(<TetrisGame pet={pet()} now={now} active choice={choice} />);
    expect(view.container.querySelector(".tetris-drop-preview")).toBeNull();
    expect(view.container.querySelectorAll(".tetris-preview-row")).toHaveLength(0);
    expect(view.container.querySelectorAll(".ghost-block")).toHaveLength(4);
  });
  it("shows a locally paused preview but hides it while running and on every end state", () => {
    const n = game(boardWithGaps([11], [7])); n.paused = false; const saved = pet(n);
    const view = render(<TetrisGame pet={saved} now={now} active={false} choice={2} />);
    expect(view.container.querySelectorAll(".tetris-preview-row")).toHaveLength(1);
    view.rerender(<TetrisGame pet={saved} now={now} active choice={2} />);
    expect(view.container.querySelector(".tetris-drop-preview")).toBeNull();
    for (const end of ["won", "stacked", "limit"] as const) {
      n.end = end; delete n.active;
      view.rerender(<TetrisGame pet={saved} now={now} active={false} choice={2} />);
      expect(view.container.querySelector(".tetris-drop-preview")).toBeNull();
      expect(view.container.querySelectorAll(".tetris-preview-row")).toHaveLength(0);
    }
  });
  it("retains the text and region nodes on ordinary sync without replaying unchanged preview text", () => {
    const saved = pet(game(boardWithGaps([11], [7])));
    const view = render(<TetrisGame pet={saved} now={now} active choice={2} />);
    const hint = view.container.querySelector(".tetris-operation-hint"), preview = hint!.querySelector(".tetris-drop-preview")!;
    const text = preview.firstChild;
    const updated = structuredClone(saved); updated.revision++; updated.needs.energy--;
    view.rerender(<TetrisGame pet={updated} now={now + 30000} active choice={2} />);
    expect(view.container.querySelector(".tetris-operation-hint")).toBe(hint);
    expect(view.container.querySelector(".tetris-drop-preview")).toBe(preview);
    expect(preview.firstChild).toBe(text);
    expect(preview.textContent).toContain("预计消除 1 行（第 12 行）");
    updated.game!.tetris!.board[11 * 8] = 0;
    view.rerender(<TetrisGame pet={updated} now={now + 30000} active choice={2} />);
    expect(preview.textContent).toContain("暂不消行");
    expect(view.container.querySelectorAll(".tetris-preview-row")).toHaveLength(0);
  });
});
