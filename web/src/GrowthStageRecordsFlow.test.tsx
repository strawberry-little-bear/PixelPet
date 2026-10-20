import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({request:vi.fn()}));
const api = vi.mocked(request), at = Date.parse("2026-10-20T07:00:00Z");
let saved: PetState;
const reply = (): Result => ({state:structuredClone(saved),serverTime:Date.now(),message:""});
const dates = () => [...document.querySelectorAll<HTMLTimeElement>(".growth-stage-record time")].map(el => el.dateTime);
const writes = () => api.mock.calls.filter(([p]) => !["state","visit"].includes(p));
async function key(key: string) {await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true}));});}
async function open() {await key("a");for(let i=0;i<6;i++) await key("a");await key("b");for(let i=0;i<5;i++)await key("a");}
async function mount() {await act(async()=>{render(<App/>);});await open();}
async function poll() {await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(at);localStorage.clear();api.mockReset();
  saved={schema:17,revision:10,species:2,name:"成长足迹",createdAt:at-2*3600000,hatchedAt:at-3600000,lastTick:at,
    sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:40},careCount:0,growth:emptyGrowth(),logs:[],
    album:{since:at-3600000,legacy:false,entries:[{kind:"hatch",at:at-3600000,source:"shared"}]}};
  api.mockImplementation(async()=>reply());
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it("reaches dated poses on page six, wraps, and returns using only A/B/C without writes",async()=>{
  await mount();expect(dates()).toEqual([new Date(saved.hatchedAt).toISOString()]);
  expect(document.querySelector(".growth-page-dots")?.textContent).toBe("6 / 6");
  expect(screen.getByRole("group",{name:"成年期时间"}).textContent).toContain("尚未成年定型");
  await key("b");expect(document.querySelector(".growth-page-dots")?.textContent).toBe("1 / 6");expect(dates()).toEqual([]);
  await key("c");expect(document.querySelector(".home-caption")).toBeTruthy();expect(writes()).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});
it("uses accepted dates and provenance on ordinary reads, retaining reading focus and ignoring a stale reply",async()=>{
  saved.growth={...emptyGrowth("growing"),points:40,growingAt:at-1000};
  saved.album!.entries.push({kind:"growing",at:at-1000,source:"shared"});
  await mount();const region=screen.getByRole("region",{name:"成长手册阅读区"});region.focus();const before=dates();
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(dates()).toEqual(before);
  const stale=reply();saved.revision++;saved.growth.growingAt=at-500;
  saved.album!.legacy=true;saved.album!.since=at;saved.album!.entries[0].source="saved";
  saved.album!.entries[1]={kind:"growing",at:at-500,source:"saved"};await poll();
  expect(dates()).toEqual([new Date(saved.hatchedAt).toISOString(),new Date(at-500).toISOString()]);
  expect(screen.getByRole("group",{name:"成长期时间"}).textContent).toContain("旧档记录");
  expect(document.activeElement).toBe(region);api.mockResolvedValueOnce(stale);await poll();
  expect(dates().at(-1)).toBe(new Date(at-500).toISOString());expect(document.activeElement).toBe(region);expect(writes()).toHaveLength(0);
});
it("does not turn a missing growth reply's age-based stage preview into stage dates",async()=>{
  delete saved.growth;saved.hatchedAt=at-80*3600000;saved.createdAt=saved.hatchedAt-1000;saved.album=undefined;
  await mount();expect(dates()).toEqual([new Date(saved.hatchedAt).toISOString()]);
  expect(screen.getByRole("group",{name:"成长期时间"}).textContent).toContain("成长记录尚未读到");
  expect(screen.getByRole("group",{name:"成年期时间"}).textContent).toContain("成长记录尚未读到");expect(writes()).toHaveLength(0);
});
it("shows the timestamp and provenance returned by a care-triggered stage change, without writing again to view it",async()=>{
  saved.growth!.points=23.9;
  api.mockImplementation(async(path)=>{
    if(path==="action"){
      saved.revision++;saved.careCount++;saved.growth={...saved.growth!,stage:"growing",points:24.15,growingAt:at};
      saved.album!.entries.push({kind:"growing",at,source:"shared"});
    }
    return reply();
  });
  await act(async()=>{render(<App/>);});await key("a");await key("b");
  // Skip the care clip, then the separately queued evolution celebration.
  await key("c");await key("c");await open();
  expect(dates().at(-1)).toBe(new Date(at).toISOString());
  expect(screen.getByRole("group",{name:"成长期时间"}).textContent).toContain("成长经历记录");expect(writes()).toHaveLength(1);
  await poll();expect(writes()).toHaveLength(1);expect(saved.careCount).toBe(1);
});
