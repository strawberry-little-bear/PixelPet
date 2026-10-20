import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); await key("b"); }
const advice = () => document.querySelector<HTMLElement>(".care-menu-advice");
const selected = () => document.querySelector(".care-item.selected")?.textContent;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "看看再选", createdAt: at, hatchedAt: at, lastTick: Date.now(),
    sleeping: false, careCount: 0, logs: [], needs: { hunger: 80, clean: 80, energy: 80, mood: 80 }, growth: emptyGrowth() };
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const profiles = [
  { name: "hungry", needs: { hunger: 10 }, text: "从菜单选「吃点东西」" },
  { name: "dirty", needs: { clean: 10 }, text: "从菜单选「洗个澡澡」" },
  { name: "tired", needs: { energy: 10 }, text: "从菜单选「睡个好觉」" },
  { name: "playful", needs: { mood: 10 }, text: "从菜单选「一起玩耍」" },
  { name: "quiet", needs: { energy: 43, mood: 10 }, text: "可以安静陪伴" },
  { name: "comfortable", needs: {}, text: "现在很舒适" },
  { name: "sleeping", needs: {}, sleeping: true, text: "正在休息，不必急着叫醒" },
  { name: "sleep-full", needs: { energy: 100 }, sleeping: true, text: "体力已满，可以从菜单选「起床啦」" },
  { name: "sleep-hungry", needs: { hunger: 10 }, sleeping: true, text: "先从菜单选「起床啦」，再选「吃点东西」" },
  { name: "sleep-dirty", needs: { clean: 10 }, sleeping: true, text: "先从菜单选「起床啦」，再选「洗个澡澡」" },
] as const;
for (const stage of ["baby", "growing", "adult"] as const) it.each(profiles)(`${stage}/$name gives read-only advice without moving the selected action`, async profile => {
  saved.growth = emptyGrowth(stage);
  saved.growth.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth.form = "gentle";
  Object.assign(saved.needs, profile.needs);
  saved.sleeping = "sleeping" in profile && profile.sleeping;
  const before = structuredClone(saved);
  await mount();
  expect(advice()).not.toBeNull();
  expect(advice()?.textContent).toContain("现在怎么照顾 · 最近读取");
  expect(advice()?.textContent).toContain(profile.text);
  expect(advice()?.querySelector("button,input,a,[tabindex],[role=button],[aria-live]")).toBeNull();
  expect(selected()).toContain("吃点东西");
  expect(writes()).toHaveLength(0);
  expect(saved).toEqual(before);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  await key("c");
  expect(advice()).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("keeps the recommendation while browsing all twelve actions without changing their order", async () => {
  saved.needs.energy = 10;
  await mount();
  const text = advice()?.textContent;
  expect(text).toContain("睡个好觉");
  const kinds = ["feed", "arcade", "clean", "sleep", "status", "journal", "growth", "return", "album", "shop", "fish-album", "park-album"];
  for (const kind of kinds) {
    expect(document.querySelector("[data-care-preview]")?.getAttribute("data-care-preview")).toBe(kind);
    expect(advice()?.textContent).toBe(text);
    await key("a");
  }
  expect(writes()).toHaveLength(0);
});
it("updates from an accepted snapshot but not from the local clock or a stale poll", async () => {
  saved.needs.hunger = 10;
  await mount(); await key("a");
  const choice = selected();
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(advice()?.textContent).toContain("吃点东西");
  saved.revision++;
  saved.needs.hunger = 80; saved.needs.energy = 10;
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(advice()?.textContent).toContain("睡个好觉");
  expect(selected()).toBe(choice);
  saved.revision--; saved.needs.energy = 80; saved.needs.clean = 10;
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(advice()?.textContent).toContain("睡个好觉");
  expect(writes()).toHaveLength(0);
});
it("remains useful without legacy growth instead of inventing rewards", async () => {
  delete saved.growth; saved.needs.clean = 10;
  await mount();
  expect(advice()?.textContent).toContain("洗个澡澡");
  expect(advice()?.textContent).not.toMatch(/\+|成长点|习惯/);
  expect(writes()).toHaveLength(0);
});
it("does not execute on clicking the advice; B still executes the selected action, not the recommendation", async () => {
  saved.needs.hunger = 60; saved.needs.energy = 10;
  await mount();
  expect(advice()?.textContent).toContain("睡个好觉");
  await act(async () => { fireEvent.click(advice()!); });
  expect(writes()).toHaveLength(0);
  await key("b");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: "feed" });
});
