import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { clipDurations } from "./motion";
import { RequestFailure } from "./requestFailure";
import type { CareFeedback, GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: generation, serverTime: Date.now(), message: "" });
const reason = () => document.querySelector(".growth-feedback")?.getAttribute("data-feedback");
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import", "recap/read"].includes(path));
const scene = () => document.querySelector(".content-home .pet-scene")?.getAttribute("data-motion");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount(stage: GrowthStage = "baby") { saved.growth = emptyGrowth(stage); await act(async () => { render(<App />); }); }
async function visibility() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function focus() { await act(async () => { window.dispatchEvent(new Event("focus")); }); }
type Cover = "help" | "tools" | "reset" | "hidden";
async function panel(kind: Exclude<Cover, "hidden">, open: boolean) {
  await act(async () => {
    if (!open && kind !== "tools") fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    else {
      fireEvent.click(screen.getByRole("button", { name: kind === "help" ? "玩法说明" : /存档盒/ }));
    }
  });
  if (kind === "reset" && open) await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^重新开始$/ })); });
}
async function care(kind: "feed" | "clean" | "sleep" = "feed", skip = true) {
  await key("a"); for (let i = 0; i < { feed: 0, clean: 2, sleep: 3 }[kind]; i++) await key("a");
  await key("b"); if (skip && scene() !== "sleeping") await key("c");
}
function acknowledged(kind: "feed" | "clean" | "sleep"): Result {
  const before = structuredClone(saved.needs), at = Date.now();
  saved.revision++;
  let feedback: CareFeedback;
  if (kind === "sleep") {
    saved.sleeping = !saved.sleeping;
    feedback = { kind, points: 0, habitGain: 0, reason: saved.sleeping ? "resting" : "awake" };
  } else {
    saved.careCount++;
    const habit = kind === "feed" ? "nutrition" : "clean";
    saved.needs[kind === "feed" ? "hunger" : "clean"] += 20;
    saved.growth!.care[habit]++;
    feedback = { kind, points: saved.growth!.stage === "adult" ? 0 : .25, habit, habitGain: 1, reason: "credited" };
  }
  return { ...result(), careFeedback: { ...feedback, effect: { at, before, after: structuredClone(saved.needs) } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = "a".repeat(32);
  saved = { schema: 12, revision: 10, species: 2, name: "照顾读完再走", createdAt: Date.now() - 2000, hatchedAt: Date.now() - 1000,
    lastTick: Date.now(), sleeping: false, careCount: 0, logs: [], growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 40 } };
  api.mockImplementation(async (path, body) => path === "action" ? acknowledged((body as { kind: "feed" | "clean" | "sleep" }).kind) : result());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(["baby", "growing", "adult"] as const)("readable care feedback at %s", stage => {
  it.each(["help", "tools", "reset", "hidden"] as const)("keeps the confirmed result while %s obscures it and allows a fresh full reading interval", async cover => {
    await mount(stage); await care(); expect(reason()).toBe("credited"); await tick(2000);
    if (cover === "hidden") {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      await visibility(); await tick(9000); expect(reason()).toBe("credited"); hidden.mockReturnValue(false); await visibility();
    } else { await panel(cover, true); await tick(9000); await panel(cover, false); }
    expect(reason()).toBe("credited"); expect(scene()).toBe("idle");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
    await tick(7999); expect(reason()).toBe("credited"); await tick(1); expect(reason()).toBe("idle");
    expect(document.querySelector(".care-outcome")?.textContent).toContain("喂食习惯：+1");
    expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
  });
});
it.each(["feed", "clean", "sleep"] as const)("does not replay the %s clip when help covers its ending", async kind => {
  if (kind === "sleep") saved.sleeping = true;
  await mount(); await care(kind, false); const expected = kind === "sleep" ? "awake" : "credited";
  await panel("help", true); await tick(kind === "feed" ? clipDurations.feed : kind === "clean" ? clipDurations.clean : clipDurations.wake); await tick(9000);
  await panel("help", false); expect(reason()).toBe(expected); expect(scene()).toBe("idle");
  await tick(7999); expect(reason()).toBe(expected); await tick(1); expect(reason()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it.each(["help", "hidden"] as const)("waits for readable home when a confirmed response arrives behind %s", async cover => {
  await mount(); const pending = deferred<Result>(); api.mockImplementation(async path => path === "action" ? pending.promise : result());
  await care("feed", false);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(cover === "hidden");
  if (cover === "hidden") await visibility(); else await panel("help", true);
  await act(async () => { pending.resolve(acknowledged("feed")); }); await tick(clipDurations.feed); await tick(9000);
  if (cover === "hidden") { hidden.mockReturnValue(false); await visibility(); } else await panel("help", false);
  expect(reason()).toBe("credited"); expect(scene()).toBe("idle"); await tick(8000); expect(reason()).toBe("idle");
  expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
});
it("starts reading a bedtime result only after its covering panel closes, without awarding rest", async () => {
  await mount(); await care("sleep"); await panel("tools", true); await tick(12000); await panel("tools", false);
  expect(reason()).toBe("resting"); expect(scene()).toBe("sleeping"); expect(saved.growth!.care.rest).toBe(0);
  await tick(8000); expect(reason()).toBe("idle"); expect(writes()).toHaveLength(1); expect(saved.sleeping).toBe(true);
});
it("cancels obsolete timers through repeated covers rather than expiring the latest reading early", async () => {
  await mount(); await care(); await tick(7000); await panel("help", true); await tick(5000); await panel("help", false);
  await tick(7000); await panel("tools", true); await tick(9000); await panel("tools", false);
  await tick(7999); expect(reason()).toBe("credited"); await tick(1); expect(reason()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it("keeps the established menu reading behavior without counting time away from home", async () => {
  await mount(); await care(); await key("a"); await tick(12000); await key("c");
  expect(reason()).toBe("credited"); await tick(8000); expect(reason()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it("does not pause or restart a still-visible reading for window blur, focus, or current-state polls", async () => {
  await mount(); await care(); await tick(4000);
  await act(async () => { window.dispatchEvent(new Event("blur")); }); await focus();
  await tick(3999); expect(reason()).toBe("credited"); await tick(1); expect(reason()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it("does not resurrect an expired result by returning from a panel or hidden tab", async () => {
  await mount(); await care(); await tick(8000); expect(reason()).toBe("idle");
  await panel("help", true); await tick(9000); await panel("help", false);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true); await visibility(); await tick(9000); hidden.mockReturnValue(false); await visibility();
  expect(reason()).toBe("idle"); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it("clears held feedback when another save generation replaces the pet", async () => {
  await mount(); await care(); await panel("help", true); await tick(9000);
  generation = "b".repeat(32); saved.revision = 1; saved.name = "新伙伴"; saved.careCount = 0; await focus();
  expect(reason()).toBe("idle"); expect(document.querySelector(".care-outcome")).toBeNull(); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(1);
});
it("clears held feedback on failed reads and does not reconstruct it when connection recovers", async () => {
  await mount(); await care(); await panel("help", true);
  api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await focus();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); await focus();
  await panel("help", false); expect(reason()).toBe("idle"); expect(document.querySelector(".care-outcome")).toBeNull(); expect(writes()).toHaveLength(1);
});
it("does not persist unread feedback across a reload or replay the saved care", async () => {
  await mount(); await care(); await panel("help", true); await tick(9000); cleanup(); await mount();
  expect(reason()).toBe("idle"); expect(scene()).toBe("idle"); expect(document.querySelector(".care-outcome")).toBeNull();
  expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
});
