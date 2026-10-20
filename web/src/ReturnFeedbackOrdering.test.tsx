import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { CareFeedback, PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.parse("2026-10-21T02:00:00Z");
let saved: PetState, recap: ReturnRecap, pending: boolean;
const result = (): Result => ({
  state: structuredClone(saved), message: "", serverTime: Date.now(),
  saveGeneration: "a".repeat(32), returnRecap: structuredClone(recap), recapPending: pending,
});
const claims = () => api.mock.calls.filter(([path]) => path === "recap/read");
const actions = () => api.mock.calls.filter(([path]) => path === "action");
const feedback = () => document.querySelector(".growth-feedback.has-feedback");
const receipt = () => screen.queryByRole("region", { name: "上次操作的即时变化" });
const returning = () => document.querySelector(".return-panel");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function care(index = 3) {
  await key("a");
  for (let i = 0; i < index; i++) await key("a");
  await key("b");
}
async function visibility(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}
function expectHomeFeedback() {
  expect(document.querySelector(".content-home")).not.toBeNull();
  expect(feedback()).not.toBeNull();
  expect(receipt()).not.toBeNull();
  expect(returning()).toBeNull();
  expect(claims()).toHaveLength(0);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  pending = true;
  saved = {
    schema: 17, revision: 1, species: 2, name: "回访衔接", createdAt: at - 2 * 3600000,
    hatchedAt: at - 2 * 3600000, lastTick: at, sleeping: true,
    needs: { hunger: 30, mood: 80, clean: 30, energy: 54 },
    careCount: 0, growth: emptyGrowth(), logs: [],
    sleepSession: { startedAt: at - 3600000, settledHours: 1, energyRecovered: 14, restGain: .5, growthPoints: 1.17 },
  };
  const snapshot = { needs: { ...saved.needs }, stage: "baby" as const, form: "" as const,
    points: 0, rest: 0, trackedHours: 0, sleeping: true };
  recap = { id: "sleep-return", from: at - 3600000, to: at,
    before: snapshot, after: { ...snapshot, points: 1.17, rest: .5, trackedHours: 1 } };
  saved.growth!.points = 1.17; saved.growth!.trackedHours = 1;
  saved.growth!.wellbeing = .73; saved.growth!.care.rest = .5;
  api.mockImplementation(async (path, body) => {
    if (path === "recap/read") { pending = false; return { ...result(), recapClaimed: true }; }
    if (path !== "action") return result();
    const kind = (body as { kind: "sleep" | "feed" | "clean" }).kind;
    const before = structuredClone(saved.needs), session = saved.sleepSession;
    if (kind === "sleep") { saved.sleeping = false; saved.sleepSession = undefined; }
    else {
      saved.needs[kind === "feed" ? "hunger" : "clean"] = 80; saved.careCount++;
      saved.growth!.care[kind === "feed" ? "nutrition" : "clean"]++;
      saved.growth!.points += .25;
    }
    saved.revision++; pending = true;
    const careFeedback: CareFeedback = {
      kind, reason: kind === "sleep" ? "awake" : "credited",
      points: kind === "sleep" ? 0 : .25, habitGain: kind === "sleep" ? 0 : 1,
      ...(kind === "sleep" ? {} : { habit: kind === "feed" ? "nutrition" as const : "clean" as const }),
      effect: { at: Date.now(), before, after: structuredClone(saved.needs) },
      ...(kind === "sleep" && session ? { sleepSummary: { ...session, wokeAt: Date.now() } } : {}),
    };
    return { ...result(), careFeedback };
  });
});
afterEach(() => {
  cleanup(); vi.useRealTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

it("finishes the wake clip, then gives the acknowledged feedback eight full seconds before claiming once", async () => {
  await mount(); expect(claims()).toHaveLength(0);
  await care(); await tick(1399); expect(claims()).toHaveLength(0);
  await tick(1); expectHomeFeedback();
  expect(screen.getByRole("group", { name: "这次睡眠的实际结算" }).textContent).toContain("恢复体力：+14.00");
  const historical = receipt()?.textContent;
  await tick(7999); expectHomeFeedback();
  await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  await key("c"); expect(receipt()?.textContent).toBe(historical);
  expect(feedback()).toBeNull();
  await tick(15000); expect(returning()).toBeNull(); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(1);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
});

it.each([{ kind: "wake", index: 3 }, { kind: "feed", index: 0 }, { kind: "clean", index: 2 }])(
  "C skipping $kind animation still leaves the full feedback interval", async ({ index }) => {
    if (index !== 3) { saved.sleeping = false; pending = false; saved.sleepSession = undefined; }
    await mount(); await care(index); await key("c"); expectHomeFeedback();
    await tick(7999); expectHomeFeedback();
    await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
    expect(actions()).toHaveLength(1);
  },
);

it("allows explicit three-key recap review during feedback instead of locking the reader at home", async () => {
  await mount(); await care(); await key("c"); expectHomeFeedback();
  await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b");
  expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(0);
  await tick(9000); expect(returning()).not.toBeNull();
  await key("c"); expectHomeFeedback();
  await tick(7999); expectHomeFeedback();
  await tick(1); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(1);
});

it("returning from the menu restarts the existing unobscured reading interval", async () => {
  await mount(); await care(); await key("c"); await tick(7000); await key("a");
  await tick(9000); expect(claims()).toHaveLength(0);
  expect(document.querySelector(".content-menu")).not.toBeNull();
  await key("c"); expectHomeFeedback();
  await tick(7999); expectHomeFeedback();
  await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(1);
});

it("background time cannot consume the feedback interval or auto-open the recap", async () => {
  await mount(); await care(); await key("c"); await tick(7000);
  await visibility(true); await tick(20000); expect(claims()).toHaveLength(0);
  await visibility(false); expectHomeFeedback();
  await tick(7999); expectHomeFeedback();
  await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(1);
});

it("without acknowledged action feedback an ordinary awake pending return still opens immediately", async () => {
  saved.sleeping = false; saved.sleepSession = undefined;
  await mount(); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(0); expect(receipt()).toBeNull();
});

it("a pending return first read during existing care feedback waits for the rest of the interval", async () => {
  pending = false; saved.sleeping = false; saved.sleepSession = undefined;
  const implementation = api.getMockImplementation()!;
  api.mockImplementation(async (...args) => {
    const reply = await implementation(...args);
    return args[0] === "action" ? { ...reply, recapPending: false } : reply;
  });
  await mount(); await care(0);
  // The action's response need not yet know about a later return record.
  // Remove it before ending the clip; the next foreground read brings it back.
  pending = false;
  await key("c"); await tick(3000);
  pending = true; await visibility(false); expectHomeFeedback();
  await tick(4999); expectHomeFeedback();
  await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  expect(actions()).toHaveLength(1);
});

it("care that crosses a stage celebrates first, then gives feedback its full interval before return", async () => {
  pending = false; saved.sleeping = false; saved.sleepSession = undefined;
  await mount(); await key("a");
  const before = structuredClone(saved.needs);
  saved.needs.hunger = 54; saved.careCount++; saved.revision++;
  saved.growth = { ...emptyGrowth("growing"), points: 24, growingAt: at };
  pending = true;
  api.mockResolvedValueOnce({ ...result(), careFeedback: {
    kind: "feed", reason: "credited", points: .25, habitGain: 1, habit: "nutrition",
    effect: { at, before, after: structuredClone(saved.needs) },
  } });
  await key("b"); await key("c");
  expect(document.querySelector('.pet-scene[data-motion="celebrating"]')).not.toBeNull();
  await tick(2399); expect(claims()).toHaveLength(0);
  await tick(1); expectHomeFeedback();
  await tick(7999); expectHomeFeedback();
  await tick(1); expect(returning()).not.toBeNull(); expect(claims()).toHaveLength(1);
  expect(saved.growth.stage).toBe("growing"); expect(actions()).toHaveLength(1);
});
