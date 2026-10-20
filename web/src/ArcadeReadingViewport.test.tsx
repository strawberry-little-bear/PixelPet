import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { games, rememberGuide } from "./games";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string | undefined, top: number;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const choice = () => document.querySelector('.arcade-card[aria-current="true"]')?.getAttribute("data-game");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage = "baby") {
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "看清再开局", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(stage) };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  await act(async () => { render(<App />); });
}
async function directory() { for (const k of ["a", "a", "b"]) await key(k); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T08:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); top = -500;
  api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches('.arcade-card[aria-current="true"],.game-guide > header') ? 80 : 0;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(seen => ({ stage, seen }))))
  ("$stage seen=$seen locates seven selections, rules, wrap and returns only on explicit input", async ({ stage, seen }) => {
    if (seen) for (const game of games) rememberGuide(game.id);
    await mount(stage); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
    const focus = document.querySelector<HTMLButtonElement>(".button-c")!; focus.focus();
    await directory(); let calls = 1;
    for (const game of games) {
      expect(choice()).toBe(game.id); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("b"); calls++; expect(document.querySelector(".game-guide")?.getAttribute("data-guide")).toBe(game.id);
      expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      if (seen) { expect(document.querySelector(".game-quick-start")).toBeTruthy(); await key("a"); calls++; }
      expect(document.querySelector(".game-guide header")?.textContent).toContain("1 / 2");
      await key("a"); calls++; expect(document.querySelector(".game-guide header")?.textContent).toContain("2 / 2");
      await key("a"); calls++; expect(document.querySelector(".game-guide header")?.textContent).toContain("1 / 2");
      expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("c"); calls++; expect(choice()).toBe(game.id); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("a"); calls++; expect(document.activeElement).toBe(focus);
    }
    expect(choice()).toBe("stars"); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
    await key("c"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
    before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
    expect(JSON.stringify(localStorage)).toBe(preferences);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  });
it("does not move an already visible selection/header, but later explicit navigation can locate one below the viewport", async () => {
  await mount(); top = 20; await directory(); await key("b"); await key("a"); expect(window.scrollBy).not.toHaveBeenCalled();
  top = 1000; await key("a"); expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 988, behavior: "instant" });
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});
it.each(["directory", "guide"] as const)("polls, help and foreground recovery do not replay the %s location", async page => {
  await mount(); await directory(); if (page === "guide") await key("b");
  const calls = page === "guide" ? 2 : 1;
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).toHaveBeenCalledTimes(calls); expect(writes()).toHaveLength(0);
});
it("consumes a hidden navigation instead of replaying it on return", async () => {
  await mount(); await directory(); Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it.each(["directory", "guide"] as const)("replacement of a save consumes the old %s intent", async page => {
  await mount(); await directory(); if (page === "guide") await key("b");
  const calls = page === "guide" ? 2 : 1;
  generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
  await directory(); expect(choice()).toBe("stars"); expect(window.scrollBy).toHaveBeenCalledTimes(calls + 1); expect(writes()).toHaveLength(0);
});
it("offline recovery does not replay navigation, and old services can still explicitly browse", async () => {
  await mount(); delete saved.growth; saved.schema = 1; generation = undefined; await refresh();
  await directory(); await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  api.mockRejectedValueOnce(new Error("offline")); await refresh(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
});

it.each(games)("reopens the selected $id without starting, marking rules or replaying navigation", async game => {
  await mount(); await directory();
  for (let i = 0; i < games.indexOf(game); i++) await key("a");
  const preferences = JSON.stringify(localStorage);
  await key("c");
  // Ordinary saves can rename, care and grow without changing this pet's identity.
  saved.name = "新的昵称"; saved.careCount++; saved.needs.hunger++; saved.growth!.points = 25; saved.growth!.stage = "growing";
  await refresh();
  expect(screen.getByText("长大啦 · C 跳过")).toBeTruthy();
  await key("c"); // Dismiss the real cross-stage celebration, not the directory.
  const calls = vi.mocked(window.scrollBy).mock.calls.length;
  await directory(); expect(choice()).toBe(game.id);
  expect(window.scrollBy).toHaveBeenCalledTimes(calls + 1);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(calls + 1);
  await key("b"); expect(document.querySelector(".game-guide")?.getAttribute("data-guide")).toBe(game.id);
  await key("c"); expect(choice()).toBe(game.id);
  expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preferences);
});
it.each(["generation", "lifecycle"])("does not share a selection across a %s replacement", async kind => {
  await mount(); await directory(); await key("a"); await key("a"); await key("c");
  if (kind === "generation") { generation = "b".repeat(32); saved.revision = 0; }
  else { generation = undefined; saved.createdAt++; saved.hatchedAt!++; }
  await refresh(); await directory(); expect(choice()).toBe("stars"); expect(writes()).toHaveLength(0);
});
it("a fresh page starts at the first game, not a stored preference", async () => {
  await mount(); await directory(); await key("a"); await key("c");
  cleanup(); await act(async () => { render(<App />); });
  await directory(); expect(choice()).toBe("stars"); expect(writes()).toHaveLength(0);
});
it("retains the same-save choice through a read-only offline recovery", async () => {
  await mount(); await directory(); await key("a"); await key("c");
  api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); await directory(); expect(choice()).toBe("tiles"); expect(writes()).toHaveLength(0);
});
