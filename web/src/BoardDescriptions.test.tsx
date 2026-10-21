import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SnakeGame } from "./SnakeGame";
import { TetrisGame, blockCells } from "./TetrisGame";
import type { PetState } from "./types";

const now = 1000;
function pet(kind: "snake" | "tetris"): PetState {
  return { schema: 18, revision: 1, species: 2, name: "伙伴", createdAt: 1, hatchedAt: 1, lastTick: now,
    sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
    game: { id: "one", kind, startedAt: 1, round: 0, score: 0, lastBeat: -1,
      ...(kind === "snake" ? { snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 11, y: 0 }, eaten: 0, step: 0, direction: 0, paused: true, lastMoveAt: now } }
        : { tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: now } }),
    } };
}
function view(p: PetState, active = false) {
  return p.game!.kind === "snake" ? <SnakeGame pet={p} now={now} active={active} turn={0} />
    : <TetrisGame pet={p} now={now} active={active} choice={0} />;
}
function board(kind: "snake" | "tetris") {
  return screen.getByRole("img", { name: kind === "snake" ? /果园棋盘/ : /积木棋盘/ });
}
function description(kind: "snake" | "tetris") {
  const b = board(kind), id = b.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const desc = document.getElementById(id!)!;
  expect(desc.tagName.toLowerCase()).toBe("desc"); expect(b.contains(desc)).toBe(true);
  return desc;
}
afterEach(cleanup);

describe("visible board information in text", () => {
  it.each([0, 1, 2, 3])("describes snake head, ordered body and fruit with one-based coordinates, facing %i", direction => {
    const p = pet("snake"); p.game!.snake!.direction = direction;
    const before = JSON.stringify(p); render(view(p));
    const text = description("snake").textContent!;
    expect(text).toContain("棋盘 10 行 12 列");
    expect(text).toContain("行从上到下、列从左到右，均从 1 开始");
    expect(text).toContain(`蛇头：6 行 5 列，朝${["右", "下", "左", "上"][direction]}`);
    expect(text).toContain("其余蛇身由头至尾：6 行 4 列；6 行 3 列");
    expect(text).toContain("果子：1 行 12 列");
    expect(text).not.toMatch(/安全|推荐|下一步|奖励/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("updates only accepted snake positions and distinguishes locally paused, running and ended boards", () => {
    const p = pet("snake"), n = p.game!.snake!; n.paused = false;
    const { rerender } = render(view(p)); expect(description("snake").textContent).toContain("当前暂停");
    rerender(view(p, true)); expect(description("snake").textContent).toContain("当前前进");
    n.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]; n.food = { x: 0, y: 9 };
    rerender(view(p, true)); expect(description("snake").textContent).toContain("蛇头：6 行 6 列");
    expect(description("snake").textContent).toContain("果子：10 行 1 列");
    n.end = "wall"; rerender(view(p, true)); expect(description("snake").textContent).toContain("本局已结束");
    n.end = "won"; rerender(view(p, true)); expect(description("snake").textContent).not.toContain("果子：");
    expect(description("snake").textContent).toContain("果篮已满");
  });
  it("describes fixed cells, active piece, visible ghost landing and next piece without the hidden bag", () => {
    const p = pet("tetris"), n = p.game!.tetris!; n.board[95] = 6;
    const before = JSON.stringify(p); const { rerender } = render(view(p));
    const text = description("tetris").textContent!;
    expect(text).toContain("棋盘 12 行 8 列");
    expect(text).toContain("行从上到下、列从左到右，均从 1 开始");
    expect(text).toContain("已固定：12 行 8 列");
    expect(text).toContain("当前积木：T 型");
    expect(text).toContain("顺时针旋转 0 度");
    expect(text).toContain("占据 1 行 4 列；2 行 3 列；2 行 4 列；2 行 5 列");
    expect(text).toContain("落点投影：11 行 4 列；12 行 3 列；12 行 4 列；12 行 5 列");
    expect(text).toContain("下一块：I 型");
    expect(text).not.toMatch(/S 型|Z 型|J 型|L 型|安全|推荐|奖励/);
    expect(JSON.stringify(p)).toBe(before);
    n.bag = [7, 4]; rerender(view(p)); expect(description("tetris").textContent).toBe(text);
  });
  it.each([1, 2, 3, 4, 5, 6, 7])("describes the same rotated %i cells as drawn, without claiming unseen moves", kind => {
    const p = pet("tetris"), n = p.game!.tetris!;
    n.active = { kind, rotation: 1, x: 3, y: 2 };
    render(view(p)); const text = description("tetris").textContent!;
    const coords = blockCells(n.active).map(c => `${c.y + 1} 行 ${c.x + 1} 列`).join("；");
    expect(text).toContain(`占据 ${coords}`);
    expect(text).toContain(`顺时针旋转 ${kind === 2 ? 0 : 90} 度`);
  });
  it("updates fixed cells after an accepted board change and omits missing pieces at the end", () => {
    const p = pet("tetris"), n = p.game!.tetris!; n.paused = false;
    const { rerender } = render(view(p)); expect(description("tetris").textContent).toContain("当前暂停");
    expect(description("tetris").textContent).toContain("已固定：无");
    rerender(view(p, true)); expect(description("tetris").textContent).toContain("当前下落");
    n.active = undefined; n.end = "stacked"; n.board[0] = 1; n.board[95] = 2;
    rerender(view(p, true)); const text = description("tetris").textContent!;
    expect(text).toContain("本局已结束"); expect(text).toContain("当前积木：无");
    expect(text).toContain("已固定：1 行 1 列；12 行 8 列");
    expect(text).not.toContain("落点投影：");
  });
  it.each(["snake", "tetris"] as const)("keeps %s description IDs local to the board, with no controls or live tick announcements", kind => {
    const p = pet(kind); const { container } = render(<>{view(p)}{view(p)}</>);
    const boards = screen.getAllByRole("img", { name: kind === "snake" ? /果园棋盘/ : /积木棋盘/ });
    const ids = boards.map(b => b.getAttribute("aria-describedby"));
    expect(ids.every(Boolean)).toBe(true); expect(new Set(ids).size).toBe(2);
    boards.forEach(b => { expect(b.getAttribute("aria-live")).toBeNull(); expect(b.querySelector("desc")?.closest("[aria-live]")).toBeNull(); });
    expect(container.querySelectorAll("button,input,a,[role=button],[tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll(".locked-block")).toHaveLength(0);
  });
});
