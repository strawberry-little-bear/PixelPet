import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SleepProgress } from "./SleepProgress";
import { CarePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState } from "./types";

const at = Date.parse("2026-10-20T08:00:00+08:00");
function pet(stage: GrowthStage = "baby"): PetState {
  const growth = emptyGrowth(stage); growth.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 3;
  growth.trackedHours = 2; growth.care.rest = .5;
  return { schema: 17, revision: 1, species: 2, name: "安睡伙伴", createdAt: at - 3 * 3600000, hatchedAt: at - 3 * 3600000,
    lastTick: at, sleeping: true, needs: { hunger: 70, mood: 80, clean: 70, energy: 54 }, careCount: 0, logs: [], growth,
    sleepSession: { startedAt: at - 3600000, settledHours: 1, energyRecovered: 14, restGain: .5, growthPoints: 1.17 } };
}
const text = () => screen.getByRole("group", { name: "本段休息的已保存进度" }).textContent!;
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(["baby", "growing", "adult"] as const)("shows the %s authoritative snapshot, not a wake receipt or reward", stage => {
  const p = pet(stage); if (stage === "adult") p.sleepSession!.growthPoints = 0;
  const before = structuredClone(p); render(<SleepProgress pet={p} />);
  for (const s of ["实际结算：1.00 小时", "恢复体力：+14.00", "休息习惯：+0.50", "不是叫醒奖励", "成年形态不重选", "查看不会叫醒"])
    expect(text()).toContain(s);
  expect(text()).toContain(`睡眠期间成长：+${stage === "adult" ? "0.00" : "1.17"} 点`);
  expect([...document.querySelectorAll("time")].map(t => t.dateTime)).toEqual([
    new Date(p.sleepSession!.startedAt).toISOString(), new Date(p.lastTick).toISOString(),
  ]);
  expect(document.querySelector(".sleep-summary,button,a,input")).toBeNull(); expect(p).toEqual(before);
});
it("does not recap an entire sleep accumulated across multiple reads", () => {
  const p = pet("adult"); p.hatchedAt = p.createdAt = at - 50 * 3600000;
  p.sleepSession!.startedAt = at - 48 * 3600000; p.sleepSession!.settledHours = 24; p.growth!.trackedHours = 48;
  render(<SleepProgress pet={p} />);
  expect(text()).toContain("实际结算：24.00 小时"); expect(text()).toContain("未计入结算：24.00 小时");
  expect(text()).toContain("不会补算");
});
it("full energy need not add rest, while saved natural growth remains visible", () => {
  const p = pet(); p.needs.energy = 100; Object.assign(p.sleepSession!, { energyRecovered: 0, restGain: 0, growthPoints: .8 });
  render(<SleepProgress pet={p} />); expect(text()).toContain("休息习惯：+0.00"); expect(text()).toContain("睡眠期间成长：+0.80 点");
});
it("does not display positive fractions as zero", () => {
  const p = pet(); Object.assign(p.sleepSession!, { settledHours: .001, energyRecovered: .001, restGain: .0001, growthPoints: .0001 });
  render(<SleepProgress pet={p} />);
  for (const s of ["实际结算：<0.01 小时", "恢复体力：+<0.01", "休息习惯：+<0.01", "睡眠期间成长：+<0.01 点"]) expect(text()).toContain(s);
});
it("never advances totals or the saved endpoint from the local clock", () => {
  vi.useFakeTimers(); vi.setSystemTime(at); const p = pet(), { rerender } = render(<SleepProgress pet={p} />);
  const original = text(); vi.setSystemTime(at + 7 * 86400000); rerender(<SleepProgress pet={p} />); expect(text()).toBe(original);
});
it("does not hide the legacy sleep explanation or disable care when optional history is malformed", () => {
  const p = pet(); p.sleepSession!.settledHours = NaN;
  render(<CarePreview pet={p} kind="sleep" hint="" />);
  expect(screen.queryByRole("group", { name: "本段休息的已保存进度" })).toBeNull();
  expect(screen.getByRole("note", { name: "所选菜单说明" }).textContent).toContain("按 B 轻轻叫醒");
});
const invalid: [string, (p: PetState) => void][] = [
  ["no session", p => { p.sleepSession = undefined; }], ["awake", p => { p.sleeping = false; }],
  ["egg", p => { p.hatchedAt = 0; }], ["old schema", p => { p.schema = 16; }],
  ["bad schema", p => { p.schema = NaN; }], ["no growth", p => { p.growth = undefined; }],
  ["egg growth", p => { p.growth!.stage = "egg"; }],
  ["game", p => { p.game = { startedAt: at, round: 0, score: 0, lastBeat: at }; }],
  ["before hatch", p => { p.sleepSession!.startedAt = p.hatchedAt - 1; }],
  ["after last tick", p => { p.sleepSession!.startedAt = at + 1; }],
  ["unsettled time", p => { p.sleepSession!.settledHours = 2; }],
  ["untracked time", p => { p.growth!.trackedHours = .5; }],
  ["energy above snapshot", p => { p.sleepSession!.energyRecovered = 55; }],
  ["energy above maximum", p => { p.needs.energy = 101; }],
  ["rest above total", p => { p.sleepSession!.restGain = .6; }],
  ["growth above total", p => { p.sleepSession!.growthPoints = 4; }],
  ["zero interval gains", p => { p.sleepSession!.settledHours = 0; }],
  ["rest without recovery", p => { p.sleepSession!.energyRecovered = 0; }],
];
for (const field of ["settledHours", "energyRecovered", "restGain", "growthPoints"] as const)
  for (const value of [-1, NaN, Infinity, "1"])
    invalid.push([`${field}=${value}`, p => { Object.assign(p.sleepSession!, { [field]: value }); }]);
for (const field of ["startedAt", "lastTick"] as const)
  for (const value of [0, NaN, Infinity, 8.64e15 + 1, .5])
    invalid.push([`${field}=${value}`, p => { if (field === "startedAt") p.sleepSession!.startedAt = value; else p.lastTick = value; }]);
it.each(invalid)("quietly omits invalid optional progress: %s", (_name, mutate) => {
  const p = pet(); mutate(p); render(<SleepProgress pet={p} />); expect(document.querySelector(".sleep-progress")).toBeNull();
});
