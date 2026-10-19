import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "1".repeat(32), token = "a".repeat(32);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: token, message: "", serverTime: Date.now() });
const actions = () => api.mock.calls.filter(([path]) => path === "action").map(([, body]) => body as { kind: string; step: number; gameId: string });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function applyAction(body: unknown) {
  const action = body as { kind: string; step: number; gameId: string }, n = saved.game!.fishing!;
  expect(action.gameId).toBe(saved.game!.id); expect(action.step).toBe(n.step);
  if (action.kind === "fish-resume") { n.paused = false; n.lastPulseAt = Date.now(); }
  else if (action.kind === "fish-step") { n.elapsedMs += 1050; n.lastPulseAt = Date.now(); }
  else if (action.kind === "fish-pause") n.paused = true;
  else throw new Error(`Unexpected action ${action.kind}`);
  n.step++; saved.revision++;
}
async function mount(phase: "wait" | "bite") {
  saved.game = { kind: "fishing", id, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1,
    fishing: { spot: 0, casts: 1, catches: [], phase, step: 1, waitMs: 32000, elapsedMs: 1000,
      candidate: "reed-minnow", lastPulseAt: Date.now(), paused: false } };
  await act(async () => { render(<App />); }); await key("c");
  expect(actions().map(a => a.kind)).toEqual(["fish-resume"]);
}
// Leave a real pending promise across renders. An immediate rejection can be
// batched with setBusy(true), concealing the timer-restart bug under test.
async function pendingPulse(readFailure = false) {
  const normal = api.getMockImplementation()!; let failRead = readFailure;
  let resolve!: (reply: Result) => void, reject!: (error: unknown) => void;
  api.mockImplementation((...args) => {
    if (args[0] === "action" && (args[1] as { kind: string }).kind === "fish-step") {
      return new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
    }
    if (failRead) { failRead = false; return Promise.reject(new RequestFailure("read unavailable", "unavailable")); }
    return normal(...args);
  });
  await clock(1100); expect(actions().map(a => a.kind)).toEqual(["fish-resume", "fish-step"]);
  return { normal, reject: async (error: unknown) => { await act(async () => { reject(error); }); },
    resolve: async (reply: Result) => { await act(async () => { resolve(reply); }); } };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 10, species: 3, name: "钓鱼恢复", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth(),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [],
    pond: { since: Date.now() - 10000, fish: [] } };
  api.mockImplementation(async (path, body) => { if (path === "action") applyAction(body); return result(); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(["wait", "bite"] as const)("failed foreground pulse in %s", phase => {
  it.each(["rejected", "unknown", "stale"] as const)("stops after %s outcome, syncs once, and only a fresh key resumes", async outcome => {
    await mount(phase); const pending = await pendingPulse();
    const readStart = api.mock.calls.length, before = structuredClone(saved.game!.fishing!);
    if (outcome === "unknown") applyAction(actions().at(-1)); // committed, response lost
    if (outcome === "stale") { const old = result(); old.state.revision -= 2; await pending.resolve(old); }
    else await pending.reject(new RequestFailure("pulse failed", outcome));
    expect(api.mock.calls.slice(readStart).map(([path]) => path)).toEqual([outcome === "rejected" ? "visit" : "state"]);
    const settled = structuredClone(saved.game!.fishing!);
    expect(settled.casts).toBe(before.casts); expect(settled.catches).toEqual(before.catches);
    expect(settled.elapsedMs).toBe(before.elapsedMs + (outcome === "unknown" ? 1050 : 0));
    await clock(6000); expect(actions()).toHaveLength(2); expect(saved.game!.fishing).toEqual(settled);
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    api.mockImplementation(pending.normal); await key("c");
    expect(actions().at(-1)).toMatchObject({ kind: "fish-resume", step: settled.step, gameId: id });
    await clock(1100); expect(actions().at(-1)).toMatchObject({ kind: "fish-step", step: settled.step + 1 });
    expect(saved.careCount).toBe(0); expect(saved.pond!.fish).toHaveLength(0);
  });
  it.each(["rejected", "unknown"] as const)("keeps %s stopped through an unavailable read; B only reads, C continues", async outcome => {
    await mount(phase); const pending = await pendingPulse(true);
    if (outcome === "unknown") applyAction(actions().at(-1));
    await pending.reject(new RequestFailure("pulse failed", outcome));
    expect(document.querySelector(".save-recovery")).toBeTruthy();
    await clock(3000); await key("a"); await key("c"); expect(actions()).toHaveLength(2);
    api.mockImplementation(pending.normal); await key("b");
    expect(api.mock.calls.at(-1)?.[0]).toBe(outcome === "unknown" ? "state" : "visit"); expect(actions()).toHaveLength(2);
    expect(screen.getByText("池塘已暂停")).toBeTruthy(); await clock(2000); expect(actions()).toHaveLength(2);
    await key("c"); await clock(1100); expect(actions().at(-1)?.kind).toBe("fish-step");
  });
  it("uses another window's current step instead of resending the obsolete pulse", async () => {
    await mount(phase); const pending = await pendingPulse();
    saved.game!.fishing!.step += 4; saved.game!.fishing!.elapsedMs += 1000; saved.revision++;
    await pending.reject(new RequestFailure("stale step", "rejected"));
    const expected = saved.game!.fishing!.step;
    await clock(5000); expect(actions()).toHaveLength(2);
    api.mockImplementation(pending.normal); await key("c");
    expect(actions().at(-1)).toMatchObject({ kind: "fish-resume", step: expected });
  });
  it("accepts another window's terminal result without automatically collecting or discarding it", async () => {
    await mount(phase); const pending = await pendingPulse();
    Object.assign(saved.game!.fishing!, { phase: "done", casts: 3, step: 20 }); saved.revision++;
    await pending.reject(new RequestFailure("stale step", "rejected")); await clock(6000);
    expect(actions()).toHaveLength(2); expect(saved.game!.fishing!.phase).toBe("done");
    expect(screen.getByText(/三竿完成/)).toBeTruthy(); expect(saved.careCount).toBe(0);
  });
});
