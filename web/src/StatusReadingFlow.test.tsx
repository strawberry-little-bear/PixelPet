import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const reading = () => document.querySelector<HTMLElement>('[aria-label="状态记录时间"]');
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function openStatus() { await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b"); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T02:34:56Z"));
  localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = Date.now();
  saved = { schema: 17, revision: 10, species: 2, name: "慢慢变化", createdAt: at - 7200000,
    hatchedAt: at - 3600000, lastTick: at - 120000, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 60, clean: 60, energy: 40, mood: 80 }, growth: emptyGrowth() };
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const stage of ["baby", "growing", "adult"] as const) for (const sleeping of [false, true]) {
  it(`${stage}/${sleeping ? "sleeping" : "awake"} shows the saved state time, not receipt time`, async () => {
    saved.growth = emptyGrowth(stage); saved.sleeping = sleeping;
    const before = structuredClone(saved);
    await mount(); await openStatus();
    expect(reading()?.textContent).toContain("状态记录截至");
    expect(reading()?.textContent).toContain("本地时间");
    expect(reading()?.textContent).toContain("不是按浏览器时间推算");
    expect(reading()?.querySelector("time")?.dateTime).toBe(new Date(saved.lastTick).toISOString());
    expect(reading()?.querySelector("time")?.dateTime).not.toBe(new Date(Date.now()).toISOString());
    expect(reading()?.querySelector("button,a,input,[tabindex],[aria-live],[role=button]")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  });
}
it("keeps timestamp and readings on the same accepted revision; local ticks and stale polls do not advance it", async () => {
  await mount(); await openStatus();
  const iso = new Date(saved.lastTick).toISOString();
  await poll();
  expect(reading()?.querySelector("time")?.dateTime).toBe(iso);
  saved.lastTick += 30000; saved.needs.hunger = 30; saved.revision++;
  await poll();
  const accepted = new Date(saved.lastTick).toISOString();
  expect(reading()?.querySelector("time")?.dateTime).toBe(accepted);
  expect(document.querySelector('.screen-status [aria-label="饱食"]')?.getAttribute("aria-valuenow")).toBe("30");
  saved.lastTick -= 30000; saved.needs.hunger = 60; saved.revision--;
  await poll();
  expect(reading()?.querySelector("time")?.dateTime).toBe(accepted);
  expect(document.querySelector('.screen-status [aria-label="饱食"]')?.getAttribute("aria-valuenow")).toBe("30");
  expect(writes()).toHaveLength(0);
});
it.each(["b", "c"])("keeps the two-page status navigation and %s return unchanged", async exit => {
  await mount(); await openStatus();
  expect(reading()).not.toBeNull();
  await key("a"); expect(document.querySelector(".status-guide")).not.toBeNull();
  expect(reading()).toBeNull();
  await key("a"); expect(reading()).not.toBeNull();
  await key(exit); expect(reading()).toBeNull();
  await openStatus(); expect(reading()).not.toBeNull();
  expect(document.querySelector(".status-page-number")?.textContent).toBe("1 / 2");
  expect(writes()).toHaveLength(0);
});
it("uses the legacy saved tick even when growth history is not supplied", async () => {
  saved.schema = 1; delete saved.growth;
  await mount(); await openStatus();
  expect(reading()?.querySelector("time")?.dateTime).toBe(new Date(saved.lastTick).toISOString());
  expect(writes()).toHaveLength(0);
});
