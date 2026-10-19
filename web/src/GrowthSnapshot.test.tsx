import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth } from "./growth";
import type { CareRules, GrowthStage, PetState } from "./types";

const rules: CareRules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
  growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 } };
function pet(stage: GrowthStage = "baby"): PetState {
  return { schema: 12, revision: 1, species: 2, name: "舒适度", createdAt: 1000, hatchedAt: stage === "egg" ? 0 : 1000, lastTick: 1000,
    sleeping: false, careCount: 0, needs: { hunger: 20, mood: 40, clean: 60, energy: 80 }, logs: [], growth: emptyGrowth(stage) };
}
function panel(p: PetState, metadata: CareRules | null = rules, page = 0) {
  return <GrowthPanel pet={p} growth={p.growth ?? emptyGrowth()} rules={metadata} index={2} page={page} />;
}
const reading = () => screen.getByLabelText("此刻状态与成长").textContent!;
afterEach(cleanup);
it.each(["baby", "growing"] as const)("connects %s current needs to the natural basis, not historical comfort", stage => {
  const p = pet(stage); p.growth!.trackedHours = 10; p.growth!.wellbeing = 1;
  const before = structuredClone(p), metadata = structuredClone(rules);
  render(panel(p)); expect(reading()).toContain("50.0%"); expect(reading()).toContain("0.88 点/小时");
  expect(reading()).toContain("不是历史平均"); expect(reading()).toContain("不是下一小时的预测");
  expect(reading()).toContain("不含睡眠额外成长或照顾奖励");
  expect(p).toEqual(before); expect(rules).toEqual(metadata);
});
it.each([0, 100])("uses raw bounds at %s and updates on rerender", value => {
  const p = pet(); for (const key of ["hunger", "mood", "clean", "energy"] as const) p.needs[key] = value;
  const { rerender } = render(panel(p)); expect(reading()).toContain(`${value.toFixed(1)}%`);
  expect(reading()).toContain(`${value ? "1.25" : "0.50"} 点/小时`);
  rerender(panel({ ...p, needs: { hunger: 100, mood: 0, clean: 0, energy: 0 } }));
  expect(reading()).toContain("25.0%"); expect(reading()).toContain("0.69 点/小时");
});
it("takes numeric coefficients from response metadata, including valid zero", () => {
  const p = pet(); const { rerender } = render(panel(p, { ...rules, growth: { ...rules.growth!, basePerHour: .2, comfortPerHour: .4 } }));
  expect(reading()).toContain("0.40 点/小时");
  rerender(panel(p, { ...rules, growth: { ...rules.growth!, basePerHour: 0, comfortPerHour: 0 } }));
  expect(reading()).toContain("0.00 点/小时");
});
it("calculates from unrounded needs and distinguishes small values from zero", () => {
  const p = pet(); p.needs = { hunger: .0001, mood: 0, clean: 0, energy: 0 };
  render(panel(p, { ...rules, growth: { ...rules.growth!, basePerHour: 0, comfortPerHour: .75 } }));
  expect(reading()).toContain("<0.1%"); expect(reading()).toContain("<0.01 点/小时");
  expect(reading()).not.toContain("0.00 点/小时");
});
it.each([null, { ...rules, growth: undefined }, { ...rules, growth: { ...rules.growth!, comfortPerHour: -1 } }])("keeps current needs but does not invent a missing/invalid basis %#", metadata => {
  render(panel(pet(), metadata)); expect(reading()).toContain("50.0%");
  expect(reading()).toContain("成长基准尚未读到"); expect(reading()).not.toContain("点/小时");
});
it("does not claim adult growth or reselect its fixed form", () => {
  const p = pet("adult"); p.growth!.points = 72; p.growth!.form = "gentle";
  render(panel(p)); expect(reading()).toContain("50.0%"); expect(reading()).toContain("成年不再增加成长点");
  expect(reading()).not.toContain("点/小时"); expect(p.growth!.form).toBe("gentle");
});
it("does not infer growth from legacy age", () => {
  const p = pet(); delete p.growth; render(panel(p));
  expect(reading()).toContain("50.0%"); expect(reading()).toContain("成长记录尚未读到"); expect(reading()).not.toContain("点/小时");
});
it("does not show snapshot numbers before hatching or on other pages", () => {
  const { rerender } = render(panel(pet("egg"))); expect(screen.queryByLabelText("此刻状态与成长")).toBeNull();
  rerender(panel(pet(), rules, 4)); expect(screen.queryByLabelText("此刻状态与成长")).toBeNull();
});
it("adds no gameplay controls and does not infer extra natural growth from sleeping", () => {
  const p = pet(); const { rerender, container } = render(panel(p)); const awake = reading();
  rerender(panel({ ...p, sleeping: true })); expect(reading()).toBe(awake);
  expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
});
it("never substitutes the rounded comfort label when calculating the reference", () => {
  const p = pet(); p.needs = { hunger: 49.999, mood: 49.999, clean: 49.999, energy: 49.999 };
  render(panel(p)); expect(reading()).toContain("50.0%"); expect(reading()).toContain("0.87 点/小时");
});
