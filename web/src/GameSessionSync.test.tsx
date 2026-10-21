import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), token = "a".repeat(32), first = "1".repeat(32), second = "2".repeat(32);
const kinds = ["stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure"] as const;
type Kind = typeof kinds[number];
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: token, message: "", serverTime: Date.now() });
const actions = () => api.mock.calls.filter(([p]) => p === "action").map(([, b]) => b as { kind: string; gameId: string });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function poll() { await clock(15000); }
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
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
async function abandon(kind: Kind) {
  if (kind === "stars" || kind === "tiles") await key("c");
  else if (kind === "snake") await key("b");
  else { for (let i = 0; i < (kind === "tetris" ? 3 : 2); i++) await key("a"); await key("b"); }
  expect(document.querySelector(".game-abandon")).toBeTruthy();
}
function endGame(kind: Kind) {
  const g = saved.game!;
  if (kind === "snake") g.snake!.end = "wall";
  if (kind === "tetris") { g.tetris!.end = "won"; g.tetris!.lines = 8; g.tetris!.active = undefined; }
  if (kind === "fishing") { g.fishing!.phase = "done"; g.fishing!.casts = 3; }
  if (kind === "walk") g.walking!.beat = 72;
  if (kind === "treasure") { g.treasure!.opened = [3, 4, 5, 6, 7, 8]; g.treasure!.paused = true; g.treasure!.step++; }
  saved.revision++;
}
function controls() { expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button, .lcd input, .lcd a")).toBeNull(); }
async function preview() {
  const text = JSON.stringify(saved), file = new File([text], "before-game.json");
  Object.defineProperty(file, "text", { value: async () => text });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 16, revision: 10, species: 2, name: "同局同步", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async (path, body) => {
    const a = body as { kind?: string; gameId?: string };
    if (path === "action") {
      expect(a.gameId).toBe(saved.game?.id);
      if (a.kind?.endsWith("-finish")) { saved.game = undefined; saved.careCount++; saved.revision++; }
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("same-save game session synchronization", () => {
  it.each(kinds)("an external %s start is reachable without reloading and never autoplays", async kind => {
    await mount(); saved.game = game(kind); saved.revision++;
    if (saved.game.snake) saved.game.snake.paused = false;
    if (saved.game.tetris) saved.game.tetris.paused = false;
    if (saved.game.fishing) { saved.game.fishing.paused = false; saved.game.fishing.phase = "wait"; }
    if (saved.game.walking) saved.game.walking.paused = false;
    if (saved.game.treasure) saved.game.treasure.paused = false;
    await poll(); expect(document.querySelector(".content-game")).toBeTruthy();
    await clock(1200); expect(actions()).toHaveLength(0); expect(saved.careCount).toBe(0); controls();
  });

  it.each(kinds)("a replacement %s session clears the old exit intent without touching it", async kind => {
    saved.game = game(kind); await mount(); await abandon(kind);
    saved.game = game(kind, second); saved.revision++; await poll();
    expect(document.querySelector(".game-abandon")).toBeNull(); expect(document.querySelector(".content-game")).toBeTruthy();
    await clock(1200); expect(actions()).toHaveLength(0); expect(saved.game.id).toBe(second); controls();
  });

  it.each(["snake", "tetris", "fishing", "walk", "treasure"] as const)("a completed same-ID %s invalidates an unfinished-game discard confirmation", async kind => {
    saved.game = game(kind); await mount(); await abandon(kind); endGame(kind); await poll();
    expect(document.querySelector(".game-abandon")).toBeNull(); expect(actions()).toHaveLength(0); expect(saved.careCount).toBe(0);
    await key("b"); expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({ kind: `${kind === "fishing" ? "fish" : kind}-finish`, gameId: first });
    expect(saved.careCount).toBe(1);
  });

  it("finding all three treasures also invalidates an unfinished discard before six digs", async () => {
    saved.game = game("treasure"); await mount(); await abandon("treasure");
    saved.game.treasure!.opened = [0, 1, 2]; saved.game.treasure!.step++; saved.revision++;
    await poll(); expect(document.querySelector(".game-abandon")).toBeNull();
    expect(document.querySelector('.treasure-game[data-done="true"]')).toBeTruthy();
    expect(actions()).toHaveLength(0); expect(saved.careCount).toBe(0);
    await key("a"); expect(actions()).toHaveLength(0);
    await key("b"); expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({ kind: "treasure-finish", gameId: first, step: 1 });
    expect(saved.careCount).toBe(1);
  });

  it.each(["tetris", "fishing", "walk", "treasure"] as const)("a new %s session resets its old pause-menu selection", async kind => {
    saved.game = game(kind); await mount(); await abandon(kind);
    saved.game = game(kind, second); saved.revision++; await poll(); await key("b");
    expect(actions()).toHaveLength(1); expect(actions()[0]).toMatchObject({ kind: `${kind === "fishing" ? "fish" : kind}-resume`, gameId: second });
  });

  it.each(["menu", "growth", "guide", "help", "reset", "preview"])("a new session cancels stale %s navigation or confirmation", async panel => {
    await mount();
    if (panel === "menu") await key("a");
    if (panel === "growth") { await menu(6); await key("a"); }
    if (panel === "guide") { await menu(1); await key("b"); }
    if (panel === "help") fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    if (panel === "reset") { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); fireEvent.click(screen.getByRole("button", { name: "重新开始" })); }
    if (panel === "preview") await preview();
    saved.game = game("snake", second); saved.revision++; await poll();
    expect(document.querySelector(".content-game .snake-game")).toBeTruthy();
    expect(document.querySelector("[role=dialog], .import-preview, .tools-menu")).toBeNull(); expect(actions()).toHaveLength(0); controls();
  });

  it.each(["snake", "tetris", "fishing", "walk", "treasure"] as const)("an already synchronized %s result keeps deliberate help navigation on later reads", async kind => {
    saved.game = game(kind); await mount(); endGame(kind); await poll();
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    expect(document.querySelector("[role=dialog]")).toBeTruthy();
    saved.revision++; await poll();
    expect(document.querySelector("[role=dialog]")).toBeTruthy(); expect(actions()).toHaveLength(0);
  });

  it.each(["discard", "help", "preview"])("an externally removed session clears stale %s UI without collecting again", async panel => {
    saved.game = game("tetris"); await mount();
    if (panel === "discard") await abandon("tetris");
    if (panel === "help") fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    if (panel === "preview") await preview();
    saved.game = undefined; saved.revision++; await poll();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".game-abandon, [role=dialog], .import-preview")).toBeNull();
    expect(actions()).toHaveLength(0); controls();
  });

  it.each((["tetris", "treasure"] as const).flatMap(kind =>
    (["new", "done", "removed"] as const).map(change => ({ kind, change }))))("a stale $change $kind read cannot invalidate the current discard decision", async ({ kind, change }) => {
    saved.game = game(kind); await mount(); await abandon(kind);
    const current = result();
    if (change === "new") saved.game = game(kind, second);
    if (change === "done") endGame(kind);
    if (change === "removed") saved.game = undefined;
    const stale = result(); stale.state.revision = current.state.revision - 1;
    api.mockResolvedValueOnce(stale); await poll();
    expect(document.querySelector(".game-abandon")).toBeTruthy(); expect(actions()).toHaveLength(0);
    saved = current.state;
  });

  it("a slow file read cannot revive an obsolete import after a new game arrives", async () => {
    await mount(); const text = JSON.stringify(saved), file = new File([text], "slow.json");
    let finish!: (value: string) => void;
    Object.defineProperty(file, "text", { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
    saved.game = game("snake", second); saved.revision++; await poll();
    await act(async () => { finish(text); });
    expect(document.querySelector(".import-preview")).toBeNull();
    expect(document.querySelector(".content-game .snake-game")).toBeTruthy(); expect(actions()).toHaveLength(0);
  });

  it.each(["tetris", "treasure"] as const)("ordinary same-session %s progress preserves a deliberate exit confirmation", async kind => {
    saved.game = game(kind); await mount(); await abandon(kind);
    if (kind === "tetris") saved.game.tetris!.step++;
    else { saved.game.treasure!.opened = [3]; saved.game.treasure!.step++; }
    saved.revision++; await poll();
    expect(document.querySelector(".game-abandon")).toBeTruthy(); expect(actions()).toHaveLength(0);
  });
  it.each(["tetris", "treasure"] as const)("ordinary same-session %s reads preserve the pause-menu selection", async kind => {
    saved.game = game(kind); await mount(); await key("a");
    const selector = kind === "tetris" ? ".tetris-overlay .selected" : ".treasure-pause [aria-current=true]";
    const selected = document.querySelector(selector)?.textContent; expect(selected).toBeTruthy();
    saved.revision++; await poll(); expect(document.querySelector(selector)?.textContent).toBe(selected); expect(actions()).toHaveLength(0);
  });
  it("ordinary care reads do not throw a reader out of their handbook page", async () => {
    await mount(); await menu(6); await key("a"); const content = document.querySelector(".content-growth")?.textContent;
    saved.needs.hunger--; saved.revision++; await poll(); expect(document.querySelector(".content-growth")?.textContent).toBe(content); expect(actions()).toHaveLength(0);
  });
});

describe("unfinished-only discard intent", () => {
  it.each((["snake", "tetris", "fishing", "walk", "treasure"] as const).flatMap(kind =>
    (["success", "offline", "stale"] as const).map(read => ({ kind, read }))))("a stale $kind discard is refused and recovery is read-only ($read)", async ({ kind, read }) => {
    saved.game = game(kind); await mount(); await abandon(kind); const stale = result(); stale.state.revision--;
    endGame(kind); const terminal = result();
    api.mockImplementation(async (path, body) => {
      const a = body as { kind?: string };
      if (path === "action" && a.kind === "cancel-play") {
        throw new RequestFailure("本局已经结束", "rejected", "game_finished", token);
      }
      if (path === "action" && a.kind?.endsWith("-finish")) { saved.game = undefined; saved.careCount++; saved.revision++; }
      return result();
    });
    await key("b"); expect(saved).toEqual(terminal.state); expect(actions()).toHaveLength(1);
    expect(document.querySelector(".save-recovery")?.textContent).toContain("本次放弃未执行");
    expect(document.querySelector(".save-recovery")?.textContent).not.toContain("可能已经保存");
    expect(document.querySelector(".game-abandon, [role=dialog]")).toBeNull(); controls();
    await key("a"); await key("c"); expect(actions()).toHaveLength(1);
    if (read !== "success") {
      if (read === "offline") api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable"));
      else api.mockResolvedValueOnce(stale);
      await key("b");
      expect(document.querySelector(".save-recovery")?.textContent).toContain("本次放弃未执行");
      expect(screen.getByRole("alert").textContent).toContain("上次操作未执行");
    }
    await key("b"); expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(document.querySelector(".save-recovery, .game-abandon")).toBeNull();
    expect(document.querySelector(".content-game")).toBeTruthy(); expect(actions()).toHaveLength(1); expect(saved.careCount).toBe(0);
    await key("b"); expect(actions()).toHaveLength(2);
    expect(actions()[1]).toMatchObject({ kind: `${kind === "fishing" ? "fish" : kind}-finish`, gameId: first });
    expect(saved.careCount).toBe(1);
  });

  it("a lost rejection response remains unknown until a fresh read, rather than claiming a known refusal", async () => {
    saved.game = game("tetris"); await mount(); await abandon("tetris"); endGame("tetris");
    api.mockRejectedValueOnce(new RequestFailure("lost response", "unknown")); await key("b");
    expect(document.querySelector(".save-recovery")?.textContent).toContain("可能已经保存");
    expect(document.querySelector(".save-recovery")?.textContent).not.toContain("本次放弃未执行");
    await key("b"); expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(actions()).toHaveLength(1); expect(saved.game?.tetris?.end).toBe("won"); expect(saved.careCount).toBe(0);
  });
});

it("refreshes acknowledged progress inside an open confirmation without a gameplay write", async () => {
  saved.game = game("stars"); await mount(); await abandon("stars");
  expect(screen.getByLabelText("本局已保存进度").textContent).toContain("已完成 0 / 5 轮");
  saved.game!.round = 2; saved.game!.score = 1; saved.game!.lastBeat = 4; saved.revision++;
  await poll();
  expect(screen.getByLabelText("本局已保存进度").textContent).toContain("已完成 2 / 5 轮 · 接住 1 颗");
  expect(actions()).toHaveLength(0);
  await key("c"); expect(document.querySelector(".game-abandon")).toBeNull();
  expect(saved.game!.round).toBe(2); expect(actions()).toHaveLength(0);
});
