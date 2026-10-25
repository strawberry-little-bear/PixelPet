import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SnakeGame } from "./SnakeGame";
import type { PetState } from "./types";

const now = 1_700_000_000_000;
const warning = "下一步会碰到蛇身，留意转向，C 可暂停看清。";
function fixture(rotation = 0, turn = 0, tail = false): PetState {
  const rotate = (p: { x: number; y: number }) => {
    let { x, y } = p;
    for (let i = 0; i < rotation; i++) [x, y] = [10 - y, x];
    return { x, y };
  };
  // An actual contiguous coil. In the small square, the target is the tail;
  // in the longer coil it is the penultimate cell, which stays occupied.
  const body = (tail
    ? [{ x: 4, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }]
    : [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 },
      { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }]).map(rotate);
  return {
    schema: 6, revision: 1, species: 2, name: "绕弯伙伴", createdAt: now,
    hatchedAt: now, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
    game: { id: "0123456789abcdef0123456789abcdef", kind: "snake", startedAt: now,
      round: 0, score: 0, lastBeat: -1,
      snake: { direction: (rotation - turn + 4) % 4, paused: false, body,
        food: { x: 9, y: 9 }, eaten: body.length - 3, step: 20, lastMoveAt: now } },
  };
}
afterEach(cleanup);

describe("snake next-body warning", () => {
  for (const rotation of [0, 1, 2, 3]) {
    it.each([-1, 0, 1])(`marks the occupied next cell at heading ${rotation} with queued turn %i`, turn => {
      const state = fixture(rotation, turn), before = structuredClone(state);
      const view = render(<SnakeGame pet={state} now={now} active turn={turn} />);
      const target = state.game!.snake!.body.at(-2)!;
      expect(view.container.querySelector(".snake-body-warning")?.getAttribute("d"))
        .toBe(`M${target.x * 12 + 3} ${target.y * 12 + 3}l6 6m0 -6l-6 6`);
      expect(view.container.querySelector(".snake-navigation-hint")?.textContent).toBe(warning);
      expect(view.container.querySelector(".snake-navigation-hint")?.getAttribute("aria-live")).toBe("off");
      expect(view.container.querySelector(".snake-boundary-announcement")?.textContent).toBe(warning);
      expect(view.container.querySelector("button,a,input,[role=button]")).toBeNull();
      expect(state).toEqual(before);
    });

    it(`does not mark a vacating tail at heading ${rotation}`, () => {
      const state = fixture(rotation, 0, true);
      const before = structuredClone(state);
      const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
      expect(view.container.querySelector(".snake-body-warning")).toBeNull();
      expect(view.container.querySelector(".snake-navigation-hint")?.textContent).toContain("果子在");
      expect(view.container.querySelector(".snake-boundary-announcement")?.textContent).toBe("");
      expect(state).toEqual(before);
    });
  }

  it("withdraws a warning when a right turn avoids the body, then restores it for the saved heading", () => {
    const state = fixture();
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    view.rerender(<SnakeGame pet={state} now={now} active turn={1} />);
    expect(view.container.querySelector(".snake-body-warning")).toBeNull();
    expect(view.container.querySelector(".snake-boundary-announcement")?.textContent).toBe("");
    view.rerender(<SnakeGame pet={state} now={now} active turn={0} />);
    expect(view.container.querySelector(".snake-boundary-announcement")?.textContent).toBe(warning);
  });

  it("keeps a single concise announcement across ordinary state syncs", () => {
    const state = fixture();
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const live = view.container.querySelector(".snake-boundary-announcement")!;
    const text = live.firstChild;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    const synced = structuredClone(state); synced.revision++;
    view.rerender(<SnakeGame pet={synced} now={now + 100} active turn={0} />);
    expect(live.firstChild).toBe(text);
    expect(live.textContent).toBe(warning);
  });

  it.each(["local-pause", "server-pause", "in-flight", "won", "wall", "body", "limit"])("hides stale advice at %s", mode => {
    const state = fixture();
    const view = render(<SnakeGame pet={state} now={now} active turn={0} />);
    const changed = structuredClone(state);
    if (mode === "server-pause") changed.game!.snake!.paused = true;
    if (["won", "wall", "body", "limit"].includes(mode)) changed.game!.snake!.end = mode as "won" | "wall" | "body" | "limit";
    view.rerender(<SnakeGame pet={changed} now={now + 100} active={mode !== "local-pause"} turn={0} stepping={mode === "in-flight"} />);
    expect(view.container.querySelector(".snake-body-warning")).toBeNull();
    expect(view.container.querySelector(".snake-body-warning-outline")).toBeNull();
    expect(view.container.querySelector(".snake-boundary-announcement")?.textContent).toBe("");
    expect(view.container.querySelector(".snake-navigation-hint")?.textContent ?? "").not.toContain("碰到蛇身");
  });
});
