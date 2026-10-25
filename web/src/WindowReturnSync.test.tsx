import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
let generation: string;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: generation, serverTime: Date.now(), message: "" });
const reads = () => api.mock.calls.filter(([path]) => path === "visit" || path === "state");
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path));
const scene = () => document.querySelector(".pet-scene")?.getAttribute("data-motion");
async function mount() { await act(async () => { render(<App />); }); }
async function event(type: "blur" | "focus") { await act(async () => { window.dispatchEvent(new Event(type)); }); }
async function visibility() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function menu(index = 0) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = "a".repeat(32);
  saved = { schema: 12, revision: 2, species: 2, name: "回窗伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(["baby", "growing", "adult"] as GrowthStage[])("return-to-window snapshot at %s", stage => {
  it.each([false, true])("updates current needs and sleep immediately without waiting for the poll (sleeping=%s)", async sleeping => {
    saved.growth = emptyGrowth(stage); await mount(); await menu(4);
    await event("blur"); expect(document.hidden).toBe(false);
    saved.needs = { hunger: 21, mood: 34, clean: 45, energy: 56 }; saved.sleeping = sleeping; saved.revision++;
    await clock(3000); expect(reads()).toHaveLength(1);
    await event("focus");
    expect(reads()).toHaveLength(2); expect(reads().at(-1)?.[0]).toBe("visit");
    expect(Array.from(document.querySelectorAll(".lcd-meter b"), e => e.textContent)).toEqual(["21", "34", "45", "56"]);
    expect(document.querySelector(".screen-status")).toBeTruthy();
    await key("a"); await key("a"); expect(document.querySelector(".status-guide")?.textContent).toContain(sleeping ? "正在睡觉" : "清醒中");
    expect(writes()).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  });
});

