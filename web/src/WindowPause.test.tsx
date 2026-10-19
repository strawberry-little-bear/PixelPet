import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
const games = ["snake", "tetris", "fishing", "walk"] as const;
type Kind = typeof games[number];
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const actions = () => api.mock.calls.filter(([p]) => p === "action").map(([, b]) => b as { kind: string; step: number; gameId: string; turn?: number });
const prefix = (kind: Kind) => kind === "fishing" ? "fish" : kind;
const overlay = (kind: Kind) => document.querySelector({ snake: ".snake-overlay", tetris: ".tetris-overlay", fishing: ".fishing-pause", walk: ".walk-pause" }[kind]);
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function focus(type: "blur" | "focus") { await act(async () => { window.dispatchEvent(new Event(type)); }); }
async function mount(kind: Kind, bite = false, ready = false) {
  const common = { id, kind, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
  if (kind === "snake") saved.game = { ...common, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, eaten: 0, step: 0, direction: 0, paused: true, lastMoveAt: Date.now() } };
  if (kind === "tetris") saved.game = { ...common, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: Date.now() } };
  if (kind === "fishing") saved.game = { ...common, fishing: { spot: 0, casts: ready ? 0 : 1, catches: [], phase: ready ? "ready" : bite ? "bite" : "wait", step: 0, waitMs: 32000, elapsedMs: 0, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } };
  if (kind === "walk") saved.game = { ...common, walking: { route: Array<"rock" | "branch">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 0, step: 0, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } };
  await act(async () => { render(<App />); });
}
function apply(body: unknown) {
  const a = body as { kind: string; step: number; gameId: string };
  const g = saved.game!, n = g.snake ?? g.tetris ?? g.fishing ?? g.walking!;
  expect(a.gameId).toBe(id); expect(a.step).toBe(n.step);
  n.paused = a.kind.endsWith("-pause");
  if (!g.snake || a.kind === "snake-step") n.step++;
  if (g.snake) g.snake.lastMoveAt = Date.now();
  if (g.tetris) g.tetris.lastFallAt = Date.now();
  if (g.fishing) {
    g.fishing.lastPulseAt = Date.now();
    if (a.kind === "fish-cast") { g.fishing.phase = "wait"; g.fishing.casts++; }
    if (a.kind === "fish-step") g.fishing.elapsedMs += 1050;
  }
  if (g.walking) { g.walking.lastPulseAt = Date.now(); if (a.kind === "walk-step") g.walking.beat++; }
  saved.revision++;
}
function delay(kind: string) {
  let deliver!: () => void;
  api.mockImplementation(async (path, body) => {
    if (path !== "action") return result();
    apply(body); const reply = result();
    if ((body as { kind: string }).kind !== kind) return reply;
    return new Promise<Result>(resolve => { deliver = () => resolve(reply); });
  });
  return async () => { expect(deliver).toBeTypeOf("function"); await act(async () => { deliver(); }); };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 12, revision: 1, species: 2, name: "窗口暂停测试", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth(), logs: [] };
  api.mockImplementation(async (path, body) => { if (path === "action") apply(body); return result(); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(games)("visible-window pause for %s", kind => {
  it("stops running beats on blur, preserves the board and requires a fresh key", async () => {
    await mount(kind); await key("c"); await clock(1100);
    expect(actions().some(a => a.kind === `${prefix(kind)}-step`)).toBe(true);
    if (kind === "snake") await key("a"); // An old queued turn must not survive the pause.
    const count = actions().length, board = structuredClone(saved.game);
    await focus("blur"); expect(document.hidden).toBe(false);
    await clock(3000); expect(actions()).toHaveLength(count);
    await focus("focus"); await clock(3000);
    expect(actions()).toHaveLength(count); expect(saved.game).toEqual(board); expect(overlay(kind)).toBeTruthy();
    await key("c"); await clock(1100);
    expect(actions().at(-1)?.kind).toBe(`${prefix(kind)}-step`);
    if (kind === "snake") expect(actions().filter(a => a.kind === "snake-step").at(-1)?.turn).toBe(0);
    expect(saved.careCount).toBe(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  });
  it("guards an already-due callback before React has flushed the blur render", async () => {
    await mount(kind); await key("c"); const count = actions().length;
    await act(async () => { window.dispatchEvent(new Event("blur")); vi.advanceTimersByTime(1100); });
    expect(actions()).toHaveLength(count); expect(overlay(kind)).toBeTruthy();
  });
  it("invalidates an old due callback even if blur and focus arrive before React flushes", async () => {
    await mount(kind); await key("c"); const count = actions().length;
    await act(async () => {
      window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(1100);
    });
    expect(actions()).toHaveLength(count); expect(overlay(kind)).toBeTruthy();
    await key("c"); await clock(1100);
    expect(actions().at(-1)?.kind).toBe(`${prefix(kind)}-step`);
  });
  it.each([false, true])("keeps an accepted beat without running the next after blur (return first=%s)", async returnFirst => {
    await mount(kind); await key("c"); const deliver = delay(`${prefix(kind)}-step`);
    await clock(1100); const committed = structuredClone(saved.game), count = actions().length;
    await focus("blur"); if (returnFirst) await focus("focus");
    await deliver(); if (!returnFirst) await focus("focus");
    await clock(3000);
    expect(actions()).toHaveLength(count); expect(saved.game).toEqual(committed); expect(overlay(kind)).toBeTruthy();
    api.mockImplementation(async (path, body) => { if (path === "action") apply(body); return result(); });
    await key("c"); await clock(1100); expect(actions().at(-1)?.kind).toBe(`${prefix(kind)}-step`);
  });
  it("does not treat focus moving between physical buttons as window departure", async () => {
    await mount(kind); await key("c");
    await act(async () => {
      const a = screen.getByRole("button", { name: "A 选择" }), b = screen.getByRole("button", { name: "B 确认" });
      a.focus(); a.dispatchEvent(new FocusEvent("blur", { bubbles: true })); b.focus();
    });
    await clock(1100); expect(actions().at(-1)?.kind).toBe(`${prefix(kind)}-step`);
  });
});

for (const kind of ["fishing", "walk"] as const) {
  it.each([false, true])(`${kind} late resume cannot authorize beats across blur (return first=%s)`, async returnFirst => {
    await mount(kind); const deliver = delay(`${prefix(kind)}-resume`); await key("c");
    await focus("blur"); if (returnFirst) await focus("focus");
    await deliver(); if (!returnFirst) await focus("focus");
    await clock(3000); expect(actions()).toHaveLength(1); expect(overlay(kind)).toBeTruthy();
    api.mockImplementation(async (path, body) => { if (path === "action") apply(body); return result(); });
    await key("c"); await clock(1100); expect(actions().at(-1)?.kind).toBe(`${prefix(kind)}-step`);
  });
}
it.each([false, true])("late cast stays locally paused across blur (return first=%s)", async returnFirst => {
  await mount("fishing", false, true); await key("c"); const deliver = delay("fish-cast"); await key("b");
  await focus("blur"); if (returnFirst) await focus("focus");
  await deliver(); if (!returnFirst) await focus("focus");
  await clock(3000); expect(actions().map(a => a.kind)).toEqual(["fish-resume", "fish-cast"]); expect(overlay("fishing")).toBeTruthy();
});
it("does not consume a bite window while the visible window is unfocused", async () => {
  await mount("fishing", true); await key("c"); const elapsed = saved.game!.fishing!.elapsedMs;
  await focus("blur"); await clock(12000); await focus("focus"); await clock(1000);
  expect(saved.game!.fishing!.elapsedMs).toBe(elapsed); expect(overlay("fishing")).toBeTruthy();
});
