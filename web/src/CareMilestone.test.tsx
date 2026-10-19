import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import type { CareFeedback } from "./types";

afterEach(cleanup);
const at = 1792440000000;
const base = (): CareFeedback => ({kind: "feed", habit: "nutrition", reason: "credited", points: .25, habitGain: 1,
  effect: { at, before: { hunger: 60, mood: 70, clean: 60, energy: 80 }, after: { hunger: 80, mood: 73, clean: 57, energy: 80 } } });
const kinds = ["feed", "clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"] as const;
function receipt(kind: typeof kinds[number], milestone: CareFeedback["milestone"]): CareFeedback {
  return {...base(), kind, habit: kind === "feed" ? "nutrition" : kind === "clean" ? "clean" : "play", milestone};
}

describe("acknowledged care stage milestone", () => {
  it.each(kinds)("%s shows only the supplied growing receipt without new controls", kind => {
    const f = receipt(kind, {stage: "growing", at}), saved = structuredClone(f);
    render(<CareOutcome feedback={f} />);
    expect(screen.getByLabelText("本次照顾的成长阶段").textContent).toContain("这次照顾推动进入成长期");
    expect(screen.getByLabelText("本次照顾的成长阶段").textContent).toContain("不含操作前的自然成长");
    expect(f).toEqual(saved);
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it.each(["balanced", "lively", "gentle", "easygoing"] as const)("keeps the frozen %s adult form with a capped positive gain", form => {
    const f = receipt("clean", {stage: "adult", at, form}); f.points = .000001;
    const view = render(<CareOutcome feedback={f} />);
    const initial = screen.getByLabelText("本次照顾的成长阶段").textContent;
    expect(initial).toMatch(/进入成年期.*已定型/);
    expect(document.querySelector(".care-learning")?.textContent).toContain("+<0.01");
    view.rerender(<CareOutcome feedback={structuredClone(f)} />);
    expect(screen.getByLabelText("本次照顾的成长阶段").textContent).toBe(initial);
  });
  it("old receipts remain valid and never infer a crossing from the .25 gain", () => {
    render(<CareOutcome feedback={base()} />);
    expect(screen.queryByLabelText("本次照顾的成长阶段")).toBeNull();
    expect(screen.getByLabelText("本次成长与习惯").textContent).toContain("+0.25");
  });
  it.each([
    { stage: "egg", at }, { stage: "baby", at }, { stage: "adult", at },
    { stage: "adult", at, form: "unknown" }, { stage: "adult", at, form: "__proto__" },
    { stage: "growing", at, form: "gentle" }, { stage: "growing", at: at - 1 },
    { stage: "growing", at, form: null }, { stage: "growing", at, form: false }, { stage: "growing", at, form: 0 },
    { stage: "growing", at: String(at) }, { stage: "growing", at: NaN },
  ])("ignores malformed optional milestone %j without losing the care result", milestone => {
    const f = {...base(), milestone} as unknown as CareFeedback;
    render(<CareOutcome feedback={f} />);
    expect(screen.queryByLabelText("本次照顾的成长阶段")).toBeNull();
    expect(screen.getByLabelText("本次成长与习惯").textContent).toContain("喂食习惯：+1");
  });
  it.each(["cooldown", "not-needed", "resting", "awake"] as const)("does not show a crossing on %s", reason => {
    const f = receipt("feed", {stage: "growing", at}); f.reason = reason; f.points = 0; f.habitGain = 0;
    if (reason === "resting" || reason === "awake") { f.kind = "sleep"; delete f.habit; }
    render(<CareOutcome feedback={f} />);
    expect(screen.queryByLabelText("本次照顾的成长阶段")).toBeNull();
  });
  it("does not infer a new adult stage from continued adult habit credits", () => {
    const f = receipt("feed", {stage: "adult", at, form: "gentle"}); f.points = 0;
    render(<CareOutcome feedback={f} />);
    expect(screen.queryByLabelText("本次照顾的成长阶段")).toBeNull();
    expect(screen.getByLabelText("本次成长与习惯").textContent).toContain("喂食习惯：+1");
  });
});
