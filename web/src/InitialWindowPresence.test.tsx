import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, pending: boolean, recap: ReturnRecap;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "",
  saveGeneration: "a".repeat(32), returnRecap: structuredClone(recap), recapPending: pending });
const reads = () => api.mock.calls.filter(([p]) => ["state", "visit"].includes(p)).map(([p]) => p);
const claims = () => api.mock.calls.filter(([p]) => p === "recap/read");
const actions = () => api.mock.calls.filter(([p]) => ["action", "reset", "import"].includes(p));
async function mount() { await act(async () => { render(<App />); }); }
async function focus() {
  vi.mocked(document.hasFocus).mockReturnValue(true);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
}
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); pending = false;
  vi.mocked(document.hasFocus).mockReturnValue(false);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 1, species: 2, name: "初开窗口", createdAt: Date.now() - 86400000,
    hatchedAt: Date.now() - 86300000, lastTick: Date.now(), sleeping: false,
    growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  const snapshot = { needs: { ...saved.needs }, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
  recap = { id: "1".repeat(32), from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
  api.mockImplementation(async path => {
    if (path === "recap/read") { pending = false; return { ...result(), recapClaimed: true }; }
    return result();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([false, true])("loads a visible unfocused window without presence or polling (sleeping=%s)", async sleeping => {
  saved.sleeping = sleeping; await mount();
  expect(document.querySelector(".content-home")).toBeTruthy();
  expect(document.querySelector(".companion-title h2")?.textContent).toBe("初开窗口");
  expect(reads()).toEqual(["state"]); await poll(); expect(reads()).toEqual(["state"]);
  expect(claims()).toHaveLength(0); await focus(); expect(reads()).toEqual(["state", "visit"]);
  expect(actions()).toHaveLength(0);
});

it("preserves an existing pending recap until the initially unfocused window returns", async () => {
  pending = true; await mount(); await poll();
  expect(reads()).toEqual(["state"]); expect(claims()).toHaveLength(0);
  expect(document.querySelector(".return-panel")).toBeNull();
  await focus(); expect(claims()).toHaveLength(1); expect(document.querySelector(".return-panel")).toBeTruthy();
  expect(actions()).toHaveLength(0);
});

it("does not keep retrying a failed inactive bootstrap, but reconnects on focus", async () => {
  api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await mount();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); await poll(); expect(reads()).toEqual(["state"]);
  await focus(); expect(reads()).toEqual(["state", "visit"]);
  expect(document.querySelector(".save-recovery")).toBeNull(); expect(actions()).toHaveLength(0);
});

it("defers a hidden bootstrap, then only reads state if shown without focus", async () => {
  pending = true; Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await mount(); await poll(); expect(reads()).toEqual([]);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(reads()).toEqual(["state"]); expect(claims()).toHaveLength(0);
  await poll(); expect(reads()).toEqual(["state"]); await focus(); expect(claims()).toHaveLength(1);
});

it("coalesces a focus during the bootstrap into a fresh visit after the old state read", async () => {
  const old = deferred<Result>(); api.mockReturnValueOnce(old.promise);
  await mount(); await focus(); expect(reads()).toEqual(["state"]);
  saved.needs.hunger = 41; saved.revision++;
  await act(async () => { old.resolve(result()); });
  expect(reads()).toEqual(["state", "visit"]); expect(claims()).toHaveLength(0); expect(actions()).toHaveLength(0);
});

it("keeps corruption rechecks as state reads, including the first focused return", async () => {
  api.mockRejectedValueOnce(new RequestFailure("bad save", "rejected", "save_corrupt")); await mount();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); await poll(); expect(reads()).toEqual(["state"]);
  await focus(); expect(reads()).toEqual(["state", "state"]); expect(actions()).toHaveLength(0);
});

it("continues the established visit bootstrap when the document already has focus", async () => {
  vi.mocked(document.hasFocus).mockReturnValue(true); await mount(); await poll();
  expect(reads()).toEqual(["visit", "visit", "visit"]); expect(actions()).toHaveLength(0);
});

it("waits for the focused authoritative read before claiming an old pending recap", async () => {
  pending = true; await mount();
  const current = deferred<Result>(); api.mockReturnValueOnce(current.promise);
  await focus(); expect(reads()).toEqual(["state", "visit"]);
  expect(claims()).toHaveLength(0);
  // The current visit may reveal a newer state in which automatic reading is
  // no longer appropriate. Do not let the bootstrap's pending flag win first.
  saved.sleeping = true; saved.revision++;
  await act(async () => { current.resolve(result()); });
  expect(claims()).toHaveLength(0); expect(document.querySelector(".return-panel")).toBeNull();
  expect(actions()).toHaveLength(0);
});

it("claims a still-pending recap once the delayed focused visit has settled", async () => {
  pending = true; await mount();
  const current = deferred<Result>(); api.mockReturnValueOnce(current.promise);
  await focus(); expect(claims()).toHaveLength(0);
  await act(async () => { current.resolve(result()); });
  expect(reads()).toEqual(["state", "visit"]); expect(claims()).toHaveLength(1);
  expect(document.querySelector(".return-panel")).toBeTruthy(); expect(actions()).toHaveLength(0);
});
