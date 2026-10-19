import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { CareFeedback, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string, actionFeedback: CareFeedback | undefined;
const at = Date.parse("2026-10-19T01:20:00Z");
const effect = {at, before:{hunger:60,mood:80,clean:60,energy:30},after:{hunger:80,mood:83,clean:57,energy:30}};
const receipt: CareFeedback = {kind:"feed",points:.25,habit:"nutrition",habitGain:1,reason:"credited",effect};
const result = (): Result => ({state:structuredClone(saved),message:"",serverTime:Date.now(),saveGeneration:generation});
const outcome = () => screen.queryByRole("region", {name:"上次操作的即时变化"});
const writes = () => api.mock.calls.filter(([p]) => ["action","import","reset","recap/read"].includes(p));
async function key(key:string) { await act(async () => {fireEvent.keyDown(window,{key});}); }
async function mount() { await act(async () => {render(<App/>);}); }
async function poll() { await act(async () => {vi.advanceTimersByTime(15000);}); }
async function menu(index:number) { await key("a");for(let i=0;i<index;i++)await key("a");await key("b"); }
async function feed() { await menu(0);await key("c"); }
beforeEach(() => {
 vi.useFakeTimers();vi.setSystemTime(at);localStorage.clear();api.mockReset();generation="a".repeat(32);
 saved={schema:11,revision:1,species:2,name:"对比伙伴",createdAt:at-10000,hatchedAt:at-9000,lastTick:at,sleeping:false,
  needs:{hunger:60,mood:80,clean:60,energy:30},careCount:0,growth:emptyGrowth(),logs:[]};
 actionFeedback=structuredClone(receipt);
 api.mockImplementation(async path => {
  if(path==="action") {saved.revision++;saved.careCount++;if(actionFeedback?.effect)saved.needs=structuredClone(actionFeedback.effect.after);return {...result(),careFeedback:structuredClone(actionFeedback)};}
  return result();
 });
});
afterEach(() => {cleanup();vi.useRealTimers();});

describe("three-key care outcome lifetime", () => {
 it.each(["baby", "growing", "adult"] as const)("keeps the acknowledged %s growth gain after the toast and later state changes", async stage => {
  saved.growth=emptyGrowth(stage);saved.growth.points=stage==="adult"?72:stage==="growing"?30:4;
  if(stage==="adult")saved.growth.form="balanced";
  const points=stage==="adult"?0:stage==="growing"?.1:.25;
  actionFeedback={...receipt,points};
  await mount();await feed();
  expect(screen.getByLabelText("本次成长与习惯").textContent).toContain(`本次成长：+${points.toFixed(2)} 点`);
  expect(screen.getByLabelText("本次成长与习惯").textContent).toContain("喂食习惯：+1");
  const original=outcome()?.textContent;
  saved.growth.points+=stage==="adult"?0:2;saved.growth.care.nutrition+=3;saved.revision++;
  await poll();expect(document.querySelector("[data-feedback=idle]")).not.toBeNull();
  await menu(4);expect(outcome()?.textContent).toBe(original);expect(writes()).toHaveLength(1);
 });
 it("a rejected action or a recovery read cannot invent learning credit", async () => {
  await mount();api.mockRejectedValueOnce(new RequestFailure("not saved","rejected"));
  await menu(0);expect(outcome()).toBeNull();expect(screen.queryByLabelText("本次成长与习惯")).toBeNull();
  await poll();expect(screen.queryByLabelText("本次成长与习惯")).toBeNull();
  expect(saved.careCount).toBe(0);expect(writes()).toHaveLength(1);
 });

 it("starts empty, displays only the confirmed response, survives C skip, and has no new gameplay controls", async () => {
  await mount();expect(outcome()).toBeNull();await feed();
  expect(outcome()?.textContent).toContain("60.00 → 80.00+20.00");
  expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();expect(writes()).toHaveLength(1);
 });
 it("remains readable after the eight-second toast, with unchanged saved time through newer polls and status navigation", async () => {
  await mount();await feed();const original=outcome()?.textContent;
  saved.needs.hunger=20;saved.lastTick=at+15000;saved.revision++;await poll();
  expect(document.querySelector("[data-feedback=idle]")).not.toBeNull();
  expect(outcome()?.textContent).toBe(original);
  expect(outcome()?.querySelector("time")?.dateTime).toBe(new Date(at).toISOString());
  await menu(4);expect(outcome()?.textContent).toBe(original);
  expect(document.querySelector(".lcd-meter b")?.textContent).toBe("20");
  await key("a");expect(outcome()).toBeNull();await key("a");expect(outcome()?.textContent).toBe(original);
  await key("c");expect(outcome()?.textContent).toBe(original);expect(writes()).toHaveLength(1);
 });
 it.each(["resting","awake"] as const)("sleep %s reports only the toggle, not earlier elapsed recovery", async reason => {
  saved.sleeping=reason==="awake";
  actionFeedback={kind:"sleep",reason,points:0,habitGain:0,effect:{...effect,before:{...effect.before,energy:44},after:{...effect.before,energy:44}}};
  await mount();await menu(3);await key("c");
  expect(outcome()?.textContent).toContain(reason==="awake"?"起床":"入睡");
  expect(outcome()?.textContent).toContain("44.00 → 44.00不变");
 });
 it("replaces the receipt on another confirmed care and clears it for an action without care feedback", async () => {
  await mount();await feed();
  actionFeedback={...receipt,kind:"clean",habit:"clean",effect:{at:at+1,before:effect.after,after:{...effect.after,clean:92,mood:87}}};
  await menu(2);await key("c");expect(outcome()?.textContent).toContain("洗澡");expect(outcome()?.textContent).toContain("+35.00");
  actionFeedback=undefined;await menu(0);expect(outcome()).toBeNull();
 });
 it.each([undefined,"malformed"] as const)("older or %s optional metadata does not fail a successful action or invent a comparison", async value => {
  actionFeedback={...receipt,effect:value?{...effect,at:NaN}:undefined};
  await mount();await feed();expect(outcome()).toBeNull();expect(document.querySelector(".save-recovery")).toBeNull();
  expect(writes()).toHaveLength(1);expect(saved.careCount).toBe(1);
 });
 it("clears on same-pet generation replacement and does not reconstruct history on remount", async () => {
  await mount();await feed();generation="b".repeat(32);saved.revision++;await poll();expect(outcome()).toBeNull();
  cleanup();await mount();expect(outcome()).toBeNull();expect(writes()).toHaveLength(1);
 });
 it.each(["unknown","unavailable","corrupt","clock"] as const)("does not show a stale confirmed receipt across %s recovery", async kind => {
  await mount();await feed();
  if(kind==="unknown") {
   api.mockRejectedValueOnce(new RequestFailure("lost","unknown"));await menu(2);
  } else {
   api.mockRejectedValueOnce(new RequestFailure("lost","unavailable",kind==="corrupt"?"save_corrupt":kind==="clock"?"clock_ahead":undefined));await poll();
  }
  expect(outcome()).toBeNull();await key("b");expect(outcome()).toBeNull();
  // A recovery read may reveal changed needs but cannot recover an unreceived receipt.
  expect(saved.careCount).toBe(1);
 });
 it.each(["import","reset"] as const)("an explicit %s cannot leave the previous receipt attached to the new save", async kind => {
  await mount();await feed();
  if(kind==="import") {
   const body=JSON.stringify(saved),file=new File([body],"same-pet.json");Object.defineProperty(file,"text",{value:async()=>body});
   await act(async()=>{fireEvent.change(screen.getByLabelText("导入存档文件"),{target:{files:[file]}});});await key("b");
  } else {
   await act(async()=>{fireEvent.click(screen.getByRole("button",{name:/存档盒/}));});
   await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"重新开始"}));});
   await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"确认重新开始"}));});
  }
  expect(outcome()).toBeNull();expect(writes()).toHaveLength(2);
 });
});
