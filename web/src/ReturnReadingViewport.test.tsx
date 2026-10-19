import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState, Result, ReturnRecap } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap, generation: string | undefined, pending: boolean;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation,
  returnRecap: structuredClone(recap), recapPending: pending });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage = "baby", sleeping = false, automatic = false) {
  const at = Date.now() - 3600000;
  saved = { schema: 14, revision: 1, species: 2, name: "回访稳稳读", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth(stage) };
  if (stage === "adult") saved.growth!.form = "gentle";
  const snapshot = { needs: saved.needs, stage, form: saved.growth!.form, points: 1, rest: 0, trackedHours: 1, sleeping };
  recap = { id: "one", from: at, to: Date.now(), before: snapshot, after: { ...snapshot, points: 2, trackedHours: 2 } };
  pending = automatic;
  await act(async () => { render(<App />); });
}
async function review() { await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b"); }
const counter = () => document.querySelector(".return-panel header span")?.textContent;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T03:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); pending = false; api.mockReset();
  api.mockImplementation(async path => {
    if (path === "recap/read") { pending = false; return { ...response(), recapClaimed: true }; }
    return response();
  });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches(".return-panel > header") ? 80 : 0, top = -222;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping manual open and A/B pages expose the header without writes or focus changes", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved);
    expect(window.scrollBy).not.toHaveBeenCalled(); const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
    await review(); expect(counter()).toBe("1 / 2"); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(button);
    await key("b"); expect(counter()).toBe("2 / 2"); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(document.activeElement).toBe(button);
    const panel = document.querySelector<HTMLElement>(".return-panel")!; panel.focus(); panel.scrollTop = 50;
    await key("a"); expect(counter()).toBe("1 / 2"); expect(window.scrollBy).toHaveBeenCalledTimes(3);
    const next = document.querySelector<HTMLElement>(".return-panel")!;
    expect(next).not.toBe(panel); expect(next.scrollTop).toBe(0); expect(document.activeElement).toBe(next);
    await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.scrollBy).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
    before.revision = saved.revision; expect(saved).toEqual(before);
  });
it("does not move a header already fully visible", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(); await review(); await key("b"); await key("a"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each(["b", "c"])("%s returning home from page two does not queue a reading jump", async exit => {
  await mount(); await review(); await key("b"); await key(exit); await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it("same/new record sync preserves outer scroll and consumes no navigation intent", async () => {
  await mount(); await review(); await key("b"); const panel = document.querySelector<HTMLElement>(".return-panel")!; panel.focus(); panel.scrollTop = 50;
  await refresh(); expect(document.querySelector(".return-panel")).toBe(panel); expect(panel.scrollTop).toBe(50);
  recap.id = "two"; await refresh(); expect(counter()).toBe("1 / 2"); expect(document.querySelector(".return-sync-note")).toBeTruthy();
  expect(window.scrollBy).toHaveBeenCalledTimes(2); await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(0);
});
it("hidden navigation is discarded rather than replayed when foregrounded", async () => {
  await mount(); Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await review(); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh(); expect(window.scrollBy).not.toHaveBeenCalled();
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});
it.each(["generation", "offline"])("%s recovery cannot replay a previously consumed opening", async kind => {
  await mount(); await review(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  if (kind === "generation") { generation = "b".repeat(32); await refresh(); }
  else { api.mockRejectedValueOnce(new Error("offline")); await refresh(); await key("b"); await refresh(); }
  expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
});
it.each(["baby", "growing", "adult"] as const)("%s automatic presentation exposes the header once, without re-acknowledgement", async stage => {
  await mount(stage, false, true); expect(counter()).toBe("1 / 2"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes().map(([path]) => path)).toEqual(["recap/read"]);
});
it("legacy responses without generation/growth still support explicit navigation", async () => {
  await mount(); delete saved.growth; generation = undefined; await refresh();
  await review(); await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
