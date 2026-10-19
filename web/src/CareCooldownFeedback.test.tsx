import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CareFeedback } from "./CareFeedback";
import { emptyGrowth } from "./growth";
import type { CareFeedback as Feedback } from "./types";

const at = 1792400000000;
const before = { hunger: 60, mood: 70, clean: 60, energy: 80 };
const feedback = (kind: Feedback["kind"], retryAt?: number): Feedback => ({ kind, habit: kind === "feed" ? "nutrition" : kind === "clean" ? "clean" : "play", points: 0, habitGain: 0, reason: "cooldown", retryAt,
  effect: { at, before, after: { ...before, mood: 74 } } });
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const kind of ["feed", "clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"] as const) {
  it(`${kind} keeps a historical explanation across clock jumps and stale retry timestamps`, () => {
    vi.useFakeTimers(); vi.setSystemTime(at);
    const f = feedback(kind, at + 60000), saved = structuredClone(f);
    const view = render(<CareFeedback feedback={f} growth={emptyGrowth()} mood="" />);
    const initial = screen.getByRole("status").textContent!;
    expect(initial).toContain("记录时同类习惯仍在间隔内"); expect(initial).toContain("下次以实际结果为准");
    expect(initial).not.toMatch(/还需.*分钟|已结束|成长 \+|习惯 \+1/);
    for (const now of [at - 86400000, at + 60000, at + 86400000]) {
      vi.setSystemTime(now); view.rerender(<CareFeedback feedback={f} growth={emptyGrowth()} mood="" />);
      expect(screen.getByRole("status").textContent).toBe(initial);
    }
    expect(f).toEqual(saved); expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
}
it.each([undefined, 0, at - 60000])("legacy retryAt %s does not turn a confirmed cooldown into readiness", retryAt => {
  render(<CareFeedback feedback={feedback("feed", retryAt)} growth={emptyGrowth("adult")} mood="" />);
  const text = screen.getByRole("status").textContent!;
  expect(text).toContain("记录时同类习惯仍在间隔内"); expect(text).not.toMatch(/已结束|成长 \+|还需.*分钟/);
});
