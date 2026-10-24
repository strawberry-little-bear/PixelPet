import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function handbook() { await key("a"); for (let i=0;i<6;i++) await key("a"); await key("b"); }
const sideReading = () => document.querySelector('.companion-growth > small')?.textContent;
const sidePercent = () => document.querySelector('.companion-growth > div:first-child > span:last-child')?.textContent;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); api.mockReset();
  saved = { schema: 17, revision: 1, species: 2, name: "一点点长大", createdAt: Date.now()-3600000, hatchedAt: Date.now()-3600000,
    lastTick: Date.now(), sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth() };
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([
  ["baby", 0, "0.0"], ["baby", .0001, "<0.1"], ["baby", .09999, "<0.1"], ["baby", .1, "0.1"],
  ["baby", 23.99999, "23.9"], ["growing", 24, "0.0"], ["growing", 24.0001, "<0.1"],
  ["growing", 24.09999, "<0.1"], ["growing", 24.125, "0.1"], ["growing", 71.99999, "47.9"], ["adult", 72, "72.0"],
] as const)("visible handbook %s/%s distinguishes a positive trace from zero", (stage, points, reading) => {
  const g=emptyGrowth(stage); g.points=points; if(stage==="adult")g.form="balanced";
  const before=structuredClone(g); render(<GrowthPanel growth={g} index={2} page={0}/>);
  expect(document.querySelector('.growth-score > b')?.firstChild?.textContent).toBe(reading);
  if (reading === "<0.1") expect(document.querySelector('.growth-panel')?.textContent).toContain("已有少量成长");
  expect(g).toEqual(before); expect(document.querySelector('.growth-panel button,.growth-panel a,.growth-panel input')).toBeNull();
});
it.each([
  ["baby", .0001, "<0.1", "<1%"], ["growing", 24.0001, "<0.1", "<1%"],
  ["baby", .12, "0.1", "<1%"], ["growing", 24.25, "0.2", "<1%"],
  ["baby", 0, "0.0", "0%"], ["growing", 24, "0.0", "0%"],
  ["baby", 12, "12.0", "50%"], ["growing", 71.99999, "47.9", "99%"],
] as const)("sidebar and handbook agree for %s/%s without writes", async (stage, points, reading, percent) => {
  saved.growth=emptyGrowth(stage); saved.growth.points=points; const before=structuredClone(saved);
  await mount(); expect(sideReading()).toContain(`本阶段 ${reading} /`); expect(sidePercent()).toBe(percent);
  await handbook(); expect(document.querySelector('.growth-score > b')?.firstChild?.textContent).toBe(reading);
  await tick(15000); expect(sideReading()).toContain(`本阶段 ${reading} /`); expect(sidePercent()).toBe(percent);
  expect(saved).toEqual(before); expect(api.mock.calls.every(([path])=>["state","visit"].includes(path))).toBe(true);
  expect(document.querySelectorAll('.physical-button')).toHaveLength(3);
});
it.each(["baby", "growing"] as GrowthStage[])("%s grows only on a newer accepted snapshot, not client time or stale reads", async stage => {
  saved.growth=emptyGrowth(stage); saved.growth.points=stage==="growing"?24:0; await mount(); const old=response();
  await tick(15000); expect(sideReading()).toContain("本阶段 0.0 /");
  saved.revision++; saved.growth.points+=.0001; await tick(15000);
  expect(sideReading()).toContain("本阶段 <0.1 /"); expect(sidePercent()).toBe("<1%");
  api.mockResolvedValueOnce(old); await tick(15000); expect(sideReading()).toContain("本阶段 <0.1 /");
  cleanup(); await mount(); expect(sideReading()).toContain("本阶段 <0.1 /");
  expect(api.mock.calls.every(([path])=>["state","visit"].includes(path))).toBe(true);
});
it("legacy tiny estimates retain their source and do not claim saved growth", async () => {
  saved.schema=1; delete saved.growth; saved.hatchedAt=Date.now()-1000;
  await mount(); await handbook(); expect(sideReading()).toContain("本阶段 <0.1 /");
  expect(document.querySelector('.growth-trace-note')?.textContent).toContain("旧档兼容估算");
  expect(document.querySelector('.growth-trace-note')?.textContent).not.toContain("已有少量成长");
  expect(document.querySelector('.companion-growth [role=progressbar]')?.getAttribute('aria-valuetext')).toContain("旧档兼容估算");
});
it("initial adults stay complete, and eggs do not invent trace progress", async () => {
  saved.growth=emptyGrowth("adult"); saved.growth.points=72; saved.growth.form="gentle";
  await mount(); await handbook(); expect(sidePercent()).toBe("100%"); expect(document.querySelector('.growth-trace-note')).toBeNull();
  expect(sideReading()).toContain("形态已确定"); cleanup();
  saved.hatchedAt=0; saved.growth=emptyGrowth("egg"); await mount();
  expect(document.querySelector('.companion-growth')).toBeNull();
});

// A player opening the handbook from the home goal must see the same remaining
// distance, including a fractional last step; opening/refreshing cannot add it.
it.each([
  ["baby", 23.96, "距成长期还差 0.04 点"],
  ["baby", 23.999, "距成长期还差 0.01 点"],
  ["growing", 71.96, "距成年期还差 0.04 点"],
  ["growing", 71.999, "距成年期还差 0.01 点"],
] as const)("home and handbook keep the same remaining goal at %s/%s", async (stage, points, goal) => {
  saved.growth = emptyGrowth(stage); saved.growth.points = points;
  const before = structuredClone(saved);
  await mount();
  expect(document.querySelector(".growth-feedback small")?.textContent).toBe(goal);
  await handbook();
  expect(document.querySelector(".growth-panel .growth-next")?.textContent).toBe(goal);
  await tick(15000);
  expect(document.querySelector(".growth-panel .growth-next")?.textContent).toBe(goal);
  cleanup(); await mount(); await handbook();
  expect(document.querySelector(".growth-panel .growth-next")?.textContent).toBe(goal);
  expect(saved).toEqual(before);
  expect(api.mock.calls.every(([path]) => ["state", "visit"].includes(path))).toBe(true);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
});
