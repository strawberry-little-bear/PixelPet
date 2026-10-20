import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, Shop } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
const kinds = ["snake", "tetris", "fishing", "walk", "treasure"] as const;
type Kind = typeof kinds[number];
const rules: Shop = { catalog: [], dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000 };
let saved: PetState, shop: Shop | undefined;
const response = (): Result => ({ state: structuredClone(saved), shop, message: "", serverTime: Date.now() });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const note = () => screen.getByLabelText("当前游戏奖励额度");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(kind: Kind, phase: "paused" | "local" | "done" = "paused") {
  const now = Date.now(), paused = phase === "paused", done = phase === "done";
  saved = { schema: 16, revision: 1, species: 2, name: "慢慢陪玩", createdAt: now - 10000, hatchedAt: now - 9000,
    lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
    economy: { coins: 12, lastDailyAt: 0, lastGameAt: now, gameCoins: 30, owned: [], equipped: { accessory: "", room: "" } },
    game: { id, kind, startedAt: now, round: 0, score: 0, lastBeat: -1,
      ...(kind === "snake" ? { snake: { body: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], food: { x: 8, y: 6 }, direction: 0, eaten: 0, step: 4, paused, lastMoveAt: now, ...(done ? { end: "wall" as const } : {}) } }
      : kind === "tetris" ? { tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4,5,6,7], lines: 0, pieces: 0, step: 4, paused, lastFallAt: now, ...(done ? { end: "stacked" as const } : {}) } }
      : kind === "fishing" ? { fishing: { spot: 0, casts: done ? 3 : 1, catches: [], phase: done ? "done" as const : "wait" as const, step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: now, paused } }
      : kind === "walk" ? { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: done ? 72 : 25, step: 4, cleared: 0, pose: "" as const, poseUntil: 0, lastPulseAt: now, lastInputAt: 0, paused } }
      : { treasure: { layout: [1,2,3,0,0,0,0,0,0], opened: done ? [3,4,5,6,7,8] : [], step: 4, paused } }) } };
  await act(async () => { render(<App />); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); shop = rules; api.mockReset();
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const action = body as { kind: string };
      if (action.kind.endsWith("-resume")) {
        const game = saved.game!;
        const model = game.snake ?? game.tetris ?? game.fishing ?? game.walking ?? game.treasure!;
        model.paused = false; model.step++; saved.revision++;
      }
    }
    return response();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
for (const kind of kinds) for (const phase of ["paused", "local", "done"] as const) {
  it(`${kind} ${phase}: shows current allowance without playing or promising a payout`, async () => {
    await mount(kind, phase); const before = structuredClone(saved);
    expect(note().textContent).toBe("当前游戏额度为 0；当前不能得币，仍可陪玩。");
    expect(screen.getByLabelText("本局奖励提示").textContent).toContain("基础规则不代表本局一定得币");
    expect(note().hasAttribute("aria-live")).toBe(false);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    expect(writes()).toHaveLength(0); before.revision = saved.revision; expect(saved).toEqual(before);
  });
}
it.each(kinds)("%s: zero allowance does not block resume and the note leaves the active board", async kind => {
  await mount(kind); expect(note()).toBeTruthy(); await key("c");
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: `${kind === "fishing" ? "fish" : kind}-resume`, gameId: id });
  expect(screen.queryByLabelText("本局奖励提示")).toBeNull(); expect(saved.economy?.gameCoins).toBe(30);
});
it("uses newly accepted rules and wallet readings, never assumes missing rules mean zero", async () => {
  await mount("walk"); saved.economy!.gameCoins = 0; saved.economy!.coins = rules.maxCoins!; await refresh();
  expect(note().textContent).toContain("钱包已满");
  saved.economy!.coins--; await refresh(); expect(note().textContent).toContain("钱包还能收 1 币");
  shop = { ...rules, maxCoins: undefined }; await refresh(); expect(note().textContent).toContain("钱包上限待同步");
  // Omitted metadata retains the last accepted rules, as elsewhere in App.
  shop = undefined; await refresh(); expect(note().textContent).toContain("钱包上限待同步");
  expect(writes()).toHaveLength(0);
});
it("hides the note in abandon confirmation without discarding the game", async () => {
  await mount("snake"); await key("b");
  expect(document.querySelector(".game-abandon")).toBeTruthy(); expect(screen.queryByLabelText("本局奖励提示")).toBeNull();
  await key("c"); expect(note()).toBeTruthy(); expect(writes()).toHaveLength(0);
});
