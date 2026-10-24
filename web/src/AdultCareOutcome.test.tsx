import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import type { CareFeedback } from "./types";

const at = Date.UTC(2026, 9, 24, 3);
const needs = { hunger: 60, mood: 60, clean: 60, energy: 60 };
const receipt = (kind: CareFeedback["kind"]): CareFeedback => ({
  kind, reason: "credited", habit: kind === "feed" ? "nutrition" : kind === "clean" ? "clean" : "play",
  habitGain: 1, points: 0, effect: { at, before: needs, after: { ...needs, mood: 70 } },
});
const explanation = "已经成年，成长点不再增加；本次习惯仍已计入，可以继续温柔陪伴。";
afterEach(cleanup);
it.each(["feed", "clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"] as const)("explains adult zero growth independently of credited habits: %s", kind => {
  const feedback = { ...receipt(kind), growthComplete: true };
  const before = structuredClone(feedback);
  const { container } = render(<CareOutcome feedback={feedback} embedded={kind.endsWith("finish")} />);
  expect(container.textContent).toContain(explanation);
  expect(container.textContent).toContain("本次成长：+0.00 点");
  expect(container.textContent).toMatch(/习惯：\+1/);
  expect(container.querySelector("button,a,input")).toBeNull();
  expect(feedback).toEqual(before);
});
it.each([
  ["old receipt", {}],
  ["false", { growthComplete: false }],
  ["string", { growthComplete: "true" }],
  ["positive growth", { growthComplete: true, points: .25 }],
  ["cooldown", { growthComplete: true, reason: "cooldown", habitGain: 0 }],
  ["not needed", { growthComplete: true, reason: "not-needed", habitGain: 0 }],
  ["sleep", { growthComplete: true, kind: "sleep", habit: undefined, habitGain: 0, reason: "awake" }],
  ["contradictory milestone", { growthComplete: true, milestone: { stage: "adult", at, form: "gentle" } }],
] as const)("does not infer adult growth from unsupported metadata: %s", (_, extra) => {
  const { container } = render(<CareOutcome feedback={{ ...receipt("feed"), ...extra } as CareFeedback} />);
  expect(container.textContent).not.toContain(explanation);
  expect(container.querySelector(".care-outcome")).not.toBeNull();
});
it("keeps the acknowledged explanation stable across unrelated renders", () => {
  const feedback = { ...receipt("feed"), growthComplete: true };
  const { rerender, container } = render(<CareOutcome feedback={feedback} />);
  const text = container.textContent;
  rerender(<CareOutcome feedback={structuredClone(feedback)} />);
  expect(container.textContent).toBe(text);
  expect(text).toContain(explanation);
});
