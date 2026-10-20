import { RequestFailure } from "./requestFailure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TileGame, nextTile } from "./TileGame";
import { ArcadePanel } from "./ArcadePanel";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import App from "./App";
import type { GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const gameID = "0123456789abcdef0123456789abcdef";
let saved: PetState;
let responseMessage = "";
function game() {
  return {
    id: gameID,
    kind: "tiles" as const,
    startedAt: Date.now(),
    round: 0,
    score: 0,
    lastBeat: -1,
    tiles: {
      board: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8],
      pick: -1,
      pairs: 0,
      shuffles: 0,
    },
  };
}
function result(): Result {
  return {
    state: structuredClone(saved),
    message: responseMessage,
    serverTime: Date.now(),
  };
}
async function key(k: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: k });
  });
}
async function mount() {
  await act(async () => {
    render(<App />);
  });
}
async function selector() {
  await key("a");
  await key("a");
  await key("b");
}
async function startTiles() {
  await selector();
  await key("a");
  await key("b"); // Open the guide before starting.
  await key("b");
}
const actions = () =>
  api.mock.calls
    .filter((c) => c[0] === "action")
    .map((c) => c[1] as { kind: string; gameId?: string; tile?: number });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api.mockReset();
  responseMessage = "";
  saved = {
    schema: 5,
    revision: 1,
    species: 7,
    name: "樱花喵",
    createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000,
    lastTick: Date.now(),
    sleeping: false,
    needs: { hunger: 70, mood: 70, energy: 80, clean: 80 },
    careCount: 0,
    growth: emptyGrowth("baby"),
    logs: [],
    album: { since: Date.now() - 10000, legacy: false, entries: [] },
    economy: {
      coins: 0,
      lastDailyAt: 0,
      lastGameAt: 0,
      gameCoins: 0,
      owned: ["leaf-pin", "clover-pot"],
      equipped: { accessory: "leaf-pin", room: "clover-pot" },
    },
  };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const a = body as { kind: string; tile: number };
      if (saved.sleeping) throw new RequestFailure("先起床再玩吧", "rejected");
      if (a.kind === "play-tiles") saved.game = game();
      if (a.kind === "tile-pick" && saved.game?.tiles)
        saved.game.tiles.pick = a.tile;
      if (a.kind === "tile-clear" && saved.game?.tiles)
        saved.game.tiles.pick = -1;
      if (a.kind === "cancel-play") delete saved.game;
      saved.revision++;
    }
    return result();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("three-key pet tile matching", () => {
  function feedbackGeometry() {
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
      const top = this.matches(".device-buttons") ? 500 : this.matches(".tile-board") ? -600 : -400;
      return { top, bottom: top + 100, width: 200, height: 100, left: 0, right: 200, x: 0, y: top, toJSON: () => ({}) };
    });
    return scroll;
  }
  it("reveals explicit A/B/C feedback but preserves manual reading on state polling", async () => {
    const scroll = feedbackGeometry();
    saved.game = game(); await mount();
    expect(scroll).not.toHaveBeenCalled();
    await key("a"); expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".tile-status")?.textContent).toContain("第 2 格");
    await key("b"); expect(scroll).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".tile-status")?.textContent).toContain("已选第 2 格");
    await key("c"); expect(scroll).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(scroll).toHaveBeenCalledTimes(3);
    expect(actions().map(a => a.kind)).toEqual(["tile-pick", "tile-clear"]);
  });
  it("does not reveal rejected tile actions", async () => {
    const scroll = feedbackGeometry(); saved.game = game(); await mount();
    api.mockRejectedValueOnce(new RequestFailure("请重选", "rejected"));
    await key("b"); expect(scroll).not.toHaveBeenCalled();
  });
  it("a late confirmed reply after leaving the window cannot replay a feedback jump", async () => {
    const scroll = feedbackGeometry(); saved.game = game(); await mount();
    let resolve!: (r: Result) => void;
    api.mockImplementationOnce(() => new Promise<Result>(r => { resolve = r; }));
    await key("b");
    await act(async () => { fireEvent(window, new Event("blur")); });
    saved.game.tiles!.pick = 0; saved.revision++;
    await act(async () => { resolve(result()); });
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(scroll).not.toHaveBeenCalled();
  });

  it("uses an untimed reading layout only while the tile board is visible", async () => {
    const scroll = feedbackGeometry();
    await mount();
    await startTiles();
    expect(document.querySelector(".device-stage.tiles-mode.reading-mode .tile-board")).toBeTruthy();
    scroll.mockClear();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    await key("c");
    expect(document.querySelector(".game-abandon")).toBeTruthy();
    expect(document.querySelector(".tiles-mode")).toBeNull();
    await key("a");
    expect(document.querySelector(".tiles-mode .tile-board")).toBeTruthy();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("defaults to stars, then retains a browsed game on return without a mutation", async () => {
    await mount();
    await selector();
    expect(
      document
        .querySelector('.arcade-card[aria-current="true"]')
        ?.getAttribute("data-game"),
    ).toBe("stars");
    await key("a");
    expect(
      document
        .querySelector('.arcade-card[aria-current="true"]')
        ?.getAttribute("data-game"),
    ).toBe("tiles");
    expect(actions()).toHaveLength(0);
    await key("c");
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(actions()).toHaveLength(0);
    await selector();
    expect(
      document
        .querySelector('.arcade-card[aria-current="true"]')
        ?.getAttribute("data-game"),
    ).toBe("tiles");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelectorAll(".lcd button")).toHaveLength(0);
  });
  it("starts, moves locally, sends the session identity, and C clears selection before exiting", async () => {
    await mount();
    await startTiles();
    expect(actions()[0].kind).toBe("play-tiles");
    expect(document.querySelector(".tile-game")).toBeTruthy();
    expect(
      document
        .querySelector(".tile-pet .equipped-accessory")
        ?.getAttribute("data-item"),
    ).toBe("leaf-pin");
    expect(
      document.querySelector(
        '.tile-companion .room-decoration[data-item="clover-pot"]',
      ),
    ).toBeTruthy();
    await key("a");
    expect(actions()).toHaveLength(1);
    expect(
      document.querySelector(".tile-cell.cursor")?.getAttribute("data-cell"),
    ).toBe("1");
    await key("b");
    expect(actions().at(-1)).toMatchObject({
      kind: "tile-pick",
      gameId: gameID,
      tile: 1,
    });
    expect(
      document.querySelector(".tile-cell.picked")?.getAttribute("data-cell"),
    ).toBe("1");
    await key("c");
    expect(actions().at(-1)).toMatchObject({
      kind: "tile-clear",
      gameId: gameID,
    });
    expect(document.querySelector(".tile-game")).toBeTruthy();
    await key("c");
    expect(document.querySelector(".game-abandon")).toBeTruthy();
    await key("b");
    expect(actions().at(-1)).toMatchObject({
      kind: "cancel-play",
      gameId: gameID,
    });
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(saved.economy!.coins).toBe(0);
    expect(saved.careCount).toBe(0);
  });
  it("resumes the server board and first pick without replaying a collection or new-game request", async () => {
    saved.game = game();
    saved.game.tiles!.board[0] = saved.game.tiles!.board[1] = 0;
    saved.game.tiles!.pairs = 1;
    saved.game.tiles!.pick = 4;
    await mount();
    expect(
      document.querySelector(".tile-cell.cursor")?.getAttribute("data-cell"),
    ).toBe("2");
    expect(
      document.querySelector(".tile-cell.picked")?.getAttribute("data-cell"),
    ).toBe("4");
    expect(document.querySelector(".collected-tile")).toBeNull();
    expect(document.querySelector(".tile-link")).toBeNull();
    expect(actions()).toHaveLength(0);
    await key("c");
    expect(saved.game!.tiles!.pick).toBe(-1);
    expect(saved.game!.tiles!.pairs).toBe(1);
  });
  it("animates only a server-confirmed link and then clears its timer while keeping equipment", async () => {
    saved.game = game();
    saved.game.tiles!.pick = 0;
    api.mockImplementation(async (path, body) => {
      if (path === "action") {
        saved.game!.tiles!.board[0] = saved.game!.tiles!.board[1] = 0;
        saved.game!.tiles!.pick = -1;
        saved.game!.tiles!.pairs++;
        saved.revision++;
        return {
          ...result(),
          tileLink: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
          ],
        };
      }
      return result();
    });
    await mount();
    await key("a");
    await key("b");
    expect(document.querySelector(".tile-link")?.getAttribute("points")).toBe(
      "20,20 40,20",
    );
    expect(
      document.querySelector('.tile-companion[data-motion="collecting"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(".tile-cell.cursor")?.getAttribute("data-cell"),
    ).toBe("2");
    expect(
      document.querySelectorAll(".tile-pet .equipped-accessory"),
    ).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(850);
    });
    expect(document.querySelector(".tile-link")).toBeNull();
    expect(document.querySelector(".collected-tile")).toBeNull();
    expect(api.mock.calls.filter((c) => c[0] === "action")).toHaveLength(1);
  });
  it("collects the matched icon without drawing an obsolete path after a server shuffle", async () => {
    saved.game = game();
    saved.game.tiles!.pick = 0;
    api.mockImplementation(async (path) => {
      if (path === "action") {
        saved.game!.tiles!.board = [
          2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 0, 0,
        ];
        saved.game!.tiles!.pick = -1;
        saved.game!.tiles!.pairs = 1;
        saved.game!.tiles!.shuffles = 1;
        saved.revision++;
        return {
          ...result(),
          tileLink: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
          ],
        };
      }
      return result();
    });
    await mount();
    await key("a");
    await key("b");
    expect(document.querySelector(".tile-link")).toBeNull();
    expect(document.querySelector(".collected-tile")).toBeTruthy();
    expect(document.querySelector('.tile-game[data-pairs="1"]')).toBeTruthy();
  });
  it("returns home without replaying rewards if another tab cancels the game", async () => {
    saved.game = game();
    await mount();
    delete saved.game;
    saved.revision++;
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(
      document.querySelector('.pet-scene[data-motion="idle"]'),
    ).toBeTruthy();
    expect(actions()).toHaveLength(0);
  });
  it("does not show a successful link or remove a tile when saving fails", async () => {
    saved.game = game();
    api.mockImplementation(async (path) => {
      if (path === "action") throw new RequestFailure("没有保存", "rejected");
      return result();
    });
    await mount();
    await key("b");
    expect(document.querySelectorAll(".tile-cell:not(.empty)")).toHaveLength(
      16,
    );
    expect(document.querySelector(".tile-link")).toBeNull();
    expect(document.querySelector(".collected-tile")).toBeNull();
    expect(screen.getByText("没有保存")).toBeTruthy();
  });
  it("waits for completion before care celebration, coins, and pending evolution", async () => {
    saved.game = game();
    saved.game.tiles!.board = Array(14).fill(0).concat([8, 8]);
    saved.game.tiles!.pairs = 7;
    saved.game.tiles!.pick = 14;
    api.mockImplementation(async (path) => {
      if (path === "action") {
        delete saved.game;
        saved.revision++;
        saved.economy!.coins = 6;
        saved.growth = emptyGrowth("growing");
        saved.growth.points = 24;
        responseMessage = "八对连好啦！+6 金币";
        return {
          ...result(),
          careFeedback: {
            kind: "tile-pick",
            points: 1,
            habit: "play",
            habitGain: 1,
            reason: "credited",
          },
        };
      }
      return result();
    });
    await mount();
    await key("a");
    await key("b");
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(
      document.querySelector('.pet-scene[data-motion="celebrating"]'),
    ).toBeTruthy();
    expect(saved.economy!.coins).toBe(6);
    await key("c");
    expect(
      document.querySelector('.pet-scene[data-motion="celebrating"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-stage"),
    ).toBe("growing");
    await key("c");
    expect(
      document.querySelector('.growth-feedback[data-feedback="credited"]'),
    ).toBeTruthy();
    expect(actions()).toHaveLength(1);
  });
  it("does not consume return recaps during a tile game", async () => {
    saved.game = game();
    const snap = {
      needs: saved.needs,
      stage: "baby" as const,
      form: "" as const,
      points: 0,
      rest: 0,
      trackedHours: 0,
    };
    api.mockImplementation(async (path, body) => {
      if (
        path === "action" &&
        (body as { kind: string }).kind === "cancel-play"
      ) {
        delete saved.game;
        saved.revision++;
      }
      if (path === "recap/read")
        return {
          ...result(),
          recapClaimed: true,
          recapPending: false,
          returnRecap: {
            id: "return-tiles",
            from: Date.now() - 3600000,
            to: Date.now(),
            before: snap,
            after: snap,
          },
        };
      return {
        ...result(),
        recapPending: true,
        returnRecap: {
          id: "return-tiles",
          from: Date.now() - 3600000,
          to: Date.now(),
          before: snap,
          after: snap,
        },
      };
    });
    await mount();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(api.mock.calls.filter((c) => c[0] === "recap/read")).toHaveLength(0);
    await key("c");
    await key("b");
    expect(api.mock.calls.filter((c) => c[0] === "recap/read")).toHaveLength(1);
    expect(document.querySelector(".return-panel")).toBeTruthy();
  });
  it("can browse the selector asleep but a rejected start never wakes the pet", async () => {
    saved.sleeping = true;
    await mount();
    await selector();
    await key("a");
    await key("b");
    await key("b");
    expect(saved.sleeping).toBe(true);
    expect(saved.game).toBeUndefined();
    expect(document.querySelector(".game-guide")).toBeTruthy();
    expect(screen.getByText("先起床再玩吧")).toBeTruthy();
  });
});

