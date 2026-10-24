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
    expect(view.container.querySelector(".snake-navigation-hint")?.textContent).toContain(text);
    expect(view.container.querySelector(".snake-navigation-hint")?.textContent).toContain("A 左转或 B 右转");
    expect(view.container.querySelector(".snake-field")?.getAttribute("data-fence-warning")).toBe("near");
  });

  it("uses a quieter border cue two cells away and removes it when the warning is no longer active", () => {
    const state = pet(0, false);
    state.game!.snake!.body[0] = { x: 9, y: 5 };
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-field")?.getAttribute("data-fence-warning")).toBe("ahead");
    state.game!.snake!.body[0] = { x: 8, y: 5 };
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-field")?.hasAttribute("data-fence-warning")).toBe(false);
    state.game!.snake!.paused = true;
    state.game!.snake!.body[0] = { x: 10, y: 5 };
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-field")?.hasAttribute("data-fence-warning")).toBe(false);
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

describe("snake reading without per-step live chatter", () => {
  it("keeps a concise fence warning stable across the last three positions instead of counting down aloud", () => {
    const state = pet(0, false); state.game!.snake!.body[0].x = 8;
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const warning = view.container.querySelector(".snake-boundary-announcement")!;
    expect(warning.textContent).toBe("");
    expect(warning.getAttribute("aria-live")).toBe("polite");
    let last = "";
    for (const x of [9, 10, 11]) {
      const moved = structuredClone(state); moved.game!.snake!.body[0].x = x;
      view.rerender(<SnakeGame pet={moved} now={now} active turn={0} />);
      const current = warning.textContent!;
      expect(current).toContain("快到围栏了");
      expect(current).toContain("C 暂停看清");
      if (last) expect(current).toBe(last);
      last = current;
    }
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(warning.textContent).toBe("");
  });

  it("withdraws the concise warning when a queued turn points away or play pauses", () => {
    const state = pet(0, false); state.game!.snake!.body[0].x = 10;
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const warning = view.container.querySelector(".snake-boundary-announcement")!;
    expect(warning.textContent).toContain("快到围栏了");
    view.rerender(<SnakeGame pet={state} now={now} active turn={-1} />);
    expect(warning.textContent).toBe("");
    view.rerender(<SnakeGame pet={state} now={now} active={false} turn={0} />);
    expect(warning.textContent).toBe("");
    state.game!.snake!.paused = true;
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(warning.textContent).toBe("");
  });

  it("keeps moving coordinates readable without announcing each beat, and only updates fruit progress", () => {
    const state = pet(0, false);
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const navigation = view.container.querySelector(".snake-navigation-hint")!;
    const progress = view.container.querySelector(".snake-progress")!;
    expect(navigation.getAttribute("aria-live")).toBe("off");
    expect(navigation.getAttribute("role")).not.toBe("status");
    expect(progress.getAttribute("aria-live")).toBe("polite");
    expect(progress.getAttribute("aria-atomic")).toBe("true");
    const initialNavigation = navigation.textContent, initialProgress = progress.textContent;
    const moved = structuredClone(state);
    moved.game!.snake!.body[0].x++;
    moved.game!.snake!.step++;
    view.rerender(<SnakeGame pet={moved} now={now + 650} active turn={0} />);
    expect(navigation.textContent).not.toBe(initialNavigation);
    expect(progress.textContent).toBe(initialProgress);
    moved.game!.snake!.eaten = 1;
    view.rerender(<SnakeGame pet={moved} now={now + 1300} active turn={0} />);
    expect(progress.textContent).toBe("果子 1/8");
  });

  it.each([[0, 7], [1, 4], [2, 4], [3, 5]])("shows saved fruit and fence distances while paused heading %i", (heading, distance) => {
    const state = pet(heading), before = structuredClone(state);
    const view = render(<SnakeGame pet={state} now={now} active={false} turn={-1} />);
    const inspection = view.container.querySelector(".snake-paused-position")!;
    expect(inspection.textContent).toContain("果子在右下方，横向 5 格、纵向 4 格。");
    expect(inspection.textContent).toContain(`沿当前朝向，到围栏还有 ${distance} 格`);
    expect(inspection.textContent).toContain("也要留意蛇身");
    expect(view.container.querySelector(".snake-progress")?.getAttribute("aria-live")).toBe("off");
    expect(state).toEqual(before);
  });

  it("warns on the paused boundary without claiming there is a safe extra step", () => {
    const state = pet(0); state.game!.snake!.body[0] = { x: 11, y: 5 };
    const view = render(<SnakeGame pet={state} now={now} active={false} turn={0} />);
    expect(view.container.querySelector(".snake-paused-position")?.textContent).toContain("前面就是围栏，再直行一步会碰到");
  });

  it("silences a late fruit acknowledgement during local pause and does not replace saved heading with a queued turn", () => {
    const state = pet(0, false);
    const view = render(<SnakeGame pet={state} now={now} active turn={-1} />);
    const late = structuredClone(state); late.game!.snake!.eaten = 1;
    view.rerender(<SnakeGame pet={late} now={now + 650} active={false} turn={-1} />);
    expect(view.container.querySelector(".snake-progress")?.getAttribute("aria-live")).toBe("off");
    expect(view.container.querySelector(".snake-progress")?.textContent).toBe("果子 1/8");
    expect(view.container.querySelector(".snake-paused-position")?.textContent).toContain("围栏还有 7 格");
    view.rerender(<SnakeGame pet={late} now={now + 1300} active turn={0} />);
    expect(view.container.querySelector(".snake-progress")?.textContent).toBe("果子 1/8");
    expect(view.container.querySelector(".snake-paused-position")).toBeNull();
  });

  it.each(["won", "wall", "body", "limit"] as const)("leaves %s announcements to the terminal overlay", end => {
    const state = pet(0, false); state.game!.snake!.end = end;
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-progress")?.getAttribute("aria-live")).toBe("off");
    expect(view.container.querySelector(".snake-paused-position")).toBeNull();
    expect(view.container.querySelector(".snake-navigation-hint")).toBeNull();
    expect(view.container.querySelector(".snake-overlay")?.getAttribute("role")).toBe("status");
  });
});

describe("snake opening straight-line guidance", () => {
  const opening = "第一颗果子在前方，先沿直线走";

  it.each([
    [0, { x: 7, y: 5 }], [1, { x: 4, y: 8 }],
    [2, { x: 1, y: 5 }], [3, { x: 4, y: 2 }],
  ] as const)("keeps useful opening guidance for a clear path heading %i", (direction, food) => {
    const state = pet(direction, false);
    const snake = state.game!.snake!;
    snake.food = food;
    // Keep the body behind each heading, as in an ordinary straight opening.
    const dx = Math.sign(food.x - 4), dy = Math.sign(food.y - 5);
    snake.body = [0, 1, 2].map(i => ({ x: 4 - dx * i, y: 5 - dy * i }));
    const before = structuredClone(state);
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-navigation-hint")?.textContent).toContain(opening);
    expect(state).toEqual(before);
  });

  it.each([
    { name: "old random fruit off the forward line", direction: 0, food: { x: 9, y: 9 }, turn: 0, step: 0 },
    { name: "a saved first turn", direction: 1, food: { x: 7, y: 5 }, turn: 0, step: 1 },
    { name: "fruit behind the head", direction: 0, food: { x: 1, y: 5 }, turn: 0, step: 2 },
    { name: "a pending left turn", direction: 0, food: { x: 7, y: 5 }, turn: -1, step: 0 },
    { name: "a pending right turn", direction: 0, food: { x: 7, y: 5 }, turn: 1, step: 0 },
  ])("does not invite straight travel with $name", ({ direction, food, turn, step }) => {
    const state = pet(direction, false);
    Object.assign(state.game!.snake!, { food, step });
    const view = render(<SnakeGame pet={state} now={now} active turn={turn} />);
    const hint = view.container.querySelector(".snake-navigation-hint")!;
    expect(hint.textContent).not.toContain(opening);
    expect(hint.textContent).toContain("果子在");
    expect(hint.getAttribute("aria-live")).toBe("off");
  });

  it("withdraws and restores advice as a turn is queued and an authoritative state arrives", () => {
    const state = pet(0, false);
    state.game!.snake!.food = { x: 7, y: 5 };
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const hint = () => view.container.querySelector(".snake-navigation-hint")?.textContent;
    expect(hint()).toContain(opening);
    view.rerender(<SnakeGame pet={state} now={now} active turn={-1} />);
    expect(hint()).not.toContain(opening);
    // Dispatch consumes the queued turn before an accepted snapshot arrives.
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} stepping />);
    expect(hint()).not.toContain(opening);
    const moved = structuredClone(state);
    Object.assign(moved.game!.snake!, { direction: 3, step: 1,
      body: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }] });
    view.rerender(<SnakeGame pet={moved} now={now + 650} active turn={0} />);
    expect(hint()).not.toContain(opening);
    view.rerender(<SnakeGame pet={state} now={now + 1300} active turn={0} />);
    expect(hint()).toContain(opening);
    view.rerender(<SnakeGame pet={state} now={now + 1300} active={false} turn={0} />);
    expect(hint()).toBeUndefined();
  });
});
