import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import type { CareFeedback } from "./types";

const at = Date.parse("2026-10-19T01:20:00Z");
const feedback: CareFeedback = { kind: "feed", points: .25, habitGain: 1, habit: "nutrition", reason: "credited",
 effect: { at, before: {hunger: 60, mood: 99, clean: 1, energy: 80}, after: {hunger: 80, mood: 100, clean: 0, energy: 80} } };
afterEach(cleanup);

describe("authoritative care outcome", () => {
 it("shows only saved readings with real changes, not the nominal bonus", () => {
  render(<CareOutcome feedback={feedback} />);
  const panel = screen.getByRole("region", {name:"上次操作的即时变化"});
  expect(panel.textContent).toContain("喂食");
  expect(panel.querySelector(".care-outcome-summary")?.textContent).toBe("饭团已吃好。");
  const row = (key: string) => panel.querySelector(`[data-need="${key}"]`)!;
  expect(row("hunger").textContent).toContain("60.00 → 80.00+20.00");
  expect(row("mood").textContent).toContain("99.00 → 100.00+1.00");
  expect(row("clean").textContent).toContain("1.00 → 0.00−1.00");
  expect(panel.querySelector('[data-need="energy"]')).toBeNull();
  expect(panel.querySelector("time")?.dateTime).toBe(new Date(at).toISOString());
  expect(panel.textContent).toContain("不含此前时间结算");
  expect(panel.textContent).toContain("不是当前读数");
  expect(panel.querySelector('[aria-label="即时状态变化"]')).toBeTruthy();
  expect(panel.querySelector("button,a,input,[tabindex]")).toBeNull();
  expect(within(panel).queryByRole("status")).toBeNull();
 });
 it("explains when the acknowledged action changes no immediate need", () => {
  render(<CareOutcome feedback={{...feedback, effect:{...feedback.effect!, after: feedback.effect!.before}}} />);
  const panel = screen.getByRole("region", {name:"上次操作的即时变化"});
  expect(panel.querySelector('[aria-label="即时状态变化"]')?.textContent).toContain("这次没有新的状态变化。");
  expect(panel.querySelectorAll("[data-need]")).toHaveLength(0);
 });
 it.each(["credited", "not-needed", "cooldown"] as const)("need effects remain independent of %s habit eligibility", reason => {
  render(<CareOutcome feedback={{...feedback, reason}} />);
  expect(screen.getByRole("region").textContent).toContain("+20.00");
 });
 it.each(["resting", "awake"] as const)("%s does not present passive recovery as a sleep toggle effect", reason => {
  render(<CareOutcome feedback={{...feedback, kind:"sleep", reason, points:0, habitGain:0,
   effect: {...feedback.effect!, after: feedback.effect!.before}}} />);
  expect(screen.getByRole("region").textContent).toContain(reason === "resting" ? "入睡" : "起床");
  expect(screen.getByRole("region").textContent).toContain("入睡和起床不立即恢复体力");
  expect(screen.getByRole("region").textContent).not.toContain("+20.00");
 });
 it("labels completed games as companionship without inventing extra rewards", () => {
  render(<CareOutcome feedback={{...feedback, kind:"fish-finish"}} />);
  expect(screen.getByRole("region").textContent).toContain("陪玩");
  expect(screen.getByRole("region").textContent).not.toContain("金币");
 });
 it("does not round a small real change to an unchanged or signed zero", () => {
  render(<CareOutcome feedback={{...feedback, effect:{at, before:{hunger:60,mood:99.999,clean:.001,energy:80},after:{hunger:80,mood:100,clean:0,energy:80}}}} />);
  expect(screen.getByRole("region").textContent).toContain("+<0.01");
  expect(screen.getByRole("region").textContent).toContain("−<0.01");
 });
 it("does not fabricate a receipt from older responses or idle pet growth", () => {
  const {rerender} = render(<CareOutcome feedback={null} />);
  expect(screen.queryByRole("region")).toBeNull();
  rerender(<CareOutcome feedback={{...feedback, effect:undefined}} />);
  expect(screen.queryByRole("region")).toBeNull();
 });
 it.each([
  {at:NaN}, {at:Infinity}, {at:9e15}, {at:0}, {before:null}, {after:{}},
  {before:{...feedback.effect!.before, mood:NaN}},
  {after:{...feedback.effect!.after, hunger:101}},
  {after:{...feedback.effect!.after, clean:-1}},
  {after:{...feedback.effect!.after, energy:"80"}},
 ])("ignores invalid optional effect metadata (%j) without crashing or inventing numbers", bad => {
  render(<CareOutcome feedback={{...feedback, effect:{...feedback.effect!,...bad} as CareFeedback["effect"]}} />);
  expect(screen.queryByRole("region")).toBeNull();
 });
});

it("keeps a capped care growth receipt at the same precision as its diary entry", () => {
  const needs = { hunger: 60.035, mood: 80, clean: 90, energy: 85 };
  const feedback: CareFeedback = { kind: "feed", reason: "credited", habit: "nutrition", habitGain: 1,
    points: 0.03499999999999659,
    effect: { at: Date.parse("2026-10-20T00:00:00Z"), before: needs, after: { ...needs, hunger: 80.035 } } };
  const before = structuredClone(feedback);
  render(<CareOutcome feedback={feedback} />);
  expect(screen.getByRole("group", { name: "本次成长与习惯" }).textContent).toContain("本次成长：+0.04 点");
  expect(document.querySelector('[data-need="hunger"]')?.textContent).toContain("60.04 → 80.04");
  expect(feedback).toEqual(before);
});
