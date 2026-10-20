import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string | undefined;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage = "baby", sleeping = false) {
  const at = Date.now() - 3600000;
  saved = { schema: 14, revision: 1, species: 2, name: "慢慢阅读", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth(stage) };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  await act(async () => { render(<App />); });
}
async function open(page: "growth" | "status") {
  await key("a"); for (let i = 0; i < (page === "growth" ? 6 : 4); i++) await key("a"); await key("b");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T03:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches("[data-care-reading-start]") ? 80 : 0, top = -500;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].flatMap(sleeping => (["growth", "status"] as const).map(page => ({ stage, sleeping, page })))))
  ("$stage sleeping=$sleeping explicit $page reading anchors each page, not ordinary reads", async ({ stage, sleeping, page }) => {
    await mount(stage, sleeping); const before = structuredClone(saved);
    expect(window.scrollBy).not.toHaveBeenCalled();
    const focus = document.querySelector<HTMLButtonElement>(".button-b")!; focus.focus();
    await open(page); const count = page === "growth" ? 6 : 2;
    expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(focus);
    for (let i = 1; i <= count; i++) {
      expect(document.querySelectorAll(`.content-${page} [data-care-reading-start]`)).toHaveLength(1);
      await key(page === "growth" ? "b" : "a");
      expect(window.scrollBy).toHaveBeenCalledTimes(i + 1); expect(document.activeElement).toBe(focus);
    }
    expect(document.querySelector(page === "growth" ? ".growth-panel" : ".screen-status")?.getAttribute(`data-${page}-page`)).toBe("0");
    await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.scrollBy).toHaveBeenCalledTimes(count + 1);
    await key("c"); expect(document.querySelector(".home-caption")).toBeTruthy();
    expect(window.scrollBy).toHaveBeenCalledTimes(count + 1); expect(writes()).toHaveLength(0);
    before.revision = saved.revision; expect(saved).toEqual(before);
  });
it.each(["growth", "status"] as const)("visible %s heading is left alone", async page => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(); await open(page); await key("a"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each(["growth", "status"] as const)("%s old navigation cannot replay after same-pet restore or read failure recovery", async page => {
  await mount(); await open(page); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  generation = "b".repeat(32); await refresh(); expect(document.querySelector(".home-caption")).toBeTruthy();
  expect(window.scrollBy).toHaveBeenCalledTimes(1); await open(page); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  api.mockRejectedValueOnce(new Error("offline")); await refresh(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it("does not replay hidden navigation on foreground and requires a fresh explicit key", async () => {
  await mount(); Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await open("growth"); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).not.toHaveBeenCalled(); await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});

it.each(["growth", "status"] as const)("legacy %s snapshots without growth or generation retain explicit-only navigation", async page => {
  await mount(); delete saved.growth; generation = undefined; await refresh();
  await open(page); await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});

it("reverse handbook navigation reveals every page once, without replaying on reads or taking focus", async () => {
  await mount(); const before = structuredClone(saved);
  const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  await open("growth"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  for (const [step, expected] of [5, 4, 3, 2, 1, 0].entries()) {
    await key("a");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe(String(expected));
    expect(document.querySelectorAll(".growth-panel [data-care-reading-start]")).toHaveLength(1);
    expect(window.scrollBy).toHaveBeenCalledTimes(step + 2); expect(document.activeElement).toBe(button);
    await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(step + 2);
  }
  await key("b"); expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("1");
  expect(window.scrollBy).toHaveBeenCalledTimes(8); expect(writes()).toHaveLength(0);
  before.revision = saved.revision; expect(saved).toEqual(before);
});