describe("read-only tile board and pet participation", () => {
  it("skips cleared cells and wraps without moving the persisted first pick", () => {
    const b = Array(16).fill(0);
    b[2] = 1;
    b[15] = 1;
    expect(nextTile(b, -1)).toBe(2);
    expect(nextTile(b, 2)).toBe(15);
    expect(nextTile(b, 15)).toBe(2);
    expect(nextTile(Array(16).fill(0), 0)).toBe(0);
  });
  it("renders all species and stages with one pet and equipment, no clickable board cells", () => {
    saved.game = game();
    for (let species = 0; species < 10; species++)
      for (const stage of ["baby", "growing", "adult"] as GrowthStage[]) {
        saved.species = species;
        saved.growth = emptyGrowth(stage);
        const view = render(
          <TileGame
            pet={saved}
            cursor={0}
            link={null}
            message=""
            now={Date.now()}
          />,
        );
        for (const icon of view.container.querySelectorAll(
          ".tile-cell .tile-icon",
        )) {
          expect(icon.getAttribute("width")).toBe("14");
          expect(icon.getAttribute("height")).toBe("14");
        }
        expect(view.container.querySelectorAll(".tile-cell")).toHaveLength(16);
        expect(
          view.container.querySelectorAll(".tile-pet .pet-sprite"),
        ).toHaveLength(1);
        expect(
          view.container.querySelectorAll(".equipped-accessory"),
        ).toHaveLength(1);
        expect(
          view.container.querySelectorAll("button, a, input, [role=button]"),
        ).toHaveLength(0);
        view.unmount();
      }
  });
  it("uses only the actual known game cap in the selector", () => {
    render(<ArcadePanel choice={1} economy={saved.economy} shop={{ catalog: [], dailyCoins: 10, gameDailyLimit: 30 }} now={Date.now()} />);
    expect(screen.getByText(/今日游戏额度剩 30 \/ 30 币/)).toBeTruthy();
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});
