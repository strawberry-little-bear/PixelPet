import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { GrowthPanel } from "./GrowthPanel";
import { request } from "./api";
import { emptyGrowth, growthProgress } from "./growth";
import type { GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function handbook() { await key("a"); for (let i=0;i<6;i++) await key("a"); await key("b"); }
function meter(selector: string) { return within(document.querySelector(selector) as HTMLElement).getByRole("progressbar", {name:"本阶段成长进度"}); }
function check(selector: string, now: number, max: number) {
  const el=meter(selector);
  expect(Number(el.getAttribute("aria-valuenow"))).toBe(now);
  expect(el.getAttribute("aria-valuemin")).toBe("0");
  expect(Number(el.getAttribute("aria-valuemax"))).toBe(max);
  expect(el.hasAttribute("tabindex")).toBe(false);
  expect(el.hasAttribute("aria-live")).toBe(false);
  expect(el.querySelector("button,a,input")).toBeNull();
  return el;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); localStorage.clear();
  Object.defineProperty(document,"hidden",{configurable:true,value:false}); api.mockReset();
  saved={schema:14,revision:1,species:2,name:"成长伙伴",createdAt:Date.now()-3600000,hatchedAt:Date.now()-3600000,lastTick:Date.now(),sleeping:false,careCount:0,logs:[],needs:{hunger:80,mood:80,clean:80,energy:80},growth:emptyGrowth()};
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([
  ["baby",0,0,24,"幼年期"], ["baby",.0001,.0001,24,"幼年期"],
  ["baby",12.25,12.25,24,"幼年期"], ["baby",23.999999,23.999999,24,"幼年期"],
  ["growing",24,0,48,"成长期"], ["growing",24.0001,24.0001-24,48,"成长期"],
  ["growing",48.25,24.25,48,"成长期"], ["growing",71.999999,71.999999-24,48,"成长期"],
  ["adult",72,72,72,"成年期"],
] as const)("handbook %s/%s uses exact stage-relative bounded progress",(stage,points,current,max,name) => {
  const g=emptyGrowth(stage);g.points=points;if(stage==="adult")g.form="gentle";
  const before=structuredClone(g);render(<GrowthPanel growth={g} index={2} page={0}/>);
  const el=check(".growth-panel",current,max);
  expect(el.getAttribute("aria-valuetext")).toContain(name);
  expect(el.getAttribute("aria-valuetext")).toContain("最近读取");
  expect(el.querySelector("i")?.style.width).toBe(`${growthProgress(g)}%`);
  if(stage!=="adult") {
    expect(el.getAttribute("aria-valuetext")).toContain("尚未进入");
    expect(el.getAttribute("aria-valuetext")).not.toContain("成长完成");
  } else {
    expect(el.getAttribute("aria-valuetext")).toContain("成长完成");
    expect(el.getAttribute("aria-valuetext")).toContain("恬静型");
  }
  if(current>0 && current<.01)expect(el.getAttribute("aria-valuetext")).toContain("不足 0.01");
  if(current<max && Number(current.toFixed(2))===max)expect(el.getAttribute("aria-valuetext")).toContain(`不足 ${max}`);
  expect(g).toEqual(before);
});
it("unhatched handbook progress describes hatching, not an adulthood forecast",() => {
  render(<GrowthPanel growth={emptyGrowth("egg")} index={0} page={0}/>);
  const el=check(".growth-panel",0,24);expect(el.getAttribute("aria-valuetext")).toContain("孵化后开始成长");
});
it.each(["baby","growing","adult"] as GrowthStage[])("sidebar and handbook share %s semantics without care writes", async stage => {
  saved.growth=emptyGrowth(stage);saved.growth.points=stage==="adult"?72:stage==="growing"?36.25:12.25;
  if(stage==="adult")saved.growth.form="lively";
  await mount();await handbook();
  const current=stage==="adult"?72:12.25,max=stage==="adult"?72:stage==="growing"?48:24;
  expect(check(".growth-panel",current,max).getAttribute("aria-valuetext")).toBe(check(".companion-growth",current,max).getAttribute("aria-valuetext"));
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);expect(document.querySelector(".lcd button,.lcd a,.lcd input,[role=slider]")).toBeNull();
  await key("c");expect(api.mock.calls.every(([p])=>["state","visit"].includes(p))).toBe(true);
});
it("accepted milestone reads replace the stage range; local time and stale reads cannot advance it",async()=>{
  saved.growth!.points=23.999999;await mount();await handbook();const old=response();
  await clock(10000);check(".growth-panel",23.999999,24);
  saved.revision++;saved.growth=emptyGrowth("growing");saved.growth.points=24.25;await clock(15000);
  check(".growth-panel",.25,48);check(".companion-growth",.25,48);
  api.mockResolvedValueOnce(old);await clock(15000);check(".growth-panel",.25,48);
  saved.revision++;saved.growth=emptyGrowth("adult");saved.growth.points=72;saved.growth.form="balanced";await clock(15000);
  expect(check(".growth-panel",72,72).getAttribute("aria-valuetext")).toContain("成长完成");
  expect(check(".companion-growth",72,72).getAttribute("aria-valuetext")).toContain("成长完成");
  expect(api.mock.calls.every(([p])=>["state","visit"].includes(p))).toBe(true);
});
it("legacy fallback is explicitly an estimate, not a claimed saved milestone",async()=>{
  saved.schema=1;delete saved.growth;await mount();await handbook();
  expect(meter(".growth-panel").getAttribute("aria-valuetext")).toContain("旧档兼容估算");
  expect(meter(".companion-growth").getAttribute("aria-valuetext")).toContain("旧档兼容估算");
  expect(meter(".companion-growth").getAttribute("aria-valuetext")).not.toContain("最近读取");
});
it("legacy adult preview does not announce a saved completion or fixed form",async()=>{
  saved.schema=1;delete saved.growth;saved.hatchedAt=Date.now()-80*3600000;
  await mount();await handbook();
  for(const selector of [".growth-panel",".companion-growth"]){
    const text=check(selector,72,72).getAttribute("aria-valuetext");
    expect(text).toContain("旧档兼容估算：成年期预览");
    expect(text).toContain("以服务端记录为准");
    expect(text).not.toMatch(/成长完成|已定型|最近读取/);
  }
});
it("unavailable sidebar retains its accepted progress; recovery only reads",async()=>{
  saved.growth!.points=10.25;await mount();api.mockRejectedValueOnce(new Error("offline"));await clock(15000);
  expect(document.querySelector(".save-recovery")).toBeTruthy();check(".companion-growth",10.25,24);
  saved.revision++;saved.growth!.points=11.25;await key("b");check(".companion-growth",11.25,24);
  expect(api.mock.calls.some(([p])=>p==="action")).toBe(false);
});
it("unhatched home has no fabricated sidebar progress",async()=>{
  saved.hatchedAt=0;saved.growth=emptyGrowth("egg");await mount();expect(document.querySelector('[role="progressbar"]')).toBeNull();
});
