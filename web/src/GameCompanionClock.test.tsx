import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const server = Date.parse("2026-10-20T06:00:00Z"), hour = 3600000, week = 7 * 24 * hour + 1234;
const stages = [{ age: 1, stage: "baby" }, { age: 30, stage: "growing" }, { age: 80, stage: "adult" }] as const;
type Kind = "snake" | "tetris";
let saved: PetState, servedAt: number;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: servedAt, message: "" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const stage = (kind: Kind) => document.querySelector(`.${kind}-pet [data-rig-stage]`)?.getAttribute("data-rig-stage");
function fixture(kind: Kind, age: number): PetState {
  return { schema: 17, revision: 10, species: 2, name: "同一只时间伙伴", createdAt: server - age * hour - 1000,
    hatchedAt: server - age * hour, lastTick: server, sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [],
    game: { id: "0123456789abcdef0123456789abcdef", kind, startedAt: server, round: 0, score: 0, lastBeat: -1,
      ...(kind === "snake" ? { snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
        food: { x: 9, y: 9 }, eaten: 0, step: 0, direction: 0, paused: true, lastMoveAt: server } }
        : { tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1,
          bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: server } }),
    } };
}
async function mount() { await act(async () => { render(<App />); }); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(server); servedAt = server; localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  api.mockImplementation(async () => reply());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

for (const kind of ["snake", "tetris"] as const) {
  for (const profile of stages) {
    for (const skew of [-week, 0, week]) it(`${kind} legacy ${profile.stage} uses accepted time on initial load (skew ${skew})`, async () => {
      saved = fixture(kind, profile.age); const before = structuredClone(saved);
      vi.setSystemTime(server + skew); await mount();
      expect(stage(kind)).toBe(profile.stage);
      expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
      expect(document.querySelectorAll(".lcd button,.lcd input,.lcd a")).toHaveLength(0);
      expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
    });
    for (const direction of [-1, 1]) it(`${kind} legacy ${profile.stage} ignores mid-session ${direction} week wall-clock jump`, async () => {
      saved = fixture(kind, profile.age); const before = structuredClone(saved); await mount();
      expect(stage(kind)).toBe(profile.stage);
      vi.setSystemTime(server + direction * week); await tick();
      expect(stage(kind)).toBe(profile.stage); expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
    });
    it(`${kind} never replaces authoritative ${profile.stage} with an age or browser estimate`, async () => {
      saved = fixture(kind, 80); saved.growth = emptyGrowth(profile.stage);
      saved.growth.points = { baby: 1, growing: 30, adult: 72 }[profile.stage];
      if (profile.stage === "adult") saved.growth.form = "gentle";
      const before = structuredClone(saved); vi.setSystemTime(server - week); await mount();
      expect(stage(kind)).toBe(profile.stage); vi.setSystemTime(server + week); await tick();
      expect(stage(kind)).toBe(profile.stage); expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
    });
  }
  it(`${kind} uses a newly accepted server clock immediately, but rejects a stale revision`, async () => {
    saved = fixture(kind, 1); await mount(); expect(stage(kind)).toBe("baby");
    servedAt = server + 30 * hour; saved.lastTick = servedAt; saved.revision++;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(stage(kind)).toBe("growing");
    servedAt = server - hour; saved.lastTick = servedAt; saved.revision--;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); await tick();
    expect(stage(kind)).toBe("growing"); expect(writes()).toHaveLength(0);
  });
}
