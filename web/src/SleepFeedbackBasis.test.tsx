import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareFeedback, feedbackText } from "./CareFeedback";
import { carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { CareFeedback as Feedback, CareRules, GrowthStage, PetState } from "./types";

const resting: Feedback = { kind: "sleep", reason: "resting", points: 0, habitGain: 0 };
const rules: CareRules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 },
  sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
  growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 20, restPointsPerHabit: .2 } };
const pet = (stage: GrowthStage): PetState => ({ schema: 12, revision: 1, species: 2, name: "基准一致", createdAt: 1,
  hatchedAt: 1, lastTick: 1, sleeping: false, careCount: 0, logs: [], needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, growth: emptyGrowth(stage) });
afterEach(cleanup);

describe.each(["baby", "growing", "adult"] as const)("confirmed sleep guidance at %s", stage => {
  it("matches the preview's response-only coefficients and never claims an immediate reward", () => {
    const p = pet(stage), before = structuredClone(p);
    render(<CareFeedback feedback={resting} growth={p.growth!} mood="" rules={rules} />);
    const text = screen.getByRole("status").textContent!;
    expect(text).toContain(carePreview(p, "sleep", rules)[1]);
    expect(text).toContain("每恢复 20 体力"); expect(text).not.toMatch(/28|0\.25/);
    if (stage === "adult") { expect(text).not.toContain("成长 +"); expect(text).toContain("形态不变"); }
    else { expect(text).toContain("成长 +0.2"); expect(text).toContain("按实际恢复比例记录"); }
    expect(p).toEqual(before); expect(resting.points).toBe(0);
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it.each([undefined, null, { ...rules, growth: undefined }, { ...rules, growth: { ...rules.growth!, restEnergyPerHabit: 0 } }])("never guesses coefficients from unavailable/invalid metadata %j", invalid => {
    const text = feedbackText(resting, emptyGrowth(stage), { rules: invalid }).detail;
    expect(text).toContain("成长基准尚未读到"); expect(text).toContain("实际恢复量");
    expect(text).not.toMatch(/28|0\.25|习惯 \+1|成长 \+/);
    if (stage === "adult") expect(text).toContain("形态不变");
  });
});
it("does not use an age-derived fallback when actual growth was omitted", () => {
  render(<CareFeedback feedback={resting} growth={emptyGrowth("adult")} growthRecorded={false} mood="" rules={rules} />);
  const text = screen.getByRole("status").textContent!;
  expect(text).toContain("成长记录尚未读到"); expect(text).not.toMatch(/20|0\.2|28|0\.25|成年|成长 \+/);
});
it("preserves valid zero reward coefficients rather than replacing them with defaults", () => {
  const text = feedbackText(resting, emptyGrowth(), { rules: { ...rules, growth: { ...rules.growth!, restPointsPerHabit: 0 } } }).detail;
  expect(text).toContain("成长 +0；"); expect(text).not.toContain("0.25");
});
it("rerenders accepted coefficient removal without keeping the previous numeric guidance", () => {
  const view = render(<CareFeedback feedback={resting} growth={emptyGrowth()} mood="" rules={rules} />);
  expect(screen.getByRole("status").textContent).toContain("每恢复 20");
  view.rerender(<CareFeedback feedback={resting} growth={emptyGrowth()} mood="" />);
  expect(screen.getByRole("status").textContent).toContain("成长基准尚未读到");
  expect(screen.getByRole("status").textContent).not.toMatch(/20|0\.2|28|0\.25/);
});
it("keeps waking feedback separate from sleep's conditional future recovery explanation", () => {
  const text = feedbackText({ ...resting, reason: "awake" }, emptyGrowth(), { rules });
  expect(text.title).toContain("只按实际恢复"); expect(text.detail).toContain("距成长期");
  expect(text.detail).not.toMatch(/每恢复|28|20|0\.25/);
});
