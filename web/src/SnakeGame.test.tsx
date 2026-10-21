import { RequestFailure } from "./requestFailure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import App from "./App";
import { SnakeGame } from "./SnakeGame";
import { ArcadePanel } from "./ArcadePanel";
import { memoryWords } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const id = "0123456789abcdef0123456789abcdef";
let saved: PetState;
let failStep = false;
function snakeGame() { return { id, kind: "snake" as const, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, eaten: 0, step: 0, direction: 0, paused: true, lastMoveAt: Date.now() } }; }
function result(): Result { return { state: structuredClone(saved), message: "", serverTime: Date.now() }; }
const actions = () => api.mock.calls.filter(c => c[0] === "action").map(c => c[1] as { kind: string; gameId?: string; step?: number; turn?: number ;});
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); failStep = false;
  saved = { schema: 6, revision: 1, species: 2, name: "草莓兔", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [], economy: { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "" } } };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const a = body as { kind: string; step: number; turn: number ;};
      if (a.kind === "play-snake") saved.game = snakeGame();
      const n = saved.game?.snake;
      if (n && a.kind === "snake-resume") { n.paused = false; n.lastMoveAt = Date.now(); }
      if (n && a.kind === "snake-pause") n.paused = true;
      if (n && a.kind === "snake-step") { if (failStep) throw new RequestFailure("服务端拒绝了这一步", "rejected"); n.step++; n.direction = (n.direction + a.turn + 4) % 4; n.lastMoveAt = Date.now(); }
      if (a.kind === "cancel-play" || a.kind === "snake-finish") delete saved.game;
      saved.revision++;
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("three-key realtime snake", () => {
  it("selects the third arcade game with A and starts paused using B, without LCD controls", async () => {
    await mount(); for (const k of ["a", "a", "b", "a", "a", "b", "b"]) await key(k);
    expect(actions().at(-1)?.kind).toBe("play-snake");
    expect(document.querySelector(".snake-overlay")?.textContent).toContain("已暂停");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelectorAll(".lcd button")).toHaveLength(0);
    await clock(3000); expect(actions().filter(a => a.kind === "snake-step")).toHaveLength(0);
  });
  it("automatically advances while running, queues only one relative turn, and pauses with C", async () => {
    saved.game = snakeGame(); await mount(); await key("a");
    expect(actions().at(-1)).toMatchObject({ kind: "snake-resume", gameId: id, step: 0 });
    await key("a"); await key("b"); // cannot reverse by double tapping inside one beat
    await clock(650);
    expect(actions().at(-1)).toMatchObject({ kind: "snake-step", gameId: id, step: 0, turn: -1 });
    await clock(650);
    expect(actions().at(-1)).toMatchObject({ step: 1, turn: 0 });
    await key("c"); expect(actions().at(-1)).toMatchObject({ kind: "snake-pause", step: 2 });
    const count = actions().length; await clock(5000); expect(actions()).toHaveLength(count);
    await key("b"); expect(document.querySelector(".game-abandon")).toBeTruthy();
    await key("b"); expect(actions().at(-1)?.kind).toBe("cancel-play");
    expect(document.querySelector(".content-home")).toBeTruthy();
  });
  it("restores a running server session as locally paused, never catching up on reload", async () => {
    saved.game = snakeGame(); saved.game.snake!.paused = false; saved.game.snake!.lastMoveAt -= 10000;
    await mount(); await clock(3000); expect(actions()).toHaveLength(0);
    expect(document.querySelector(".snake-overlay")?.textContent).toContain("已暂停");
    await key("c"); await clock(650); expect(actions().at(-1)?.kind).toBe("snake-step");
  });
  it("stops after a rejected step, and requires explicit resume", async () => {
    saved.game = snakeGame(); await mount(); await key("a"); failStep = true; await clock(650);
    const count = actions().length; await clock(5000); expect(actions()).toHaveLength(count);
    expect(document.querySelector(".snake-overlay")?.textContent).toContain("已暂停");
  });
  it("stops on background visibility and does not resume on return", async () => {
    saved.game = snakeGame(); await mount(); await key("a");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await clock(5000); expect(actions().filter(a => a.kind === "snake-step")).toHaveLength(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await clock(2000); expect(actions().filter(a => a.kind === "snake-step")).toHaveLength(0);
  });
  it("collects terminal results only via B/C and shows short-round reward rules", async () => {
    saved.game = snakeGame(); saved.game.snake!.end = "wall"; await mount();
    expect(document.querySelector(".snake-overlay")?.textContent).toContain("3 颗");
    await key("a"); expect(actions()).toHaveLength(0); expect(document.querySelector(".snake-overlay")?.textContent).toContain("A 暂不操作");
    await key("b"); expect(actions().at(-1)).toMatchObject({ kind: "snake-finish", step: 0, gameId: id });
    expect(document.querySelector(".content-home")).toBeTruthy();
  });
  it("renders stage-specific equipped pet and permanent snake memory", () => {
    saved.game = snakeGame(); saved.game.snake!.eaten = 8; saved.game.snake!.end = "won";
    render(<SnakeGame pet={saved} now={saved.lastTick} active={false} turn={0} />);
    expect(document.querySelector(".snake-pet .rabbit-rig")).toBeTruthy();
    expect(document.querySelector('.snake-pet [data-item="leaf-pin"]')).toBeTruthy();
    expect(document.querySelector(".snake-overlay")?.textContent).toContain("装满");
    expect(memoryWords({ kind: "snake", source: "shared", at: Date.now() }, false)?.title).toContain("果园");
  });
  it("shows seven non-clickable games and their shared reward limit", () => {
    render(<ArcadePanel choice={2} economy={saved.economy} shop={{ catalog: [], dailyCoins: 10, gameDailyLimit: 30 }} now={Date.now()} />);
    expect(document.querySelectorAll(".arcade-card")).toHaveLength(7);
    expect(document.querySelector('[data-game="snake"]')?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});
