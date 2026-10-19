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
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [{ at: at + 1000, text: "一份饭团" }, { at: at + 2000, text: "一次泡泡澡" }, { at: at + 3000, text: "刚刚相遇" }], growth: emptyGrowth(stage) };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  await act(async () => { render(<App />); });
}
async function open() { await key("a"); for (let i = 0; i < 5; i++) await key("a"); await key("b"); }
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
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping entry and A flips locate the saved date without changing focus or writing", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
    expect(window.scrollBy).not.toHaveBeenCalled();
    const focus = document.querySelector<HTMLButtonElement>(".button-b")!; focus.focus();
    await open(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 3; n++) {
      expect(document.querySelector(".screen-journal > p")?.textContent).toBe(saved.logs[n].text);
      expect(document.querySelectorAll(".screen-journal [data-care-reading-start]")).toHaveLength(1);
      expect(document.querySelector("[data-care-reading-start]")?.tagName).toBe("TIME");
      await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(n + 2); expect(document.activeElement).toBe(focus);
    }
    await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.scrollBy).toHaveBeenCalledTimes(4); await key("c");
    expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(4);
    expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preferences);
    before.revision = saved.revision; expect(saved).toEqual(before);
  });
it.each([{ logs: [] }, { logs: null }, { logs: undefined }])("empty legacy logs ($logs) locate only the honest empty message", async ({ logs }) => {
  await mount(); saved.logs = logs as unknown as PetState["logs"]; await refresh(); await open();
  expect(document.querySelector("[data-care-reading-start]")?.textContent).toContain("还没有日记");
  expect(document.querySelector(".screen-journal time")).toBeNull(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("b"); expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  expect(writes()).toHaveLength(0);
});
it("leaves an already visible date alone", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(); await open(); await key("a"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("sync preserves selected entries and native reading position, including diary eviction", async () => {
  await mount(); await open(); await key("a"); const selected = saved.logs[1];
  saved.logs.unshift({ at: Date.now(), text: "新饭团" }); await refresh();
  expect(document.querySelector(".screen-journal > p")?.textContent).toBe(selected.text);
  saved.logs = [{ at: Date.now(), text: "只保留的新日记" }]; await refresh();
  expect(document.querySelector(".journal-trimmed")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
});
it("same-pet backup replacement consumes old navigation, re-entry requires a new explicit key", async () => {
  await mount(); await open(); generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await open(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it("failed read and recovery cannot replay old navigation", async () => {
  await mount(); await open(); api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("background navigation is consumed instead of jumping when foregrounded", async () => {
  await mount(); Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await open(); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).not.toHaveBeenCalled(); await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});
it("old service without growth or save-generation metadata keeps explicit-only reading", async () => {
  await mount(); delete saved.growth; generation = undefined; saved.schema = 1; await refresh();
  await open(); await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
