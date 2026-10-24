import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import type { CareFeedback, SleepSummary } from "./types";

const start = Date.parse("2026-10-19T01:00:00Z"), end = start + 3600000;
const summary: SleepSummary = { startedAt:start, wokeAt:end, settledHours:1, energyRecovered:14, restGain:.5, growthPoints:1.17 };
const needs = { hunger:77, mood:80, clean:88, energy:54 };
const feedback: CareFeedback = {kind:"sleep",reason:"awake",points:0,habitGain:0,
  effect:{at:end,before:needs,after:needs},sleepSummary:summary};
afterEach(cleanup);
describe("complete recorded sleep receipt", () => {
  it("separates cumulative sleep settlement from the zero immediate wake effect", () => {
    render(<CareOutcome feedback={feedback}/>);
    const group=screen.getByRole("group",{name:"这次睡眠的实际结算"});
    for (const text of ["实际结算：1.00 小时","恢复体力：+14.00","休息习惯：+0.50","睡眠期间成长：+1.17 点","包含期间自然成长","不是起床奖励","单次结算上限"]) expect(group.textContent).toContain(text);
    const times=group.querySelectorAll("time");
    expect([...times].map(t=>t.dateTime)).toEqual([new Date(start).toISOString(),new Date(end).toISOString()]);
    expect(screen.getByRole("group",{name:"本次成长与习惯"}).textContent).toContain("本次没有新增成长点");
    expect(screen.getByRole("group",{name:"本次成长与习惯"}).textContent).toContain("记录数值：成长 +0.00 点 · 休息习惯：+0");
    expect(group.querySelector("button,a,input,[tabindex]")).toBeNull();
  });
  it.each([
    { elapsed: 24, settled: 12, gap: "12.00" },
    { elapsed: 24, settled: 24, gap: null },
    { elapsed: 36, settled: 24, gap: "12.00" },
    { elapsed: 0, settled: 0, gap: null },
    { elapsed: 1, settled: 1 - 1e-10, gap: null },
    { elapsed: 1, settled: 1 - .001, gap: "<0.01" },
  ])("distinguishes recorded elapsed time from settlement without a client clock (%j)", ({ elapsed, settled, gap }) => {
    render(<CareOutcome feedback={{ ...feedback, sleepSummary: {
      startedAt: end - elapsed * 3600000, wokeAt: end, settledHours: settled,
      energyRecovered: 0, restGain: 0, growthPoints: 0,
    } }} />);
    const group = screen.getByRole("group", { name: "这次睡眠的实际结算" });
    expect(group.textContent).toContain(`入睡至起床：${elapsed.toFixed(2)} 小时`);
    expect(group.textContent).toContain(`实际结算：${settled.toFixed(2)} 小时`);
    if (gap === null) expect(group.textContent).not.toContain("未计入结算：");
    else {
      expect(group.textContent).toContain(`未计入结算：${gap} 小时`);
      expect(group.textContent).toContain("这部分不会补算，也不是额外损失的体力或成长");
    }
  });
  it("does not recompute the receipt from current state or replay time", () => {
    const {rerender}=render(<CareOutcome feedback={feedback}/>);
    const before=screen.getByRole("group",{name:"这次睡眠的实际结算"}).innerHTML;
    rerender(<CareOutcome feedback={structuredClone(feedback)}/>);
    expect(screen.getByRole("group",{name:"这次睡眠的实际结算"}).innerHTML).toBe(before);
    rerender(<CareOutcome feedback={null}/>);
    expect(screen.queryByRole("group",{name:"这次睡眠的实际结算"})).toBeNull();
  });
  it.each([
    {energyRecovered:0,restGain:0,growthPoints:0},
    {energyRecovered:0,restGain:0,growthPoints:1},
    {settledHours:0,startedAt:end,energyRecovered:0,restGain:0,growthPoints:0},
    {settledHours:1e-6,energyRecovered:1e-5,restGain:1e-6,growthPoints:1e-6},
    {startedAt:start-23*3600000,settledHours:12},
    {startedAt:start-23*3600000,settledHours:24},
  ])("shows real zero/tiny/full-energy/adult/capped/multi-settlement results (%j)", patch => {
    render(<CareOutcome feedback={{...feedback,sleepSummary:{...summary,...patch}}}/>);
    const group=screen.getByRole("group",{name:"这次睡眠的实际结算"});
    expect(group.textContent).not.toMatch(/NaN|Infinity/);
    if(patch.settledHours===1e-6) expect(group.textContent).toContain("恢复体力：+<0.01");
  });
  it.each([
    {startedAt:NaN},{wokeAt:Infinity},{startedAt:0},{wokeAt:9e15},{startedAt:end+1},{wokeAt:end+1},
    {settledHours:-1},{settledHours:NaN},{settledHours:2},{energyRecovered:-1},{energyRecovered:101},
    {energyRecovered:55},{restGain:Infinity},{restGain:-1},{restGain:1e6+1},{growthPoints:73},{growthPoints:NaN},
    {energyRecovered:0,restGain:.5},{settledHours:0},{restGain:".5"},
  ])("hides malformed optional metadata without losing the valid wake effect (%j)", patch => {
    render(<CareOutcome feedback={{...feedback,sleepSummary:{...summary,...patch} as SleepSummary}}/>);
    expect(screen.queryByRole("group",{name:"这次睡眠的实际结算"})).toBeNull();
    expect(screen.getByRole("region",{name:"上次操作的即时变化"}).textContent).toContain("起床");
  });
  it.each([
    {kind:"feed",reason:"credited",habit:"nutrition",points:.25,habitGain:1},
    {reason:"resting"},{points:.25},{habitGain:1},{habit:"play"},{effect:undefined},{sleepSummary:undefined},{sleepSummary:null},
  ])("does not fabricate sleep for old replies, rejected/incompatible actions (%j)", patch => {
    render(<CareOutcome feedback={{...feedback,...patch} as CareFeedback}/>);
    expect(screen.queryByRole("group",{name:"这次睡眠的实际结算"})).toBeNull();
  });
});

it("uses the diary's half-up precision for a real nine-second sleep recovery", () => {
  // A server calculation of (85 + 14 * 9 / 3600) - 85, not a zero gain.
  const energyRecovered = 0.03499999999999659;
  const f: CareFeedback = { ...feedback, effect: { at: start + 9000, before: needs, after: needs },
    sleepSummary: { startedAt: start, wokeAt: start + 9000, settledHours: 9 / 3600,
      energyRecovered, restGain: energyRecovered / 28, growthPoints: .003 } };
  const before = structuredClone(f);
  render(<CareOutcome feedback={f} />);
  expect(screen.getByRole("group", { name: "这次睡眠的实际结算" }).textContent).toContain("恢复体力：+0.04");
  expect(f).toEqual(before);
});
