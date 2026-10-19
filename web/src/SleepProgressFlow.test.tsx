import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.parse("2026-10-20T08:00:00+08:00");
let saved: PetState, generation: string;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const progress = () => screen.queryByRole("group", { name: "本段休息的已保存进度" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function selectSleep() { for (const k of ["a", "a", "a", "a"]) await key(k); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); generation = "a".repeat(32);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 1, species: 2, name: "安心休息", createdAt: at - 3 * 3600000, hatchedAt: at - 3 * 3600000,
    lastTick: at, sleeping: true, needs: { hunger: 70, mood: 80, clean: 70, energy: 54 }, careCount: 0,
    logs: [], growth: emptyGrowth(), sleepSession: { startedAt: at - 3600000, settledHours: 1, energyRecovered: 14, restGain: .5, growthPoints: 1.17 } };
  saved.growth!.points = 3; saved.growth!.trackedHours = 2; saved.growth!.care.rest = .5;
  api.mockReset(); api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("reads current sleep only in the wake preview, without writing or showing a completed receipt", async () => {
  await mount(); expect(progress()).toBeNull(); const before = structuredClone(saved);
  await selectSleep(); expect(progress()?.textContent).toContain("恢复体力：+14.00");
  expect(screen.queryByRole("group", { name: "这次睡眠的实际结算" })).toBeNull();
  await key("c"); expect(progress()).toBeNull(); expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});
it("updates from an authoritative read, not from the browser clock, and survives reload", async () => {
  await mount(); await selectSleep(); const original = progress()?.textContent;
  vi.setSystemTime(at + 3600000); await refresh(); expect(progress()?.textContent).toBe(original);
  saved.revision++; saved.lastTick += 3600000; saved.needs.energy += 14; saved.growth!.trackedHours++;
  saved.growth!.points += 1; saved.growth!.care.rest += .5;
  Object.assign(saved.sleepSession!, { settledHours: 2, energyRecovered: 28, restGain: 1, growthPoints: 2.17 });
  await refresh(); expect(progress()?.textContent).toContain("实际结算：2.00 小时");
  expect(progress()?.textContent).toContain("恢复体力：+28.00");
  cleanup(); await mount(); expect(progress()).toBeNull(); await selectSleep();
  expect(progress()?.textContent).toContain("恢复体力：+28.00"); expect(writes()).toHaveLength(0);
});
it("removes old progress when another page wakes, and never joins it to a new sleep", async () => {
  await mount(); await selectSleep(); expect(progress()).not.toBeNull();
  saved.sleeping = false; saved.sleepSession = undefined; saved.revision++; await refresh(); expect(progress()).toBeNull();
  saved.sleeping = true; saved.revision++; saved.lastTick += 1000;
  saved.sleepSession = { startedAt: saved.lastTick, settledHours: 0, energyRecovered: 0, restGain: 0, growthPoints: 0 };
  await refresh(); expect(progress()?.textContent).toContain("恢复体力：+0.00");
  expect(progress()?.textContent).not.toContain("14.00"); expect(writes()).toHaveLength(0);
});
it.each([16, 17])("does not invent a schema %s legacy/imported session", async schema => {
  saved.schema = schema; saved.sleepSession = undefined; await mount(); await selectSleep();
  expect(progress()).toBeNull(); expect(screen.getByRole("note", { name: "所选菜单说明" }).textContent).toContain("没有完整入睡记录");
  expect(writes()).toHaveLength(0);
});
it("a replacement save clears the current view and uses only the replacement history", async () => {
  await mount(); await selectSleep(); expect(progress()).not.toBeNull();
  generation = "b".repeat(32); saved.revision = 0; saved.sleepSession = undefined;
  await refresh(); expect(progress()).toBeNull(); await selectSleep(); expect(progress()).toBeNull(); expect(writes()).toHaveLength(0);
});
it("an unavailable read and its recovery do not fabricate a completed sleep", async () => {
  await mount(); await selectSleep(); api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); expect(progress()).toBeNull();
  await key("b"); await refresh();
  expect(screen.queryByRole("group", { name: "这次睡眠的实际结算" })).toBeNull(); expect(writes()).toHaveLength(0);
});
