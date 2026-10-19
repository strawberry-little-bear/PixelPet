import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { albumCategories } from "./AlbumPanel";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string | undefined;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const panel = () => document.querySelector<HTMLElement>("[data-album-page]")!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage = "baby", sleeping = false, kind?: "fishing" | "walk") {
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "纪念伙伴", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth(stage),
    album: { since: at, legacy: false, entries: [ { kind: "hatch", at, source: "shared" },
      { kind: "meal", at: at + 1000, source: "shared" }, { kind: "scenery-walk-rain", at: at + 2000, source: "shared" } ] } };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  if (kind) saved.game = { id: "0123456789abcdef0123456789abcdef", kind, startedAt: at + 3000, round: 0, score: 0, lastBeat: -1,
    ...(kind === "fishing" ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } }
      : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25, step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } }) };
  await act(async () => { render(<App />); });
}
async function open() { await key("a"); for (let i = 0; i < 8; i++) await key("a"); await key("b"); }
async function scenery() { for (const k of ["a", "a", "a", "b"]) await key(k); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T03:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches('.album-directory [aria-current="true"],.album-panel > header,.fishing-pause,.walk-pause') ? 80 : 0, top = -500;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping locates each directory selection, card flip and return without moving focus or writing", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
    const focus = document.querySelector<HTMLButtonElement>(".button-b")!; focus.focus();
    expect(window.scrollBy).not.toHaveBeenCalled(); await open(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
    for (let n = 0; n < albumCategories.length; n++) {
      expect(document.querySelector('.album-directory [aria-current="true"]')?.textContent).toContain(albumCategories[n].label);
      await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(n + 2);
    }
    await key("b"); expect(panel().dataset.albumCategory).toBe("all");
    for (const [n, kind] of ["hatch", "meal", "scenery-walk-rain", undefined].entries()) {
      await key(n % 2 ? "a" : "b"); expect(panel().dataset.albumKind).toBe(kind); expect(window.scrollBy).toHaveBeenCalledTimes(n + 10);
    }
    await key("c"); expect(document.querySelector('[data-album-directory="all"]')).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(14);
    await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    expect(document.activeElement).toBe(focus);
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.scrollBy).toHaveBeenCalledTimes(14);
    await key("c"); expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(14);
    before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preferences);
  });
it.each([undefined, { since: 0, legacy: false, entries: [] }])("locates truthful empty/old-server covers (%s)", async album => {
  await mount(); saved.album = album; saved.schema = 1; delete saved.growth; generation = undefined; await refresh();
  await open(); await key("b"); await key("a"); await key("b");
  expect(panel().querySelector("time")).toBeNull(); expect(panel().textContent).toContain("1 / 1"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(4); expect(writes()).toHaveLength(0);
});
it("leaves already visible directory rows and card headings alone", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(); await open(); await key("a"); await key("b"); await key("a"); await key("c"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("ordinary sync preserves reading and memory identity, including missing-memory fallback", async () => {
  await mount(); await open(); await key("b"); await key("a"); await key("b"); expect(panel().dataset.albumKind).toBe("meal");
  saved.album!.entries.push({ kind: "bath", at: saved.album!.entries[1].at, source: "shared" }); await refresh();
  expect(panel().dataset.albumKind).toBe("meal"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  saved.album!.entries = saved.album!.entries.filter(m => m.kind !== "meal"); await refresh();
  expect(panel().textContent).toContain("同步时未找到"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(5); expect(writes()).toHaveLength(0);
});
it("save replacement cannot replay old navigation", async () => {
  await mount(); await open(); await key("b"); generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await open(); expect(window.scrollBy).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
});
it("offline recovery consumes old navigation instead of replaying it", async () => {
  await mount(); await open(); api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it("hidden navigation is consumed, not replayed on foregrounding", async () => {
  await mount(); Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  await open(); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh(); expect(window.scrollBy).not.toHaveBeenCalled();
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it.each(["fishing", "walk"] as const)("%s scenery entry/flips/return locate explicit targets but never resume the paused outing", async kind => {
  await mount("baby", false, kind); const before = structuredClone(saved);
  await scenery(); expect(panel().dataset.albumCategory).toBe("scenery"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(panel().dataset.albumKind).toBe("scenery-walk-rain"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); }); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("c"); expect(document.querySelector(kind === "walk" ? ".walk-pause" : ".fishing-pause")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); }); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  await key("b"); expect(panel().dataset.albumCategory).toBe("scenery"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
});
