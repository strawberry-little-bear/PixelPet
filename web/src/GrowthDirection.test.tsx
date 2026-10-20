import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth, growthPageCount } from "./growth";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const index = () => Number(document.querySelector<HTMLElement>("[data-growth-page]")?.dataset.growthPage);
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function open() {
  await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b");
}
async function mount(stage: GrowthStage = "baby", sleeping = false) {
  saved.sleeping = sleeping;
  saved.growth = emptyGrowth(stage);
  saved.growth.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 2;
  if (stage === "adult") saved.growth.form = "gentle";
  await act(async () => { render(<App />); }); await open();
}
async function poll() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const at = Date.now() - 3600000;
  saved = { schema: 18, revision: 1, species: 2, name: "回看成长", createdAt: at, hatchedAt: at,
    lastTick: Date.now(), sleeping: false, needs: { hunger: 65, mood: 85, clean: 70, energy: 55 }, careCount: 0, logs: [] };
  api.mockImplementation(async () => reply());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping: A reverses, B advances, both wrap all six pages without writes", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved);
    expect(index()).toBe(0);
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("A 上一页");
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 下一页");
    for (let i = growthPageCount - 1; i >= 0; i--) { await key("a"); expect(index()).toBe(i); }
    for (let i = 1; i <= growthPageCount; i++) { await key("b"); expect(index()).toBe(i % growthPageCount); }
    await key("a"); await key("b"); expect(index()).toBe(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input,[data-growth-page] [role=button]")).toBeNull();
    expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
    await key("c"); expect(document.querySelector(".home-caption")).toBeTruthy();
    await open(); expect(index()).toBe(0);
  });

it("preserves page and native focus across accepted reads, then reverses from that page", async () => {
  await mount(); await key("a"); expect(index()).toBe(5);
  const region = document.querySelector<HTMLElement>(".growth-panel")!; region.focus();
  saved.needs.hunger = 54; await poll();
  expect(index()).toBe(5); expect(document.activeElement).toBe(region);
  await key("a"); expect(index()).toBe(4);
  await key("b"); expect(index()).toBe(5); expect(document.activeElement).toBe(region);
  expect(writes()).toHaveLength(0);
});

it("does not replay reverse navigation after an interrupted read is recovered", async () => {
  await mount(); await key("a"); expect(index()).toBe(5);
  api.mockRejectedValueOnce(new Error("offline")); await poll();
  expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("a"); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); expect(document.querySelector(".save-recovery")).toBeNull(); expect(index()).toBe(5);
  await key("a"); expect(index()).toBe(4); await key("c");
  await open(); expect(index()).toBe(0); await key("a"); expect(index()).toBe(5);
  expect(writes()).toHaveLength(0);
});
