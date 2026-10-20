import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

// Exercise the real request parser, not a mocked RequestFailure from the API.
let saved: PetState;
let broken: "" | "visit" | "state" | "action";
let damage: (result: Result) => unknown;
let committed: boolean;
const calls: string[] = [];
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const writes = () => calls.filter(path => ["action", "import", "reset"].includes(path));
const recovery = () => document.querySelector(".save-recovery");
const scene = () => document.querySelector(".pet-scene")?.getAttribute("data-motion");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
const returnHistory = (r: Result) => {
  const snapshot = { needs: r.state.needs, stage: "baby", form: "", points: 1, rest: 0, trackedHours: 1 };
  return { id: "return", from: r.serverTime - 1800000, to: r.serverTime, before: snapshot, after: snapshot };
};
const damagedFishing = (r: Result, catches: unknown) => ({ ...r, state: { ...r.state,
  game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing", startedAt: r.serverTime,
    round: 0, score: 0, lastBeat: -1, fishing: { spot: 0, casts: 0, catches, phase: "ready", step: 0,
      waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: r.serverTime, paused: true } } } });
const corruptions = [
  ["damaged tiles model", (r: Result) => ({ ...r, state: { ...r.state, game: { id: "0123456789abcdef0123456789abcdef", kind: "tiles", startedAt: r.serverTime, round: 0, score: 0, lastBeat: -1, tiles: { board: null, pick: -1, pairs: 0, shuffles: 0 } } } })],
  ["damaged snake model", (r: Result) => ({ ...r, state: { ...r.state, game: { id: "0123456789abcdef0123456789abcdef", kind: "snake", startedAt: r.serverTime, round: 0, score: 0, lastBeat: -1, snake: { body: null } } } })],
  ["damaged tetris model", (r: Result) => ({ ...r, state: { ...r.state, game: { id: "0123456789abcdef0123456789abcdef", kind: "tetris", startedAt: r.serverTime, round: 0, score: 0, lastBeat: -1, tetris: { board: null } } } })],
  ["damaged walk model", (r: Result) => ({ ...r, state: { ...r.state, game: { id: "0123456789abcdef0123456789abcdef", kind: "walk", startedAt: r.serverTime, round: 0, score: 0, lastBeat: -1, walking: { route: null } } } })],
  ["object stars score", (r: Result) => ({ ...r, state: { ...r.state, game: { startedAt: r.serverTime, round: 0, score: {}, lastBeat: -1 } } })],
  ["object active catches", (r: Result) => damagedFishing(r, {})],
  ["string active catches", (r: Result) => damagedFishing(r, "empty")],
  ["null active catch", (r: Result) => damagedFishing(r, [null])],
  ["unknown active fish", (r: Result) => damagedFishing(r, ["made-up"])],
  ["object fish entries", (r: Result) => ({ ...r, state: { ...r.state, pond: { since: r.serverTime, fish: {} } } })],
  ["null fish record", (r: Result) => ({ ...r, state: { ...r.state, pond: { since: r.serverTime, fish: [null] } } })],
  ["unsafe fish count", (r: Result) => ({ ...r, state: { ...r.state, pond: { since: r.serverTime, fish: [{ id: "reed-minnow", firstAt: r.serverTime, lastAt: r.serverTime, count: "two" }] } } })],
  ["object park entries", (r: Result) => ({ ...r, state: { ...r.state, park: { since: r.serverTime, finds: {}, walks: 0, lastWalkAt: 0 } } })],
  ["null park record", (r: Result) => ({ ...r, state: { ...r.state, park: { since: r.serverTime, finds: [null], walks: 0, lastWalkAt: 0 } } })],
  ["unsafe park date", (r: Result) => ({ ...r, state: { ...r.state, park: { since: r.serverTime, finds: [{ id: "leaf", firstAt: r.serverTime, lastAt: 8640000000000001, count: 1 }], walks: 0, lastWalkAt: 0 } } })],
  ["object album entries", (r: Result) => ({ ...r, state: { ...r.state, album: { since: r.serverTime, legacy: false, entries: {} } } })],
  ["invalid memory date", (r: Result) => ({ ...r, state: { ...r.state, album: { since: r.serverTime, legacy: false, entries: [{ kind: "meal", at: 8640000000000001, source: "shared" }] } } })],
  ["null memory", (r: Result) => ({ ...r, state: { ...r.state, album: { since: r.serverTime, legacy: false, entries: [null] } } })],
  ["missing needs", (r: Result) => ({ ...r, state: { ...r.state, needs: null } })],
  ["non-array logs", (r: Result) => ({ ...r, state: { ...r.state, logs: {} } })],
  ["object name", (r: Result) => ({ ...r, state: { ...r.state, name: { invalid: true } } })],
  ["missing growth habits", (r: Result) => ({ ...r, state: { ...r.state, growth: { ...r.state.growth, care: null } } })],
  ["malformed form record", (r: Result) => ({ ...r, state: { ...r.state, growth: { ...r.state.growth, formRecord: [] } } })],
  ["non-numeric care reward", (r: Result) => ({ ...r, careFeedback: { kind: "feed", reason: "credited", points: "1", habitGain: 1, habit: "nutrition" } })],
  ["object care reason", (r: Result) => ({ ...r, careFeedback: { kind: "feed", reason: {}, points: .25, habitGain: 1, habit: "nutrition" } })],
  ["invalid return date", (r: Result) => ({ ...r, returnRecap: { ...returnHistory(r), from: 8640000000000001 }, recapPending: true })],
  ["invalid return needs", (r: Result) => ({ ...r, returnRecap: { ...returnHistory(r), before: { ...returnHistory(r).before, needs: null } }, recapPending: true })],
  ["incomplete core", (r: Result) => ({ ...r, state: { revision: r.state.revision, lastTick: r.state.lastTick } })],
] as const;

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); calls.length = 0; broken = ""; committed = false;
  saved = { schema: 12, revision: 2, species: 2, name: "草莓兔", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0,
    growth: emptyGrowth("baby"), logs: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.replace("/api/", ""); calls.push(path);
    if (path === "action" && (broken !== "action" || committed)) {
      saved.needs.hunger = Math.min(100, saved.needs.hunger + 20);
      saved.careCount++; saved.revision++;
      // A saved stage change may not become a late celebration after recovery.
      if (broken === "action") saved.growth!.stage = "growing";
    }
    const r = result();
    return new Response(JSON.stringify(path === broken ? damage(r) : r));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(corruptions)("initial %s leaves B recovery usable instead of crashing", async (_, corrupt) => {
  broken = "visit"; damage = corrupt; await mount();
  expect(recovery()?.textContent).toContain("还没有读到存档");
  expect(screen.getByRole("button", { name: "B 确认" })).toHaveProperty("disabled", false);
  await key("a"); await key("c"); expect(writes()).toHaveLength(0);
  broken = ""; await key("b");
  expect(recovery()).toBeNull(); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(0);
});
it.each(corruptions)("a polled %s never replaces the last readable pet", async (_, corrupt) => {
  await mount(); broken = "visit"; damage = corrupt;
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(recovery()?.textContent).toContain("小窝暂时未连接");
  expect(screen.getByRole("alert").textContent).not.toContain("可能已经保存");
  broken = ""; await key("b");
  expect(scene()).toBe("idle"); expect(writes()).toHaveLength(0);
});
for (const wasCommitted of [false, true]) {
  it.each(corruptions)(`a meal reply with %s requires read-only reconciliation (committed=${wasCommitted})`, async (_, corrupt) => {
    await mount(); broken = "action"; damage = corrupt; committed = wasCommitted;
    await key("a"); await key("b");
    expect(recovery()).toBeTruthy(); expect(scene()).toBeUndefined();
    expect(screen.getByRole("alert").textContent).toContain("可能已经保存");
    expect(document.querySelector(".growth-feedback.has-feedback,.care-outcome")).toBeNull();
    await key("a"); await key("c"); expect(writes()).toHaveLength(1);
    // A second incomplete reply cannot unlock an unknown action result.
    broken = "state"; await key("b"); expect(recovery()).toBeTruthy();
    expect(calls.at(-1)).toBe("state"); expect(writes()).toHaveLength(1);
    broken = ""; await key("b");
    expect(recovery()).toBeNull(); expect(scene()).toBe("idle");
    expect(saved.careCount).toBe(wasCommitted ? 1 : 0);
    expect(document.querySelector(".growth-feedback.has-feedback,.care-outcome")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("没有自动重试");
    expect(writes()).toHaveLength(1);
    await key("a"); await key("b");
    expect(writes()).toHaveLength(2); expect(saved.careCount).toBe(wasCommitted ? 2 : 1);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  });
}
