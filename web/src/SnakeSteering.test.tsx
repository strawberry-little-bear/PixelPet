import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SnakeGame } from "./SnakeGame";
import type { PetState } from "./types";

const now = 1_700_000_000_000;
function pet(direction: number, paused = true): PetState {
  return {
    schema: 6, revision: 1, species: 2, name: "转弯伙伴", createdAt: now,
    hatchedAt: now, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
    game: { id: "0123456789abcdef0123456789abcdef", kind: "snake", startedAt: now,
      round: 0, score: 0, lastBeat: -1,
      snake: { direction, paused, body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
        food: { x: 9, y: 9 }, eaten: 0, step: 0, lastMoveAt: now } },
  };
}
afterEach(cleanup);

describe("paused snake relative steering reminder", () => {
  it.each([
    [0, "右", "上", "下"], [1, "下", "右", "左"],
    [2, "左", "下", "上"], [3, "上", "左", "右"],
  ] as const)("uses saved heading %i, not screen-left/screen-right", (direction, heading, left, right) => {
    const view = render(<SnakeGame pet={pet(direction)} now={now} active={false} turn={0} />);
    const guide = view.getByRole("region", { name: "继续后的转弯方向" });
    expect(guide.getAttribute("aria-live")).toBe("polite");
    expect(guide.getAttribute("aria-atomic")).toBe("true");
    expect(guide.textContent).toContain(`蛇头现在朝${heading}`);
    expect(guide.textContent).toContain(`A 左转：朝${left}`);
    expect(guide.textContent).toContain(`B 右转：朝${right}`);
    expect(guide.textContent).toContain("按蛇头朝向转弯，不是屏幕的左右");
    expect(view.getByText("A / C 继续 · B 放弃确认")).toBeTruthy();
    expect(guide.querySelector("button,a,input,[role=button]")).toBeNull();
  });

  it.each([true, false])("supports %s server pause with local permission withdrawn", serverPaused => {
    const view = render(<SnakeGame pet={pet(3, serverPaused)} now={now} active={false} turn={-1} />);
    // Pending turn is not a saved heading and must not leak into recovery advice.
    expect(view.getByRole("region", { name: "继续后的转弯方向" }).textContent).toContain("蛇头现在朝上");
  });

  it("also shows when the server is paused even if local session permission remains", () => {
    const view = render(<SnakeGame pet={pet(1)} now={now} active turn={0} />);
    expect(view.getByRole("region", { name: "继续后的转弯方向" })).toBeTruthy();
  });

  it("does not cover the running board or change an active steering hint", () => {
    const view = render(<SnakeGame pet={pet(0, false)} now={now} active turn={-1} />);
    expect(view.queryByRole("region", { name: "继续后的转弯方向" })).toBeNull();
    expect(view.getByText("我帮你装果子！下一步左转")).toBeTruthy();
  });

  it.each([
    [0, { x: 10, y: 5 }, 0, "前方还有 1 格到围栏"],
    [1, { x: 4, y: 8 }, 0, "前方还有 1 格到围栏"],
    [2, { x: 1, y: 5 }, 0, "前方还有 1 格到围栏"],
    [3, { x: 4, y: 1 }, 0, "前方还有 1 格到围栏"],
  ] as const)("warns before the %i heading reaches a boundary", (direction, head, turn, text) => {
    const state = pet(direction, false);
    state.game!.snake!.body[0] = head;
    const view = render(<SnakeGame pet={state} now={now} active turn={turn} />);
    expect(view.getByRole("status").textContent).toContain(text);
    expect(view.getByRole("status").textContent).toContain("A 左转或 B 右转");
  });

  it("uses the queued turn when deciding whether to warn", () => {
    const state = pet(0, false);
    state.game!.snake!.body[0] = { x: 10, y: 5 };
    const view = render(<SnakeGame pet={state} now={now} active turn={-1} />);
    expect(view.queryByText(/前方还有 .*格到围栏/)).toBeNull();
  });

  it.each(["won", "wall", "body", "limit"] as const)("does not suggest continuing a %s game", end => {
    const state = pet(2); state.game!.snake!.end = end;
    const view = render(<SnakeGame pet={state} now={now} active={false} turn={0} />);
    expect(view.queryByRole("region", { name: "继续后的转弯方向" })).toBeNull();
    expect(view.getByText(/A 暂不操作 · B \/ C 收好本局成绩/)).toBeTruthy();
  });

  it("follows a new authoritative heading without mutating game state", () => {
    const state = pet(0), original = structuredClone(state);
    const view = render(<SnakeGame pet={state} now={now} active={false} turn={0} />);
    expect(state).toEqual(original);
    view.rerender(<SnakeGame pet={pet(3)} now={now} active={false} turn={0} />);
    expect(view.getByRole("region", { name: "继续后的转弯方向" }).textContent).toContain("蛇头现在朝上");
  });
});
