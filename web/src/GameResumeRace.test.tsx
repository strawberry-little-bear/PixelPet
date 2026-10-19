import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const actions = () => api.mock.calls.filter(([p]) => p === "action").map(([, b]) => b as { kind: string; step: number; gameId: string });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount(kind: "snake" | "tetris", paused = true) {
  const common = { id, kind, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
  saved.game = kind === "snake" ? { ...common, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, eaten: 0, step: 0, direction: 0, paused, lastMoveAt: Date.now() } }
    : { ...common, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused, lastFallAt: Date.now() } };
  await act(async () => { render(<App />); });
}
function applyAction(body: unknown) {
  const a = body as { kind: string; step: number };
  const n = saved.game?.snake ?? saved.game?.tetris;
  if (!n) return;
  expect(a.step).toBe(n.step);
  n.paused = a.kind.endsWith("-pause");
  if (saved.game?.snake) saved.game.snake.lastMoveAt = Date.now();
  if (saved.game?.tetris) saved.game.tetris.lastFallAt = Date.now();
  if (saved.game?.tetris || a.kind === "snake-step") n.step++;
  saved.revision++;
}
function delayAction(kind: string) {
  let deliver!: () => void;
  api.mockImplementation(async (path, body) => {
    if (path !== "action") return result();
    applyAction(body);
    if ((body as { kind: string }).kind !== kind) return result();
    const reply = result();
    return new Promise<Result>(resolve => { deliver = () => resolve(reply); });
  });
  return async () => { expect(deliver).toBeTypeOf("function"); await act(async () => { deliver(); }); };
}
type Interruption = "background" | "help" | "tools" | "window-blur";
async function interrupt(kind: Interruption) {
  if (kind === "window-blur") {
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    return async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); };
  }
  if (kind === "background") {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    return async () => { hidden.mockReturnValue(false); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); };
  }
  const button = screen.getByRole("button", { name: kind === "help" ? "玩法说明" : /存档盒/ });
  await act(async () => { fireEvent.click(button); });
  return async () => { await act(async () => { if (kind === "help") fireEvent.keyDown(document, { key: "Escape" }); else fireEvent.click(button); }); };
}
async function select(kind: string) {
  if (kind === "snake-resume") { await key("a"); return; }
  const choice = ["tetris-resume", "tetris-rotate", "tetris-drop"].indexOf(kind);
  for (let i = 0; i < choice; i++) await key("a");
  await key("b");
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 1, species: 2, name: "恢复测试伙伴", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth(), logs: [] };
  api.mockImplementation(async (path, body) => { if (path === "action") applyAction(body); return result(); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const interruptions: Interruption[] = ["background", "help", "tools", "window-blur"];
const resumptions = ["snake-resume", "tetris-resume", "tetris-rotate", "tetris-drop"];
describe.each(resumptions)("late %s response", kind => {
  it.each(interruptions.flatMap(interruption => [false, true].map(returnFirst => ({ interruption, returnFirst }))))("does not resume after $interruption (return first=$returnFirst)", async ({ interruption, returnFirst }) => {
    await mount(kind.startsWith("snake") ? "snake" : "tetris");
    const deliver = delayAction(kind); await select(kind);
    expect(actions().map(a => a.kind)).toEqual([kind]);
    const restore = await interrupt(interruption);
    if (returnFirst) await restore();
    await deliver();
    if (!returnFirst) await restore();
    await clock(2500);
    expect(actions().map(a => a.kind)).toEqual([kind]);
    expect(document.querySelector(kind.startsWith("snake") ? ".snake-overlay" : ".tetris-overlay")).toBeTruthy();
    // The committed board remains, but a fresh A/B/C decision is required.
    api.mockImplementation(async (path, body) => { if (path === "action") applyAction(body); return result(); });
    await key("c"); await clock(1100);
    expect(actions().some(a => a.kind === (kind.startsWith("snake") ? "snake-step" : "tetris-step"))).toBe(true);
    expect(actions().every(a => a.gameId === id)).toBe(true);
  });
});

describe.each(["tetris-rotate", "tetris-drop"])("local pause before %s", kind => {
  it.each(interruptions.flatMap(interruption => [false, true].map(returnFirst => ({ interruption, returnFirst }))))("does not send the second operation across $interruption (return first=$returnFirst)", async ({ interruption, returnFirst }) => {
    await mount("tetris", false); const deliver = delayAction("tetris-pause"); await select(kind);
    expect(actions().map(a => a.kind)).toEqual(["tetris-pause"]);
    const restore = await interrupt(interruption); if (returnFirst) await restore();
    await deliver(); if (!returnFirst) await restore(); await clock(2500);
    expect(actions().map(a => a.kind)).toEqual(["tetris-pause"]);
    expect(document.querySelector(".tetris-overlay")).toBeTruthy();
  });
  it("still pauses then performs the selected operation without an interruption", async () => {
    await mount("tetris", false); await select(kind);
    expect(actions().map(a => a.kind)).toEqual(["tetris-pause", kind]);
    await clock(1100); expect(actions().at(-1)?.kind).toBe("tetris-step");
  });
});
