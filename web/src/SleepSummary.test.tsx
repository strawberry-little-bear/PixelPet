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
    expect(screen.getByRole("group",{name:"本次成长与习惯"}).textContent).toContain("本次成长：+0.00");
    expect(group.querySelector("button,a,input,[tabindex]")).toBeNull();
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
