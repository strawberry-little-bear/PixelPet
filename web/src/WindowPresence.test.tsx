import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap | undefined, pending: boolean;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "",
  saveGeneration: "a".repeat(32), returnRecap: structuredClone(recap), recapPending: pending });
const reads = () => api.mock.calls.filter(([p]) => ["state", "visit"].includes(p));
const claims = () => api.mock.calls.filter(([p]) => p === "recap/read");
const actions = () => api.mock.calls.filter(([p]) => ["action", "reset", "import"].includes(p));
async function mount() { await act(async () => { render(<App />); }); }
async function event(type: "blur" | "focus") { await act(async () => { window.dispatchEvent(new Event(type)); }); }
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
function pendingRecap() {
  const snapshot = { needs: { ...saved.needs }, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
  recap = { id: "1".repeat(32), from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
  pending = true;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); recap = undefined; pending = false;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 1, species: 2, name: "窗口陪伴", createdAt: Date.now() - 86400000,
    hatchedAt: Date.now() - 86300000, lastTick: Date.now(), sleeping: false,
    growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async path => {
    if (path === "recap/read") { pending = false; return { ...result(), recapClaimed: true }; }
    return result();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([false, true])("does not heartbeat from a visible but unfocused window (sleeping=%s)", async sleeping => {
  saved.sleeping = sleeping; await mount(); expect(reads().map(([p]) => p)).toEqual(["visit"]);
  await event("blur"); expect(document.hidden).toBe(false);
  // Controlled browser-clock interval, not a natural sixteen-minute absence.
  vi.setSystemTime(Date.now() + 16 * 60000);
  await poll(); await poll();
  expect(reads().map(([p]) => p)).toEqual(["visit"]);
  saved.needs.hunger = 57; saved.revision++;
  await event("focus");
  expect(reads().map(([p]) => p)).toEqual(["visit", "visit"]);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(actions()).toHaveLength(0);
});

it("does not claim a recap when the initial read finishes after window blur", async () => {
  pendingRecap(); const read = deferred<Result>(); api.mockReturnValueOnce(read.promise);
  await mount(); await event("blur");
  await act(async () => { read.resolve(result()); });
  expect(claims()).toHaveLength(0); expect(document.querySelector(".return-panel")).toBeNull();
  await event("focus");
  expect(claims()).toHaveLength(1); expect(document.querySelector(".return-panel")).toBeTruthy();
  expect(actions()).toHaveLength(0);
});

it("does not claim from an old poll completing after blur, but can claim on return", async () => {
  await mount(); const read = deferred<Result>(); api.mockReturnValueOnce(read.promise);
  await poll(); await event("blur"); pendingRecap();
  await act(async () => { read.resolve(result()); });
  expect(claims()).toHaveLength(0); await poll(); expect(reads()).toHaveLength(2);
  await event("focus"); expect(claims()).toHaveLength(1);
});

it("drops an in-flight read across pagehide and starts a fresh persisted pageshow read", async () => {
  const oldRead = deferred<Result>(), freshRead = deferred<Result>();
  api.mockReset(); api.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(freshRead.promise);
  await mount();
  expect(reads().map(([path]) => path)).toEqual(["visit"]);

  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    const show = new Event("pageshow");
    Object.defineProperty(show, "persisted", { value: true });
    window.dispatchEvent(show);
  });
  expect(reads().map(([path]) => path)).toEqual(["visit", "visit"]);

  const freshState = structuredClone(saved);
  freshState.name = "恢复后的陪伴"; freshState.needs.hunger = 41; freshState.revision++;
  await act(async () => { freshRead.resolve({ ...result(), state: freshState }); });
  expect(document.querySelector(".companion-title h2")?.textContent).toBe("恢复后的陪伴");

  // The suspended pre-pagehide response is ignored even if the browser
  // releases it after the restored page has already rendered fresh state.
  const staleState = structuredClone(saved);
  staleState.name = "过期的陪伴"; staleState.needs.hunger = 12; staleState.revision++;
  await act(async () => { oldRead.resolve({ ...result(), state: staleState }); });
  expect(document.querySelector(".companion-title h2")?.textContent).toBe("恢复后的陪伴");
  expect(claims()).toHaveLength(0);
});

it("drops an in-flight read across freeze and starts a fresh resume read", async () => {
  const oldRead = deferred<Result>(), freshRead = deferred<Result>();
  api.mockReset(); api.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(freshRead.promise);
  await mount();
  expect(reads().map(([p]) => p)).toEqual(["visit"]);

  await act(async () => {
    window.dispatchEvent(new Event("freeze"));
    window.dispatchEvent(new Event("resume"));
  });
  expect(reads().map(([p]) => p)).toEqual(["visit", "visit"]);

  const freshState = structuredClone(saved);
  freshState.name = "冻结后恢复的陪伴"; freshState.needs.hunger = 43; freshState.revision++;
  await act(async () => { freshRead.resolve({ ...result(), state: freshState }); });
  expect(document.querySelector(".companion-title h2")?.textContent).toBe("冻结后恢复的陪伴");

  const staleState = structuredClone(saved);
  staleState.name = "冻结前的旧陪伴"; staleState.needs.hunger = 9; staleState.revision++;
  await act(async () => { oldRead.resolve({ ...result(), state: staleState }); });
  expect(document.querySelector(".companion-title h2")?.textContent).toBe("冻结后恢复的陪伴");
  expect(claims()).toHaveLength(0);
});

it("keeps an already saved claim in the menu rather than auto-presenting a late reply", async () => {
  pendingRecap(); const claim = deferred<Result>();
  api.mockImplementation(async path => path === "recap/read" ? claim.promise : result());
  await mount(); expect(claims()).toHaveLength(1); await event("blur"); pending = false;
  await act(async () => { claim.resolve({ ...result(), recapClaimed: true }); });
  expect(document.querySelector(".return-panel")).toBeNull();
  await event("focus"); await poll();
  expect(claims()).toHaveLength(1); expect(document.querySelector(".return-panel")).toBeNull();
  // Explicit A/B/C review is still available after the canceled auto-display.
  await act(async () => { fireEvent.keyDown(window, { key: "a" }); });
  for (let i = 0; i < 7; i++) await act(async () => { fireEvent.keyDown(window, { key: "a" }); });
  await act(async () => { fireEvent.keyDown(window, { key: "b" }); });
  expect(document.querySelector(".return-panel")).toBeTruthy(); expect(actions()).toHaveLength(0);
});

it("ignores bubbling control blur and keeps ordinary foreground polling", async () => {
  await mount();
  await act(async () => { screen.getByRole("button", { name: "A 选择" }).dispatchEvent(new FocusEvent("blur", { bubbles: true })); });
  await poll(); expect(reads().map(([p]) => p)).toEqual(["visit", "visit"]);
});

it("does not turn a hidden window focus into presence until visibility returns", async () => {
  await mount(); await event("blur");
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await event("focus"); await poll(); expect(reads()).toHaveLength(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(reads().map(([p]) => p)).toEqual(["visit", "visit"]); expect(actions()).toHaveLength(0);
});

it("invalidates synchronously when a due poll and window blur share a React batch", async () => {
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(reads()).toHaveLength(1); expect(claims()).toHaveLength(0);
  await event("focus"); expect(reads()).toHaveLength(2);
});

it("does not revive a canceled auto-display if focus returns before the saved claim reply", async () => {
  pendingRecap(); const claim = deferred<Result>();
  api.mockImplementation(async path => path === "recap/read" ? claim.promise : result());
  await mount(); await event("blur"); await event("focus"); pending = false;
  await act(async () => { claim.resolve({ ...result(), recapClaimed: true }); });
  expect(claims()).toHaveLength(1); expect(document.querySelector(".return-panel")).toBeNull();
  expect(reads().map(([p]) => p)).toEqual(["visit", "visit"]);
});

it("cleans up window listeners and pending polling on unmount", async () => {
  await mount(); await event("blur"); cleanup();
  await event("focus"); await poll(); expect(reads()).toHaveLength(1); expect(claims()).toHaveLength(0);
});
