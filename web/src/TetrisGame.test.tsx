import { RequestFailure } from "./requestFailure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import App from "./App";
import { TetrisGame, blockCells } from "./TetrisGame";
import { memoryWords } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
let saved: PetState, failStep = false;
function game() { return { id, kind: "tetris" as const, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: Date.now() } }; }
function result(): Result { return { state: structuredClone(saved), message: "", serverTime: Date.now() }; }
const actions = () => api.mock.calls.filter(c => c[0] === "action").map(c => c[1] as { kind: string; step?: number; gameId?: string; turn?: number; });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); failStep = false;
  saved = { schema: 7, revision: 1, species: 9, name: "焦糖犬", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [], economy: { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "" } } };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const a = body as { kind: string; step: number; turn: number; };
      if (a.kind === "play-tetris") saved.game = game();
      const n = saved.game?.tetris;
      if (n && a.kind.startsWith("tetris-") && a.step !== n.step) throw new RequestFailure("stale step", "rejected");
      if (n && a.kind === "tetris-pause") n.paused = true;
      if (n && ["tetris-resume", "tetris-rotate", "tetris-drop"].includes(a.kind)) { n.paused = false; n.lastFallAt = Date.now(); }
      if (n && a.kind === "tetris-rotate") n.active!.rotation = (n.active!.rotation + 1) % 4;
      if (n && a.kind === "tetris-drop") n.pieces++;
      if (n && a.kind === "tetris-move") n.active!.x += a.turn;
      if (n && a.kind === "tetris-step") { if (failStep) throw new RequestFailure("服务端拒绝了这一步", "rejected"); n.active!.y++; n.lastFallAt = Date.now(); }
      if (n && a.kind.startsWith("tetris-")) n.step++;
      if (["cancel-play", "tetris-finish"].includes(a.kind)) delete saved.game;
      saved.revision++;
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("three-key Tetris", () => {
  it("selects the fourth arcade game and starts paused, with only physical A/B/C", async () => {
    await mount(); for (const k of ["a", "a", "b", "a", "a", "a", "b", "b"]) await key(k);
    expect(actions().at(-1)?.kind).toBe("play-tetris");
    expect(document.querySelector(".tetris-overlay")?.textContent).toContain("积木已暂停");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelectorAll(".lcd button,.lcd [role=button]")).toHaveLength(0);
    await clock(5000); expect(actions().filter(a => a.kind === "tetris-step")).toHaveLength(0);
  });
  it("moves left/right immediately without delaying automatic gravity", async () => {
    saved.game = game(); await mount(); await key("c"); await clock(500); await key("a"); await key("b"); await clock(550);
    expect(actions().slice(-3)).toMatchObject([{ kind: "tetris-move", step: 1, turn: -1 }, { kind: "tetris-move", step: 2, turn: 1 }, { kind: "tetris-step", step: 3, gameId: id }]);
    await key("c"); expect(actions().at(-1)).toMatchObject({ kind: "tetris-pause", step: 4 });
    const count = actions().length; await clock(5000); expect(actions()).toHaveLength(count);
  });
  it("uses a paused A/B menu to rotate, drop and abandon without extra keys", async () => {
    saved.game = game(); await mount(); await key("a"); await key("b");
    expect(actions().at(-1)).toMatchObject({ kind: "tetris-rotate", step: 0 });
    await key("c"); await key("a"); await key("a"); await key("b");
    expect(actions().at(-1)).toMatchObject({ kind: "tetris-drop", step: 2 });
    await key("c"); for (let i = 0;i < 3;i++)await key("a"); await key("b");
    expect(document.querySelector(".game-abandon")).toBeTruthy(); await key("b");
    expect(actions().at(-1)?.kind).toBe("cancel-play"); expect(document.querySelector(".content-home")).toBeTruthy();
  });
  it("reloads a running session locally paused and persists pause before menu rotation", async () => {
    saved.game = game(); saved.game.tetris!.paused = false;
    await mount(); await clock(2000); expect(actions()).toHaveLength(0);
    await key("a"); await key("b");
    expect(actions()).toMatchObject([{ kind: "tetris-pause", step: 0 }, { kind: "tetris-rotate", step: 1 }]);
  });
  it("stops on a rejected pulse and requires explicit resume", async () => {
    saved.game = game(); await mount(); await key("c"); failStep = true; await clock(1050);
    const count = actions().length; await clock(5000); expect(actions()).toHaveLength(count);
    expect(document.querySelector(".tetris-overlay")).toBeTruthy();
  });
  it("stops when hidden and never catches up when visible again", async () => {
    saved.game = game(); await mount(); await key("c");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await clock(15000);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await clock(3000);
    expect(actions().filter(a => a.kind === "tetris-step")).toHaveLength(0);
    await key("c"); await clock(1050); expect(actions().at(-1)?.kind).toBe("tetris-step");
  });
  it("only sends finish for an ended game and does not replay it at mount", async () => {
    saved.game = game(); saved.game.tetris!.end = "won"; saved.game.tetris!.lines = 8; delete saved.game.tetris!.active;
    await mount(); await clock(2000); expect(actions()).toHaveLength(0);
    await key("a"); expect(actions()).toHaveLength(0); await key("b");
    expect(actions().at(-1)).toMatchObject({ kind: "tetris-finish", gameId: id, step: 0 });
  });
  it("renders next piece, ghost landing and equipped pet without initial fake collection", () => {
    saved.game = game(); const view = render(<TetrisGame pet={saved} active choice={0} />);
    expect(view.getByRole("img", { name: "下一块 I" })).toBeTruthy();
    expect(view.container.querySelectorAll(".active-block")).toHaveLength(4);
    expect(view.container.querySelectorAll(".ghost-block")).toHaveLength(4);
    expect(view.container.querySelector("[data-item=leaf-pin]")).toBeTruthy();
    expect(view.container.querySelector(".tetris-companion")?.getAttribute("data-motion")).toBe("waiting");
  });
  it("celebrates only a newly saved line clear, then returns to waiting", async () => {
    saved.game = game(); const view = render(<TetrisGame pet={saved} active choice={0} />);
    saved = structuredClone(saved); saved.game!.tetris!.lines = 2; view.rerender(<TetrisGame pet={saved} active choice={0} />);
    expect(view.container.querySelector(".tetris-companion")?.getAttribute("data-motion")).toBe("collecting");
    await clock(1000); expect(view.container.querySelector(".tetris-companion")?.getAttribute("data-motion")).toBe("waiting");
  });
  it("defers growth animation until the saved finish and keeps care feedback", async () => {
    saved.game = game(); saved.game.tetris!.end = "won"; saved.game.tetris!.lines = 8; delete saved.game.tetris!.active;
    api.mockImplementation(async path => {
      if (path === "action") {
        delete saved.game; saved.revision++; saved.economy!.coins = 6;
        saved.growth = emptyGrowth("growing"); saved.growth.points = 24;
        return { ...result(), careFeedback: { kind: "tetris-finish", points: 1, habit: "play", habitGain: 1, reason: "credited" } };
      }
      return result();
    });
    await mount(); expect(document.querySelector(".pet-scene")).toBeNull();
    await key("b"); expect(document.querySelector('.pet-scene[data-motion="celebrating"]')).toBeTruthy();
    await key("c"); expect(document.querySelector(".pet-scene")?.getAttribute("data-stage")).toBe("growing");
    await key("c"); expect(document.querySelector('.growth-feedback[data-feedback="credited"]')).toBeTruthy();
    expect(actions()).toHaveLength(1);
  });
  it("requires explicit resume after opening the guide", async () => {
    saved.game = game(); await mount(); await key("c");
    await act(async () => { fireEvent.click(document.querySelector('[aria-label="玩法说明"]')!); });
    await clock(4000);
    await act(async () => { fireEvent.click(document.querySelector('.modal-close')!); });
    await clock(3000);
    expect(actions().filter(a => a.kind === "tetris-step")).toHaveLength(0);
    expect(document.querySelector(".tetris-overlay")).toBeTruthy();
  });
  it("keeps four unique normalized cells for every piece rotation", () => {
    for (let kind = 1;kind <= 7;kind++)for (let rotation = 0;rotation < 4;rotation++) {
      const cells = blockCells({ kind, rotation, x: 0, y: 0 });
      expect(new Set(cells.map(p => `${p.x},${p.y}`)).size).toBe(4);
      expect(Math.min(...cells.map(p => p.x))).toBe(0); expect(Math.min(...cells.map(p => p.y))).toBe(0);
    }
  });
  it("records the shared puzzle memory in the album", () => {
    expect(memoryWords({ kind: "tetris", at: Date.now(), source: "shared" }, false)?.title).toBe("一起拼起的积木花园");
  });
});
