import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CarePreview } from "./CarePreview";
import { GrowthBasis } from "./GrowthBasis";
import { emptyGrowth } from "./growth";
import type { CareRules, GrowthStage, PetState } from "./types";

const basis = { basePerHour: .4, comfortPerHour: .6, restEnergyPerHabit: 20, restPointsPerHabit: .2 };
const rules: CareRules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 },
  sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12, growth: basis };
function pet(stage: GrowthStage = "baby"): PetState {
  const now = Date.now(), growth = emptyGrowth(stage);
  if (stage === "adult") Object.assign(growth, { points: 72, form: "gentle" });
  return { schema: 12, revision: 1, species: 2, name: "休息基准", createdAt: now - 10000,
    hatchedAt: now - 9000, lastTick: now, sleeping: false,
    needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, growth, careCount: 0, logs: [] };
}
const preview = () => screen.getByLabelText("所选菜单说明").textContent!;
afterEach(cleanup);
describe.each(["baby", "growing", "adult"] as const)("sleep basis for %s", stage => {
  it("uses the same accepted metadata as the handbook, without writing either input", () => {
    const p = pet(stage), original = structuredClone({ p, rules });
    render(<><CarePreview pet={p} kind="sleep" hint="" rules={rules} /><GrowthBasis stage={stage} rules={rules} /></>);
    expect(preview()).toContain("每恢复 20 体力，休息习惯 +1");
    expect(screen.getByLabelText("成长与照顾基准").textContent).toContain("每实际恢复 20 点体力");
    expect(preview()).not.toMatch(/28|0\.25/);
    expect(preview()).toContain(stage === "adult" ? "成年形态不变" : "成长 +0.2");
    if (stage === "adult") expect(preview()).not.toContain("成长 +");
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
    expect({ p, rules }).toEqual(original);
  });
  it.each([undefined, null, {}, { ...basis, restEnergyPerHabit: 0 }, { ...basis, restEnergyPerHabit: 101 },
    { ...basis, restEnergyPerHabit: "20" }, { ...basis, restPointsPerHabit: -1 },
    { ...basis, restPointsPerHabit: Infinity }, { ...basis, basePerHour: NaN }, { ...basis, comfortPerHour: 73 },
  ])("does not substitute hardcoded sleep numbers for missing/invalid basis %#", invalid => {
    render(<CarePreview pet={pet(stage)} kind="sleep" hint="" rules={{ ...rules, growth: invalid } as unknown as CareRules} />);
    expect(preview()).toContain("成长基准尚未读到");
    expect(preview()).not.toMatch(/28|0\.25|习惯 \+1|成长 \+/);
    if (stage === "adult") expect(preview()).toContain("成年形态不变");
  });
  it("keeps full-energy rest possible without promising recovery beyond full", () => {
    const p = pet(stage); p.needs.energy = 100;
    render(<CarePreview pet={p} kind="sleep" hint="" rules={rules} />);
    expect(preview()).toContain("体力不再恢复时，不增加休息习惯");
    expect(preview()).toContain("每恢复 20 体力");
  });
});
it.each([undefined, null])("keeps missing entire rules compatible %#", missing => {
  render(<CarePreview pet={pet()} kind="sleep" hint="" rules={missing} />);
  expect(preview()).toContain("成长基准尚未读到"); expect(preview()).not.toMatch(/28|0\.25/);
});
it("does not invent growth history from metadata alone", () => {
  const p = pet(); delete p.growth;
  render(<CarePreview pet={p} kind="sleep" hint="" rules={rules} />);
  expect(preview()).toContain("成长记录尚未读到"); expect(preview()).not.toMatch(/20 体力|成长 \+/);
});
it("keeps waking free of an immediate or automatic recovery promise", () => {
  const p = pet(); p.sleeping = true;
  render(<CarePreview pet={p} kind="sleep" hint="" rules={rules} />);
  expect(preview()).toContain("按 B 轻轻叫醒");
  expect(preview()).toContain("不因反复睡下或叫醒多记");
  expect(preview()).not.toMatch(/20 体力|28|成长 \+/);
});
it("accepts a valid zero growth coefficient without inventing the normal reward", () => {
  render(<CarePreview pet={pet()} kind="sleep" hint="" rules={{ ...rules, growth: { ...basis, restPointsPerHabit: 0 } }} />);
  expect(preview()).toContain("成长 +0"); expect(preview()).not.toContain("0.25");
});
