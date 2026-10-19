import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), token = "a".repeat(32), first = "1".repeat(32);
const kinds = ["stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure"] as const;
type Kind = typeof kinds[number];
let saved: PetState, recap: ReturnRecap, pending: boolean;
let finish: (r: Result) => void, fail: (e: unknown) => void;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: token, message: "", serverTime: Date.now(), returnRecap: structuredClone(recap), recapPending: pending });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset"].includes(p));
const claims = () => api.mock.calls.filter(([p]) => p === "recap/read");
async function complete(r = result()) { await act(async () => { finish(r); }); }
async function review() { await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b"); }
function game(kind: Kind, id = first): NonNullable<PetState["game"]> {
  const common = { id, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
  switch (kind) {
    case "stars": return common;
    case "tiles": return { ...common, kind, tiles: { board: [1, 1, 2, 2], pick: -1, pairs: 0, shuffles: 0 } };
    case "snake": return { ...common, kind, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, direction: 0, eaten: 0, step: 0, lastMoveAt: Date.now(), paused: true } };
    case "tetris": return { ...common, kind, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, lastFallAt: Date.now(), paused: true } };
    case "fishing": return { ...common, kind, fishing: { spot: 0, casts: 0, catches: [], phase: "ready", step: 0, waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: Date.now(), paused: true } };
    case "walk": return { ...common, kind, walking: { route: Array(12).fill("rock"), souvenirs: [], beat: 0, step: 0, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } };
    case "treasure": return { ...common, kind, treasure: { layout: [1, 2, 3, 0, 0, 0, 0, 0, 0], opened: [], step: 0, paused: true } };
  }
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); pending = true;
  saved = { schema: 16, revision: 10, species: 2, name: "回访同步", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
  recap = { id: "recap-before-claim", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
  api.mockImplementation(async path => {
    if (path === "recap/read") return new Promise<Result>((resolve, reject) => { finish = resolve; fail = reject; });
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a recap acknowledgement is also a current state read", () => {
  it.each(kinds)("routes the %s started before the claim response and never starts it automatically", async kind => {
    await mount(); expect(claims()).toHaveLength(1);
    saved.game = game(kind); saved.revision++; await complete();
    expect(document.querySelector(".content-game")).toBeTruthy();
    expect(document.querySelector(".return-panel")).toBeNull();
    await poll(); expect(document.querySelector(".content-game")).toBeTruthy();
    expect(writes()).toHaveLength(0); expect(claims()).toHaveLength(1);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  });
});

describe("late recap replies retain data without hijacking presentation", () => {
  it.each(["snake", "tetris", "fishing", "walk", "treasure"] as const)("routes a new terminal %s without collecting its reward", async kind => {
    await mount(); saved.game = game(kind); saved.revision++;
    if (kind === "snake") saved.game.snake!.end = "wall";
    if (kind === "tetris") { saved.game.tetris!.end = "won"; saved.game.tetris!.lines = 8; saved.game.tetris!.active = undefined; }
    if (kind === "fishing") { saved.game.fishing!.phase = "done"; saved.game.fishing!.casts = 3; }
    if (kind === "walk") saved.game.walking!.beat = 72;
    if (kind === "treasure") { saved.game.treasure!.opened = [3, 4, 5, 6, 7, 8]; saved.game.treasure!.paused = true; saved.game.treasure!.step++; }
    await complete(); expect(document.querySelector(".content-game")).toBeTruthy();
    expect(document.querySelector(".return-panel")).toBeNull(); await poll(); expect(writes()).toHaveLength(0);
  });
  it.each([false, true])("opening help while waiting cancels automatic presentation (close first=%s)", async closeFirst => {
    await mount(); fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    if (closeFirst) fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    pending = false; await complete({ ...result(), recapClaimed: true });
    expect(document.querySelector(".return-panel")).toBeNull();
    if (!closeFirst) { expect(screen.queryByRole("dialog")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: /^关闭$/ })); }
    await poll(); expect(document.querySelector(".content-home")).toBeTruthy();
    await review(); expect(document.querySelector(".return-panel")).toBeTruthy(); expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it.each([false, true])("opening the toolbox cancels automatic presentation (close first=%s)", async closeFirst => {
    await mount(); fireEvent.click(screen.getByRole("button", { name: /存档盒/ }));
    if (closeFirst) fireEvent.click(screen.getByRole("button", { name: /存档盒/ }));
    pending = false; await complete({ ...result(), recapClaimed: true });
    expect(document.querySelector(".return-panel")).toBeNull();
    if (!closeFirst) { expect(document.querySelector(".tools-menu")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); }
    await poll(); await review(); expect(document.querySelector(".return-panel")).toBeTruthy(); expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it.each([false, true])("backgrounding cancels automatic presentation even after returning (return first=%s)", async returnFirst => {
    await mount(); const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      if (returnFirst) { hidden.mockReturnValue(false); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
      pending = false; await complete({ ...result(), recapClaimed: true }); expect(document.querySelector(".return-panel")).toBeNull();
      hidden.mockReturnValue(false); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await review(); expect(document.querySelector(".return-panel")).toBeTruthy(); expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
    } finally { hidden.mockRestore(); }
  });
  it("rejects an older successful claim and B only reads; it never replays the claim", async () => {
    await mount(); const stale = result(); stale.state.revision--; stale.recapClaimed = true; stale.recapPending = false;
    await complete(stale); expect(document.querySelector(".return-panel")).toBeNull();
    expect(document.querySelector(".save-recovery")).toBeTruthy(); pending = false; saved.revision++;
    await key("b"); expect(api.mock.calls.at(-1)?.[0]).toBe("state"); expect(document.querySelector(".content-home")).toBeTruthy();
    await poll(); expect(claims()).toHaveLength(1); await review(); expect(document.querySelector(".return-panel")).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it("a fresh response without a recap clears the old card", async () => {
    await mount(); const cleared = result(); delete cleared.returnRecap; cleared.recapPending = false; saved.revision++; cleared.state.revision++;
    await complete(cleared); expect(document.querySelector(".return-panel")).toBeNull();
    await review(); expect(document.querySelector(".return-panel")).toBeNull(); expect(document.querySelector(".toast")?.textContent).toContain("还没有回访小结");
  });
  it("a legacy lifecycle replacement in a current claim reply routes to the egg", async () => {
    await mount(); saved.hatchedAt = 0; saved.revision++; saved.growth = emptyGrowth("egg");
    const cleared = result(); delete cleared.returnRecap; delete cleared.saveGeneration; cleared.recapPending = false;
    await complete(cleared); expect(document.querySelector(".content-choose")).toBeTruthy();
    await key("b"); expect(document.querySelector(".content-hatch")).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it("a sleep guard defers the recap and the next accepted wake can present it once", async () => {
    await mount(); saved.sleeping = true; saved.revision++; await complete();
    expect(document.querySelector(".content-home")).toBeTruthy(); expect(document.querySelector(".return-panel")).toBeNull(); await poll(); expect(claims()).toHaveLength(1);
    saved.sleeping = false; saved.revision++; await poll(); expect(claims()).toHaveLength(2);
    pending = false; await complete({ ...result(), recapClaimed: true }); expect(document.querySelector(".return-panel")).toBeTruthy();
    await key("c"); await poll(); expect(claims()).toHaveLength(2); expect(writes()).toHaveLength(0);
  });
  it.each(["unknown", "rejected"] as const)("a failed acknowledgement remains recoverable (%s)", async failure => {
    await mount(); await act(async () => { fail(new RequestFailure("network", failure)); });
    expect(document.querySelector(".return-panel")).toBeNull();
    if (failure === "unknown") {
      expect(document.querySelector(".save-recovery")).toBeTruthy(); pending = false; await key("b");
      expect(api.mock.calls.at(-1)?.[0]).toBe("state"); await review(); expect(document.querySelector(".return-panel")).toBeTruthy(); expect(claims()).toHaveLength(1);
    } else {
      await poll(); expect(claims()).toHaveLength(2); pending = false; await complete({ ...result(), recapClaimed: true }); expect(document.querySelector(".return-panel")).toBeTruthy();
    }
    expect(writes()).toHaveLength(0);
  });
});
