import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import type { CareFeedback } from "./types";

const feedback: CareFeedback = { kind: "feed", points: .25, habit: "nutrition", habitGain: 1, reason: "credited",
  effect: { at: Date.parse("2026-10-19T01:20:00Z"), before: { hunger: 60, mood: 80, clean: 60, energy: 30 },
    after: { hunger: 80, mood: 83, clean: 57, energy: 30 } } };
const learning = () => screen.queryByLabelText("本次成长与习惯");
afterEach(cleanup);

describe("saved care learning receipt", () => {
  it("keeps actual growth and habit gains alongside the need receipt", () => {
    render(<CareOutcome feedback={feedback} />);
    expect(learning()?.textContent).toContain("本次成长：+0.25 点");
    expect(learning()?.textContent).toContain("喂食习惯：+1");
    expect(learning()?.textContent).toContain("已计入");
  });
  it.each([0, .1, .004])("shows a capped or small actual gain %s rather than a nominal .25", points => {
    render(<CareOutcome feedback={{ ...feedback, points }} />);
    expect(learning()?.textContent).toContain(points === 0 ? "本次成长：+0.00 点" : points === .1 ? "+0.10 点" : "+<0.01 点");
    expect(learning()?.textContent).toContain("喂食习惯：+1");
    expect(learning()?.textContent).not.toContain("未照顾");
  });
  it.each(["clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"] as const)("uses the saved habit for %s without inventing coins", kind => {
    render(<CareOutcome feedback={{ ...feedback, kind, habit: kind === "clean" ? "clean" : "play" }} />);
    expect(learning()?.textContent).toContain(kind === "clean" ? "清洁习惯：+1" : "陪玩习惯：+1");
    expect(learning()?.textContent).not.toContain("金币");
  });
  it.each([0, .1, .004])("shows treasure's actual capped or small credit %s", points => {
    render(<CareOutcome feedback={{ ...feedback, kind: "treasure-finish", habit: "play", points }} />);
    expect(learning()?.textContent).toContain(points === 0 ? "本次成长：+0.00 点" : points === .1 ? "+0.10 点" : "+<0.01 点");
    expect(learning()?.textContent).toContain("陪玩习惯：+1");
  });
  it.each(["catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"] as const)("keeps %s cooldown separate from immediate need changes", kind => {
    render(<CareOutcome feedback={{ ...feedback, kind, habit: "play", points: 0, habitGain: 0, reason: "cooldown", retryAt: 1 }} />);
    expect(learning()?.textContent).toContain("本次成长：+0.00 点");
    expect(learning()?.textContent).toContain("陪玩习惯：+0");
    expect(learning()?.textContent).toContain("记录时同类习惯仍在间隔内");
    expect(screen.getByRole("region").textContent).toContain("+20.00");
  });
  it.each([
    { habit: "nutrition" }, { habit: "clean" }, { reason: "not-needed" },
    { kind: "treasure-dig" }, { kind: "treasure-resume" }, { kind: "play-treasure" },
    { points: .25, habitGain: 0, reason: "cooldown" },
  ])("does not invent treasure learning from inconsistent metadata %j", bad => {
    render(<CareOutcome feedback={{ ...feedback, kind: "treasure-finish", habit: "play", ...bad } as CareFeedback} />);
    expect(learning()).toBeNull();
    expect(screen.getByRole("region").textContent).toContain("+20.00");
  });
  it.each(["feed", "clean"] as const)("explains %s not-needed independently of changed needs", kind => {
    render(<CareOutcome feedback={{ ...feedback, kind, habit: kind === "feed" ? "nutrition" : "clean", points: 0, habitGain: 0, reason: "not-needed" }} />);
    expect(learning()?.textContent).toContain("本次成长：+0.00 点");
    expect(learning()?.textContent).toContain(kind === "feed" ? "记录时饱食已满足" : "记录时清洁已满足");
    expect(screen.getByRole("region").textContent).toContain("+20.00");
  });
  it("describes the saved cooldown without a stale countdown or promise of future credit", () => {
    render(<CareOutcome feedback={{ ...feedback, points: 0, habitGain: 0, reason: "cooldown", retryAt: 1 }} />);
    expect(learning()?.textContent).toContain("记录时同类习惯仍在间隔内");
    expect(learning()?.textContent).not.toContain("分钟");
    expect(learning()?.textContent).not.toContain("间隔已结束");
  });
  it.each(["resting", "awake"] as const)("%s does not credit the sleep toggle with passive rest", reason => {
    render(<CareOutcome feedback={{ ...feedback, kind: "sleep", habit: undefined, points: 0, habitGain: 0, reason }} />);
    expect(learning()?.textContent).toContain("本次成长：+0.00 点");
    expect(learning()?.textContent).toContain("本次切换不计休息习惯");
    expect(learning()?.textContent).not.toContain("+0.25");
  });
  it.each([
    { points: NaN }, { points: Infinity }, { points: -1 }, { points: 73 }, { points: "0.25" }, { points: undefined },
    { habitGain: NaN }, { habitGain: -1 }, { habitGain: 2 }, { habitGain: "1" }, { habit: "rest" },
    { reason: "other" }, { reason: "not-needed" }, { reason: "cooldown" }, { kind: "fish-step" },
  ])("omits malformed or inconsistent learning metadata %j but preserves confirmed need changes", bad => {
    render(<CareOutcome feedback={{ ...feedback, ...bad } as CareFeedback} />);
    expect(learning()).toBeNull();
    expect(screen.getByRole("region").textContent).toContain("+20.00");
  });
  it("does not reconstruct growth credit from an old response without effect metadata", () => {
    render(<CareOutcome feedback={{ ...feedback, effect: undefined }} />);
    expect(learning()).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });
});