it("does not read for bubbling button focus or blur", async () => {
  await mount();
  await act(async () => {
    const a = screen.getByRole("button", { name: "A 选择" }), b = screen.getByRole("button", { name: "B 确认" });
    a.focus(); a.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    b.focus(); b.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  });
  expect(reads()).toHaveLength(1); expect(writes()).toHaveLength(0);
});
it("does not send focus reads while hidden, then reads on visibility return", async () => {
  await mount(); const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await event("blur"); await visibility(); await event("focus"); expect(reads()).toHaveLength(1);
  saved.sleeping = true; saved.revision++; hidden.mockReturnValue(false); await visibility();
  expect(reads()).toHaveLength(2); expect(scene()).toBe("sleeping"); expect(writes()).toHaveLength(0);
});
it("keeps a failed focus read disconnected and can recover on another focus without care replay", async () => {
  await mount(); await event("blur"); api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable"));
  await event("focus"); expect(document.querySelector(".save-recovery")).toBeTruthy();
  expect(document.querySelector(".local-status")?.textContent).toContain("小窝暂未连接");
  await event("blur"); saved.sleeping = true; saved.revision++; await event("focus");
  expect(scene()).toBe("sleeping"); expect(document.querySelector(".save-recovery")).toBeNull(); expect(writes()).toHaveLength(0);
});
it("recovers a lost meal with state only on focus, without retrying or playing a meal", async () => {
  await mount();
  api.mockImplementation(async path => {
    if (path === "action") { saved.careCount++; saved.revision++; throw new RequestFailure("lost reply", "unknown"); }
    return result();
  });
  await menu(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await event("blur"); await event("focus");
  expect(reads().at(-1)?.[0]).toBe("state"); expect(scene()).toBe("idle");
  expect(document.querySelector(".save-recovery,.care-feedback")).toBeNull(); expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
});
it.each(["save_corrupt", "clock_ahead"] as const)("uses state, not visit, to recheck %s on focus", async code => {
  api.mockRejectedValueOnce(new RequestFailure("blocked", "rejected", code)); await mount();
  await event("blur"); await event("focus");
  expect(reads().at(-1)?.[0]).toBe("state"); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(0);
});
it("routes a replacement from a focus read and discards old menu intent", async () => {
  await mount(); await key("a"); await event("blur");
  generation = "b".repeat(32); saved.name = "新伙伴"; saved.sleeping = true; saved.revision = 1;
  await event("focus");
  expect(scene()).toBe("sleeping"); expect(document.querySelector(".companion-title h2")?.textContent).toBe("新伙伴");
  expect(document.querySelector(".content-menu")).toBeNull(); expect(writes()).toHaveLength(0);
});
it("queues one fresh read when return occurs during an old poll, not one per focus event", async () => {
  await mount(); const old = deferred<Result>(), snapshot = result();
  api.mockReturnValueOnce(old.promise); await clock(15000); expect(reads()).toHaveLength(2);
  await event("blur"); saved.sleeping = true; saved.revision++;
  for (let i = 0; i < 10; i++) await event("focus");
  expect(reads()).toHaveLength(2);
  await act(async () => { old.resolve(snapshot); });
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping"); expect(writes()).toHaveLength(0);
});
it("also completes a queued visibility return after an old read", async () => {
  await mount(); const old = deferred<Result>(), snapshot = result(); api.mockReturnValueOnce(old.promise); await clock(15000);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true); await visibility();
  saved.sleeping = true; saved.revision++; hidden.mockReturnValue(false); await visibility();
  await act(async () => { old.resolve(snapshot); });
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping"); expect(writes()).toHaveLength(0);
});
it.each(["accepted", "unknown", "rejected"] as const)("defers a busy return until a single meal finishes (%s)", async outcome => {
  await mount(); const reply = deferred<Result>();
  api.mockImplementation(async path => path === "action" ? reply.promise : result());
  await menu(); expect(writes()).toHaveLength(1); expect(reads()).toHaveLength(1);
  await event("blur"); saved.sleeping = true; saved.revision++;
  for (let i = 0; i < 5; i++) await event("focus");
  expect(reads()).toHaveLength(1);
  await act(async () => {
    if (outcome === "accepted") reply.resolve(result());
    else reply.reject(new RequestFailure("meal reply", outcome === "unknown" ? "unknown" : "rejected"));
  });
  expect(reads()).toHaveLength(2); expect(reads().at(-1)?.[0]).toBe(outcome === "unknown" ? "state" : "visit");
  if (outcome === "rejected") {
    expect(document.querySelector(".content-menu")).toBeTruthy(); await key("c");
  }
  expect(scene()).toBe("sleeping"); expect(writes()).toHaveLength(1);
  expect(document.querySelector(".save-recovery")).toBeNull();
});
it("does not lose a return if a write starts and finishes within the same React batch", async () => {
  await mount();
  api.mockImplementation(async path => {
    if (path === "action") {
      saved.sleeping = true; saved.revision++;
      window.dispatchEvent(new Event("focus"));
    }
    return result();
  });
  await menu(); expect(reads()).toHaveLength(2); expect(writes()).toHaveLength(1); expect(scene()).toBe("sleeping");
});
it("does not issue a deferred read while hidden, but fulfills it on returning", async () => {
  await mount(); const old = deferred<Result>(), snapshot = result(); api.mockReturnValueOnce(old.promise); await clock(15000);
  await event("blur"); await event("focus");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true); await visibility();
  await act(async () => { old.resolve(snapshot); }); expect(reads()).toHaveLength(2);
  saved.sleeping = true; saved.revision++; hidden.mockReturnValue(false); await visibility();
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping");
});
it("does not drain an old queued return after unmount", async () => {
  await mount(); const old = deferred<Result>(), snapshot = result(); api.mockReturnValueOnce(old.promise); await clock(15000);
  await event("blur"); await event("focus"); cleanup();
  await act(async () => { old.resolve(snapshot); }); expect(reads()).toHaveLength(2);
});
it("drains a queued return after a failed old poll, but does not retry forever", async () => {
  await mount(); const old = deferred<Result>(); api.mockReturnValueOnce(old.promise); await clock(15000);
  await event("blur"); await event("focus");
  api.mockRejectedValue(new RequestFailure("still offline", "unavailable"));
  await act(async () => { old.reject(new RequestFailure("old poll failed", "unavailable")); });
  expect(reads()).toHaveLength(3); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await clock(1000); expect(reads()).toHaveLength(3); expect(writes()).toHaveLength(0);
});
it.each([false, true])("does not let a pre-write read undo the newer return read (old read fails=%s)", async fails => {
  await mount(); const old = deferred<Result>(), snapshot = result();
  api.mockReturnValueOnce(old.promise); await clock(15000);
  const meal = deferred<Result>(); api.mockImplementation(async path => path === "action" ? meal.promise : result());
  await menu(); await event("blur"); saved.sleeping = true; saved.revision++; await event("focus");
  await act(async () => { meal.resolve(result()); });
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping");
  await act(async () => { if (fails) old.reject(new RequestFailure("late offline", "unavailable")); else old.resolve(snapshot); });
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping");
  expect(document.querySelector(".save-recovery")).toBeNull(); expect(writes()).toHaveLength(1);
});
it("keeps the old read invalid even if it finishes before the held action reply", async () => {
  await mount(); const old = deferred<Result>(), snapshot = result(); api.mockReturnValueOnce(old.promise); await clock(15000);
  const meal = deferred<Result>(); api.mockImplementation(async path => path === "action" ? meal.promise : result());
  await menu(); await event("blur"); saved.sleeping = true; saved.revision++; await event("focus");
  await act(async () => { old.resolve(snapshot); }); expect(reads()).toHaveLength(2);
  await act(async () => { meal.resolve(result()); });
  expect(reads()).toHaveLength(3); expect(scene()).toBe("sleeping"); expect(writes()).toHaveLength(1);
});
it("does not poll after a pending write resolves on an unmounted page", async () => {
  await mount(); const meal = deferred<Result>(); api.mockImplementation(async path => path === "action" ? meal.promise : result());
  await menu(); await event("blur"); await event("focus"); cleanup();
  await act(async () => { meal.resolve(result()); }); expect(reads()).toHaveLength(1); expect(writes()).toHaveLength(1);
});
it("keeps a return from turning an unknown action into visit or a synthetic success receipt", async () => {
  await mount(); const meal = deferred<Result>(); api.mockImplementation(async path => path === "action" ? meal.promise : result());
  await menu(); await event("blur"); await event("focus");
  await act(async () => { meal.reject(new RequestFailure("lost meal", "unknown")); });
  expect(reads().at(-1)?.[0]).toBe("state"); expect(document.querySelector(".care-feedback,.care-outcome")).toBeNull();
  expect(scene()).toBe("idle"); expect(writes()).toHaveLength(1);
});
