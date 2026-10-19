import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const kinds = ["feed", "arcade", "clean", "sleep", "status", "journal", "growth", "return", "album", "shop", "fish-album", "park-album"];
let saved: PetState, generation: string | undefined;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage = "baby", sleeping = false) {
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "看清再照顾", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth(stage) };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  await act(async () => { render(<App />); });
}
const previewKind = () => document.querySelector<HTMLElement>("[data-care-preview]")?.dataset.carePreview;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T03:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches('.care-menu [aria-current="true"],[data-care-reading-start]') ? 80 : 0, top = -500;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping A/B entry, twelve choices and wrapping locate the actual selection without care or focus changes", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
    const focus = document.querySelector<HTMLButtonElement>(".button-c")!; focus.focus(); expect(window.scrollBy).not.toHaveBeenCalled();
    await key("a");
    for (let n = 0; n < kinds.length; n++) {
      expect(previewKind()).toBe(kinds[n]); expect(document.querySelectorAll('.care-menu [aria-current="true"]')).toHaveLength(1);
      expect(document.querySelector('.care-menu [aria-current="true"] .menu-number')?.textContent).toBe(String(n + 1).padStart(2, "0"));
      expect(window.scrollBy).toHaveBeenCalledTimes(n + 1); await key("a"); expect(document.activeElement).toBe(focus);
    }
    expect(previewKind()).toBe("feed"); expect(window.scrollBy).toHaveBeenCalledTimes(13);
    await key("c"); expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(13);
    await key("b"); expect(previewKind()).toBe("feed"); expect(window.scrollBy).toHaveBeenCalledTimes(14);
    await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); }); expect(window.scrollBy).toHaveBeenCalledTimes(14);
    before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preferences);
  });
it("ordinary updates of needs, sleep and habits change previews without relocating an ongoing read", async () => {
  await mount(); await key("b");
  saved.needs.hunger = 100; await refresh(); expect(screen.getByLabelText("所选菜单说明").textContent).toContain("暂时不能喂食");
  saved.sleeping = true; saved.needs.hunger = 20; await refresh(); expect(screen.getByLabelText("所选菜单说明").textContent).toContain("先选「起床啦」");
  saved.sleeping = false; saved.growth!.care.lastFeed = Date.now(); await refresh();
  expect(screen.getByLabelText("所选菜单说明").textContent).toContain("30 分钟间隔"); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("already visible selections do not scroll", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(); await key("a"); for (let i = 0; i < 12; i++) await key("a"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("menu selection followed by a reading destination produces only each explicit navigation", async () => {
  await mount(); await key("b"); for (let i = 0; i < 4; i++) await key("a"); await key("b");
  expect(document.querySelector(".screen-status")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(6);
  await key("a"); expect(document.querySelector('[data-status-page="1"]')).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(7);
  await key("c"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(7); expect(writes()).toHaveLength(0);
});
it("help close does not replay a menu selection", async () => {
  await mount(); await key("b");
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await refresh(); expect(previewKind()).toBe("feed"); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("save-generation replacement consumes the old selection", async () => {
  await mount(); await key("b"); generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it("offline recovery cannot replay the old menu location", async () => {
  await mount(); await key("b"); api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); await key("b"); await refresh();
  expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("hidden selection is consumed rather than replayed on foregrounding", async () => {
  await mount(); Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  await key("b"); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh(); expect(window.scrollBy).not.toHaveBeenCalled();
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("old service without growth, care rules or generation still has explicit-only selection", async () => {
  await mount(); delete saved.growth; saved.schema = 1; generation = undefined; await refresh();
  await key("b"); await key("a"); expect(previewKind()).toBe("arcade"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
