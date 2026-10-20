import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { GrowthPanel } from "./GrowthPanel";
import { carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { CareRules, GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const defaults: CareRules = { awake: { hunger:-3,mood:-2.5,clean:-2,energy:-2 }, sleeping: { hunger:-3,mood:0,clean:-2,energy:14 }, maxOfflineHours:12,
  growth:{ basePerHour:.5,comfortPerHour:.75,restEnergyPerHabit:28,restPointsPerHabit:.25 } };
const changed: CareRules = { ...defaults,growth:{ ...defaults.growth!,restEnergyPerHabit:17.5,restPointsPerHabit:.4 } };
const reading = () => document.querySelector(".habit-rest-guide")?.textContent ?? document.querySelector(".growth-panel-note:last-of-type")?.lastChild?.textContent ?? "";
const pet = (stage: GrowthStage): PetState => ({ schema:17,revision:1,species:2,name:"休息习惯",createdAt:Date.now()-3600000,hatchedAt:Date.now()-3600000,lastTick:Date.now(),sleeping:false,
 needs:{ hunger:80,mood:80,clean:80,energy:80 },careCount:0,logs:[],growth:{ ...emptyGrowth(stage),points:stage==="adult"?72:stage==="growing"?30:1,form:stage==="adult"?"gentle":"" } });
afterEach(() => { cleanup();vi.useRealTimers(); });
it.each(["baby","growing","adult"] as GrowthStage[])("%s habit page uses the same accepted sleep basis as menu and handbook",stage=>{
 const p=pet(stage),before=structuredClone(p);
 const { rerender,container }=render(<GrowthPanel pet={p} growth={p.growth!} index={2} page={1} rules={changed}/>);
 expect(reading()).toContain("每恢复 17.5 体力，休息习惯 +1");
 expect(reading()).not.toContain("28");
 expect(carePreview(p,"sleep",changed)).toContain(reading());
 if(stage==="adult"){expect(reading()).toContain("成年形态不变");expect(reading()).not.toContain("成长 +");}
 else {expect(reading()).toContain("成长 +0.4");expect(reading()).toContain("按实际恢复比例记录");}
 rerender(<GrowthPanel pet={p} growth={p.growth!} index={2} page={4} rules={changed}/>);
 expect(container.querySelector(".growth-basis")?.textContent).toContain("每实际恢复 17.5 点体力");
 expect(p).toEqual(before);
});
it.each(["baby","growing","adult"] as GrowthStage[])("%s current service retains actual rest coefficients",stage=>{
 const p=pet(stage);render(<GrowthPanel pet={p} growth={p.growth!} index={2} page={1} rules={defaults}/>);
 expect(reading()).toContain("每恢复 28 体力，休息习惯 +1");
 expect(reading().includes("成长 +0.25")).toBe(stage!=="adult");
});
const invalid=[undefined,null,{}, { ...defaults.growth,restEnergyPerHabit:0 },{ ...defaults.growth,restEnergyPerHabit:101 },
 { ...defaults.growth,restEnergyPerHabit:NaN },{ ...defaults.growth,restPointsPerHabit:-1 },{ ...defaults.growth,restPointsPerHabit:Infinity }];
it.each(["baby","growing","adult"] as GrowthStage[])("%s never substitutes hardcoded rest numbers for missing or invalid metadata",stage=>{
 const p=pet(stage);const { rerender }=render(<GrowthPanel pet={p} growth={p.growth!} index={2} page={1} rules={defaults}/>);
 for(const growth of invalid){rerender(<GrowthPanel pet={p} growth={p.growth!} index={2} page={1} rules={{ ...defaults,growth } as CareRules}/>);
 expect(reading()).toContain("成长基准尚未读到");expect(reading()).not.toMatch(/28|0\.25|每恢复/);}
});
it("legacy age estimates do not claim authoritative sleep growth even with numeric metadata",()=>{
 const p=pet("baby");delete p.growth;render(<GrowthPanel pet={p} growth={emptyGrowth()} index={2} page={1} rules={changed}/>);
 expect(reading()).toContain("成长记录尚未读到");expect(reading()).not.toMatch(/17\.5|0\.4|28/);
});
it("egg guidance promises no rest growth and adds no playable controls",()=>{
 const {container}=render(<GrowthPanel growth={emptyGrowth("egg")} index={2} page={1} rules={changed}/>);
 expect(reading()).toContain("成长记录尚未读到");expect(reading()).not.toContain("成长 +");
 expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
});
let saved:PetState,metadata:CareRules|undefined;
const reply=():Result=>({state:structuredClone(saved),careRules:structuredClone(metadata),serverTime:Date.now(),message:""});
async function key(k:string){await act(async()=>{fireEvent.keyDown(window,{key:k});});}
async function poll(){await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});}
async function open(){await act(async()=>{render(<App/>);});await key("a");for(let i=0;i<6;i++)await key("a");await key("b");await key("b");}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-20T04:00:00Z"));localStorage.clear();api.mockReset();
 Object.defineProperty(document,"hidden",{configurable:true,value:false});saved=pet("baby");metadata=structuredClone(defaults);api.mockImplementation(async()=>reply());});
it("an accepted rules update changes the open habit page, not its page or saved habits",async()=>{
 await open();expect(reading()).toContain("每恢复 28");const before=structuredClone(saved);metadata=changed;saved.revision++;await poll();
 expect(reading()).toContain("每恢复 17.5");expect(document.querySelector(".growth-page-dots")?.textContent).toBe("2 / 6");
 expect(saved.growth).toEqual(before.growth);expect(saved.needs).toEqual(before.needs);
 expect(api.mock.calls.every(([path])=>["state","visit"].includes(path))).toBe(true);
 expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
});
it("metadata disappearance clears the old rest numbers and refresh retains the fallback",async()=>{
 await open();saved.revision++;metadata=undefined;await poll();expect(reading()).toContain("成长基准尚未读到");expect(reading()).not.toMatch(/28|0\.25/);
 cleanup();await open();expect(reading()).toContain("成长基准尚未读到");
 expect(api.mock.calls.every(([path])=>["state","visit"].includes(path))).toBe(true);
});
it("a stale response cannot replace the accepted sleep coefficients",async()=>{
 await open();const stale=reply();metadata=changed;saved.revision++;await poll();api.mockResolvedValueOnce(stale);await poll();
 expect(reading()).toContain("每恢复 17.5");
});
