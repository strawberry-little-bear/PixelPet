import { RequestFailure } from "./requestFailure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { ArcadePanel } from "./ArcadePanel";
import { gameAllowance, gameStartInstruction, games, guideSeen, rememberGuide } from "./games";
import type { GameInfo } from "./games";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { PetState, Shop } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const rules: Shop = { catalog: [], dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1_000_000 };
const id = "0123456789abcdef0123456789abcdef";
// Literal UI expectations: do not derive the promised key/action from the helper under test.
const entryActions = { stars: "开始", tiles: "开始", snake: "进入暂停", tetris: "进入暂停", fishing: "进入准备", walk: "进入暂停", treasure: "进入暂停" };
function expectGuideKeys(info: GameInfo, compact = false) {
  const action = `B ${compact ? "" : "跳过说明，"}${entryActions[info.id]}`;
  expect(document.querySelector(".game-guide > small")?.textContent)
    .toBe(`A ${compact ? "重看规则" : "翻页"} · ${action} · C 返回选游戏`);
  expect(document.querySelector(".lcd-bottom > span")?.textContent)
    .toBe(`A ${compact ? "重看规则" : "翻页"}  ${action}  C 返回选择`);
}
let saved: PetState, failStart: boolean, failCancel: boolean;
const actions = () => api.mock.calls.filter(c => c[0] === "action").map(c => c[1] as { kind: string; gameId?: string; });
const response = () => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), shop: rules });
function session(info: GameInfo, fishingPaused = true) {
  const common = { id, startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
  if (info.id === "treasure") return {...common,kind:"treasure" as const,treasure:{layout:[1,2,3,0,0,0,0,0,0],opened:[],step:0,paused:true}};
  if (info.id === "stars") return common;
  if (info.id === "tiles") return { ...common, kind: "tiles" as const, tiles: { board: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8], pick: -1, pairs: 0, shuffles: 0 } };
  if (info.id === "snake") return { ...common, kind: "snake" as const, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, direction: 0, eaten: 0, step: 0, lastMoveAt: Date.now(), paused: true } };
  if (info.id === "walk") return {...common,kind:"walk" as const,walking:{route:Array<"rock"|"branch">(12).fill("rock"),souvenirs:["leaf","shell","flower"],beat:0,step:0,cleared:0,pose:"" as const,poseUntil:0,lastPulseAt:Date.now(),lastInputAt:0,paused:true}};
  if (info.id === "fishing") return { ...common, kind: "fishing" as const, fishing: {spot:0, casts:0, catches:[], phase:"ready" as const, step:0, waitMs:0, elapsedMs:0, candidate:"", lastPulseAt:Date.now(), paused:fishingPaused} };
  return { ...common, kind: "tetris" as const, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, lastFallAt: Date.now(), paused: true } };
}
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function select(index: number) {
  for (const k of ["a", "a", "b"]) await key(k);
  for (let i = 0;i < index;i++) await key("a");
}
async function openConfirmation(info: GameInfo) {
  if (info.id === "fishing" || info.id === "walk" || info.id === "treasure") { await key("a"); await key("a"); await key("b"); }
  else if (info.id === "snake") await key("b"); // Already paused on reload.
  else if (info.id === "tetris") { for (let i = 0;i < 3;i++) await key("a"); await key("b"); }
  else await key("c");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z")); localStorage.clear(); api.mockReset(); failStart = false; failCancel = false;
  saved = { schema: 7, revision: 1, species: 2, name: "草莓兔", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [], economy: { coins: 12, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } } };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const a = body as { kind: string; };
      const info = games.find(g => g.startAction === a.kind);
      if (info) { if (failStart) throw new RequestFailure("开局没有保存", "rejected"); saved.game = session(info, false); }
      if (a.kind === "cancel-play") { if (failCancel) throw new RequestFailure("放弃没有保存", "rejected"); delete saved.game; }
      const n = saved.game?.snake;
      if (n && a.kind === "snake-resume") { n.paused = false; n.lastMoveAt = Date.now(); }
      if (n && a.kind === "snake-pause") n.paused = true;
      const t = saved.game?.tetris;
      if (t && a.kind === "tetris-resume") { t.paused = false; t.lastFallAt = Date.now(); }
      if (t && a.kind === "tetris-pause") t.paused = true;
      if (saved.game?.fishing && a.kind === "fish-pause") saved.game.fishing.paused = true;
      saved.revision++;
    }
    return response();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("game directory and optional three-key guides", () => {
  it.each(games.map((g, i) => [g, i] as const))("opens and skips the $0.id guide without a premature mutation", async (info, index) => {
    await mount(); await select(index);
    expect(screen.getByText(info.controls)).toBeTruthy();
    expect(screen.getByText(info.reward)).toBeTruthy();
    expect(document.querySelector(".arcade-details")?.textContent).toContain(info.duration);
    await key("b");
    expect(document.querySelector(".game-guide")?.textContent).toContain("第一次一起玩");
    expect(actions()).toHaveLength(0); expect(guideSeen(info.id)).toBe(false);
    for (const [page, text] of [info.lesson, info.leaving, info.lesson].entries()) {
      expectGuideKeys(info);
      const steps = document.querySelector(".guide-steps");
      expect(steps?.tagName).toBe("UL");
      expect(steps?.textContent).toBe(text);
      expect(Array.from(steps!.querySelectorAll("li"), li => li.textContent))
        .toEqual(text.split("。").filter(Boolean).map(sentence => `${sentence}。`));
      if (page < 2) await key("a");
    }
    await key("b"); expect(actions().map(a => a.kind)).toEqual([info.startAction]);
    expect(saved.game).toBeTruthy(); expect(guideSeen(info.id)).toBe(true);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelectorAll(".lcd button,.lcd [role=button]")).toHaveLength(0);
  });
  it("shows a static number clue example in the first treasure guide page", async () => {
    await mount(); await select(6); await key("b");
    const example = document.querySelector(".treasure-guide-example");
    expect(example?.getAttribute("aria-label")).toBe("森林寻宝数字线索示例");
    expect(example?.textContent).toContain("包含斜角");
    expect(example?.querySelectorAll(".treasure-example-grid")).toHaveLength(2);
    expect(example?.querySelectorAll(".treasure-example-grid > *")).toHaveLength(18);
    expect(document.querySelector(".lcd button,.lcd [role=button]")).toBeNull();
    await key("a");
    expect(document.querySelector(".treasure-guide-example")).toBeNull();
    expect(document.querySelector(".guide-steps")?.textContent).toContain("结束后 B / C 收好");
  });
  it("returns from a guide to the same selection without writing or marking it read", async () => {
    await mount(); await select(2); await key("b"); await key("c");
    expect(document.querySelector('[data-game="snake"][aria-current="true"]')).toBeTruthy();
    expect(actions()).toHaveLength(0); expect(guideSeen("snake")).toBe(false);
    for(let i=0;i<games.length-2;i++)await key("a"); expect(document.querySelector('[data-game="stars"][aria-current="true"]')).toBeTruthy();
  });
  it("keeps a rejected start on the guide and only remembers a successfully saved retry", async () => {
    failStart = true; await mount(); await select(0); await key("b"); await key("b");
    expect(screen.getByText("开局没有保存")).toBeTruthy(); expect(guideSeen("stars")).toBe(false);
    expect(document.querySelector(".game-guide")).toBeTruthy(); failStart = false; await key("b");
    expect(guideSeen("stars")).toBe(true); expect(document.querySelector(".star-game")).toBeTruthy();
  });
  it("allows replaying an acknowledged guide and doesn't let a UI storage failure prevent play", async () => {
    rememberGuide("stars"); await mount(); await select(0); await key("b");
    expect(document.querySelector(".game-quick-start")?.textContent).toContain("准备再玩");
    expect(actions()).toHaveLength(0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await key("b"); expect(saved.game).toBeTruthy();
  });
  it("handles unavailable preference storage without treating it as a save error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(guideSeen("stars")).toBe(false);
  });
  it.each(games)("restores $id directly without forcing first-use instructions", async info => {
    saved.game = session(info); await mount(); await clock(5000);
    expect(document.querySelector(".content-game")).toBeTruthy(); expect(document.querySelector(".game-guide")).toBeNull();
    expect(actions()).toHaveLength(0); expect(guideSeen(info.id)).toBe(false);
  });
});

describe("abandon is not pause, finish, or a one-key data loss", () => {
  it.each(games)("protects $id, supports both cancel keys, and sends the original session only on confirmation", async info => {
    saved.game = session(info); const original = structuredClone(saved); await mount();
    await openConfirmation(info);
    expect(document.querySelector(".game-abandon")).toBeTruthy(); expect(actions()).toHaveLength(0);
    expect(screen.getByLabelText("本局已保存进度").textContent).toContain(info.title);
    await clock(6000); expect(actions()).toHaveLength(0);
    await key("a"); expect(document.querySelector(".game-abandon")).toBeNull();
    await clock(1500); expect(actions()).toHaveLength(0);
    await openConfirmation(info); await key("c"); expect(saved.game).toEqual(original.game);
    await openConfirmation(info); await key("b");
    expect(actions()).toEqual([expect.objectContaining({ kind: "cancel-play", gameId: id })]);
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(saved.economy).toEqual(original.economy); expect(saved.growth).toEqual(original.growth); expect(saved.careCount).toBe(0);
    expect(document.querySelectorAll(".lcd button,.lcd [role=button]")).toHaveLength(0);
  });
  it("keeps a failed cancellation retryable instead of pretending progress was discarded", async () => {
    saved.game = session(games[1]); failCancel = true; await mount(); await key("c"); await key("b");
    expect(screen.getByText("放弃没有保存")).toBeTruthy(); expect(document.querySelector(".game-abandon")).toBeTruthy(); expect(saved.game).toBeTruthy();
    failCancel = false; await key("b"); expect(saved.game).toBeUndefined(); expect(document.querySelector(".content-home")).toBeTruthy();
  });
  it.each([games[2], games[3]])("never resumes $id merely by dismissing abandon", async info => {
    saved.game = session(info); await mount(); await key("c"); await key("c"); // Resume, then pause using the real controls.
    expect(actions().map(a => a.kind)).toEqual([`${info.id}-resume`, `${info.id}-pause`]);
    await openConfirmation(info); await clock(3000); await key("c"); await clock(3000);
    expect(actions()).toHaveLength(2); expect(saved.game?.snake?.paused ?? saved.game?.tetris?.paused).toBe(true);
  });
  it("closes a stale confirmation when another tab finishes, without replaying rewards", async () => {
    saved.game = session(games[1]); await mount(); await key("c"); delete saved.game; saved.revision++;
    await clock(15000); expect(document.querySelector(".game-abandon")).toBeNull(); expect(document.querySelector(".content-home")).toBeTruthy();
    expect(actions()).toHaveLength(0); expect(document.querySelector('.pet-scene[data-motion="celebrating"]')).toBeNull();
  });
});

describe("shared UTC quota and wallet visibility", () => {
  it("matches same-day, next-day, and backwards-day reward guards", () => {
    const e = saved.economy!; e.lastGameAt = Date.now(); e.gameCoins = 27;
    expect(gameAllowance(e, rules, Date.now())).toMatchObject({ daily: 3, available: 3 });
    expect(gameAllowance(e, rules, Date.now() + 86400000)).toMatchObject({ daily: 30, available: 30 });
    expect(gameAllowance(e, rules, Date.now() - 86400000)).toMatchObject({ daily: 0, available: 0 });
    expect(e.gameCoins).toBe(27);
  });
  it("rolls at UTC midnight, not the computer's local midnight", () => {
    const e = saved.economy!; e.lastGameAt = Date.parse("2026-10-19T23:59:59Z"); e.gameCoins = 30;
    expect(gameAllowance(e, rules, Date.parse("2026-10-19T23:59:59.999Z"))?.daily).toBe(0);
    expect(gameAllowance(e, rules, Date.parse("2026-10-20T00:00:00Z"))?.daily).toBe(30);
  });
  it("does not invent a cap or wallet for legacy or unavailable server rules", () => {
    expect(gameAllowance(undefined, rules, Date.now())).toBeNull(); expect(gameAllowance(saved.economy, null, Date.now())).toBeNull();
    expect(gameAllowance(saved.economy, { ...rules, maxCoins: undefined }, Date.now())).toMatchObject({ daily: 30, available: null });
    render(<ArcadePanel choice={0} now={Date.now()} shop={null} />); expect(screen.getByText(/当日额度待同步/)).toBeTruthy();
  });
  it("shows full or nearly full wallet constraints without changing the shared daily allowance", () => {
    saved.economy!.coins = rules.maxCoins!;
    expect(gameAllowance(saved.economy, rules, Date.now())).toMatchObject({ daily: 30, available: 0, walletFull: true });
    const view = render(<ArcadePanel choice={0} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(screen.getByText(/钱包已满/)).toBeTruthy(); saved.economy!.coins -= 2;
    view.rerender(<ArcadePanel choice={0} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(screen.getByText(/钱包还能收 2 币/)).toBeTruthy(); expect(screen.getByText(/剩 30 \/ 30 币/)).toBeTruthy();
  });
  it("allows starting a game at zero allowance and explains no coins before starting", async () => {
    saved.economy!.lastGameAt = Date.now(); saved.economy!.gameCoins = 30; await mount(); await select(0);
    expect(screen.getByText(/今日不再得币/)).toBeTruthy(); await key("b"); await key("b"); expect(saved.game).toBeTruthy();
  });
});

describe("saved game familiarity", () => {
  it("shows a selected game's saved familiarity without adding a new control", () => {
    const companion = { since: Date.now(), interests: [{ kind: "tetris" as const, points: 3, lastAt: Date.now() }] };
    const view = render(<ArcadePanel choice={3} companion={companion} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(screen.getByLabelText("共同游戏熟悉度").textContent).toContain("3 / 5");
    expect(screen.getByLabelText("共同游戏熟悉度").textContent).toContain("也可以换一款");
    expect(view.container.querySelector("button,a,input,[role=button]")).toBeNull();
  });

  it("does not show familiarity for an unselected or not-yet-familiar game", () => {
    const companion = { since: Date.now(), interests: [{ kind: "tetris" as const, points: 1, lastAt: Date.now() }] };
    const view = render(<ArcadePanel choice={0} companion={companion} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(view.container.querySelector('[aria-label="共同游戏熟悉度"]')).toBeNull();
  });

  it("shows a read-only game preference from saved growth habits", () => {
    const growth = emptyGrowth("growing"); growth.care.play = 3;
    const view = render(<ArcadePanel choice={2} growth={growth} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(screen.getByLabelText("成长倾向游戏提示").textContent).toContain("贪吃蛇");
    expect(screen.getByLabelText("成长倾向游戏提示").textContent).toContain("这款正合它的心情");
    expect(view.container.querySelector("button,a,input,[role=button]")).toBeNull();
  });

  it("keeps the preference quiet until growing habits have evidence", () => {
    const growth = emptyGrowth("growing");
    const view = render(<ArcadePanel choice={0} growth={growth} now={Date.now()} shop={rules} economy={saved.economy} />);
    expect(view.container.querySelector('[aria-label="成长倾向游戏提示"]')).toBeNull();
  });
});

describe("guide and confirmation edge cases", () => {
  it("protects an older star session that has no persisted id", async () => {
    saved.game = session(games[0]); delete saved.game.id; await mount(); await key("c"); await key("a");
    expect(saved.game).toBeTruthy(); expect(actions()).toHaveLength(0); await key("c"); await key("b");
    expect(actions()).toHaveLength(1); expect(actions()[0]).not.toHaveProperty("gameId");
  });
  it("cannot carry a previous game's confirmation into a new session from another tab", async () => {
    saved.game = session(games[1]); await mount(); await key("c"); saved.game.id = "another-saved-game"; saved.revision++;
    await clock(15000); expect(document.querySelector(".game-abandon")).toBeNull(); await key("b");
    expect(actions()).toEqual([expect.objectContaining({ kind: "tile-pick", gameId: "another-saved-game" })]);
  });
  it("only sends one cancellation while the save request is in flight", async () => {
    saved.game = session(games[1]); await mount(); await key("c");
    const normal = api.getMockImplementation()!; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    api.mockImplementation(async (path, body) => { if (path === "action" && (body as { kind: string ;}).kind === "cancel-play") await gate; return normal(path, body); });
    await key("b"); await key("b"); expect(actions()).toHaveLength(1); expect(saved.game).toBeTruthy();
    await act(async () => { release(); await gate; }); expect(saved.game).toBeUndefined();
  });
  it.each([games[2], games[3]])("closing help doesn't restart an unattended $id session", async info => {
    saved.game = session(info); await mount(); await key("c");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); });
    await clock(2000);
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await clock(2000); expect(actions().map(a => a.kind)).toEqual([`${info.id}-resume`]);
    expect(document.querySelector(info.id === "snake" ? ".snake-overlay" : ".tetris-overlay")).toBeTruthy();
  });
});

describe("playtest feedback: compact repeat entry", () => {
  it("gives all seven directory entries distinct nonempty symbols", () => {
    expect(games.every(game => game.icon.trim().length > 0)).toBe(true);
    expect(new Set(games.map(game => game.icon)).size).toBe(games.length);
  });
  it.each(games.map((game, index) => [game, index] as const))("lets a returning $0.id player start or explicitly reread both pages", async (info, index) => {
    rememberGuide(info.id); await mount(); await select(index); await key("b");
    expect(document.querySelector(".game-quick-start")?.textContent).toContain(info.title);
    expect(document.querySelector(".guide-steps")).toBeNull();
    expectGuideKeys(info, true);
    expect(screen.getByText(`A 重看规则 · ${gameStartInstruction(info, true)} · C 返回选游戏`)).toBeTruthy();
    expect(actions()).toHaveLength(0);
    if (info.id === "fishing") expect(screen.getByText("开局后按 B 手动抛竿，不会自动开始等待。")).toBeTruthy();
    await key("a");
    expect(document.querySelector(".game-quick-start")).toBeNull();
    expect(document.querySelector(".guide-steps")?.textContent).toBe(info.lesson);
    expectGuideKeys(info);
    await key("a"); expect(document.querySelector(".guide-steps")?.textContent).toBe(info.leaving);
    expectGuideKeys(info);
    await key("c"); expect(document.querySelector(`[data-game="${info.id}"][aria-current="true"]`)).toBeTruthy();
    await key("b"); expect(document.querySelector(".game-quick-start")).toBeTruthy();
    await key("b"); expect(actions().map(action => action.kind)).toEqual([info.startAction]);
    const game = saved.game!;
    if (info.id === "snake") expect(game.snake!.paused).toBe(true);
    if (info.id === "tetris") expect(game.tetris!.paused).toBe(true);
    if (info.id === "fishing") {
      expect(game.fishing!.phase).toBe("ready"); expect(game.fishing!.casts).toBe(0);
      expect(game.fishing!.paused).toBe(false);
    }
    if (info.id === "walk") expect(game.walking!.paused).toBe(true);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  });
  it.each(games.map((game, index) => [game, index] as const))("keeps the $0.id review B action consistent with its instruction", async (info, index) => {
    rememberGuide(info.id); await mount(); await select(index); await key("b");
    expectGuideKeys(info, true);
    await key("a"); expectGuideKeys(info);
    expect(actions()).toHaveLength(0);
    await key("b");
    expect(actions().map(action => action.kind)).toEqual([info.startAction]);
    expect(document.querySelector(".game-guide")).toBeNull();
    expect(saved.game).toBeTruthy();
  });
  it("does not offer a start action while the pet is sleeping", async () => {
    saved.sleeping = true;
    await mount();
    await select(0);
    await key("b");
    expect(document.querySelector(".game-guide")).toBeNull();
    expect(actions().filter(action => action.kind.startsWith("play"))).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("正在睡觉");
  });

  it("keeps a rejected repeat start on the compact card for an explicit retry", async () => {
    rememberGuide("walk"); failStart = true; await mount(); await select(5); await key("b"); await key("b");
    expect(document.querySelector(".game-quick-start")).toBeTruthy(); expect(saved.game).toBeUndefined();
    expect(screen.getByText("开局没有保存")).toBeTruthy();
    failStart = false; await key("b"); expect(saved.game?.kind).toBe("walk");
    expect(actions().map(action => action.kind)).toEqual(["play-walk", "play-walk"]);
  });
  it("keeps the shared lessons explicit about timing-sensitive controls", () => {
    expect(games.find(game => game.id === "fishing")!.lesson).toContain("提前提竿也会用掉这一竿");
    expect(games.find(game => game.id === "tetris")!.lesson).toContain("按 C 打开旋转、落底等操作");
    expect(games.find(game => game.id === "snake")!.lesson).toContain("果子方向和距离");
    expect(games.find(game => game.id === "snake")!.lesson).toContain("靠近围栏也会提醒");
  });
});

it.each(games.map((info, index) => ({ info, index, id: info.id })))("retains $id after leaving, starts only on explicit B and retains it after abandoning", async ({ info, index }) => {
  await mount(); await select(index); await key("c"); await select(0);
  expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe(info.id);
  await key("b"); expect(actions()).toHaveLength(0); expect(guideSeen(info.id)).toBe(false);
  await key("b"); expect(actions().map(a => a.kind)).toEqual([info.startAction]); expect(guideSeen(info.id)).toBe(true);
  // These games expose their pause menu before the abandon confirmation.
  if (info.id === "fishing") await key("c");
  await openConfirmation(info); await key("b");
  expect(saved.game).toBeUndefined();
  await select(0); expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe(info.id);
  const before = actions().length;
  await key("b"); expect(document.querySelector(".game-quick-start")).toBeTruthy();
  await key("c"); await clock(1000); expect(actions()).toHaveLength(before);
});

describe("game readiness follows saved energy", () => {
  it.each(games.map((info, index) => ({ info, index, id: info.id })))
    ("explains low energy before starting $id and leaves its rules readable", async ({ info, index }) => {
      saved.needs.energy = 9.999;
      await mount(); await select(index);
      expect(document.querySelector(".arcade-panel")?.textContent).toContain("体力不足 10");
      await key("b");
      expect(document.querySelector(".game-guide")?.textContent).toContain("体力不足 10（整数显示为 10）");
      expect(document.querySelector(".game-guide")?.textContent).toContain("B 暂不可开始");
      expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 暂不可开始");
      await key("a");
      expect(document.querySelector(".game-guide header")?.textContent).toContain("2 / 2");
      await key("b");
      expect(actions()).toHaveLength(0);
      expect(guideSeen(info.id)).toBe(false);
      expect(screen.getByRole("alert").textContent).toContain("睡个好觉");
      await key("c");
      expect(document.querySelector('[data-game="' + info.id + '"][aria-current="true"]')).toBeTruthy();
      expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
      expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
    });

  it("keeps the repeat card and rule review honest after energy falls, then enables an explicit start after recovery", async () => {
    rememberGuide("walk"); await mount(); await select(5); await key("b");
    expect(document.querySelector(".game-quick-start")?.textContent).toContain(gameStartInstruction(games[5], true));
    saved.needs.energy = 0; saved.revision++;
    await act(async () => { fireEvent.focus(window); });
    expect(document.querySelector(".game-quick-start")?.textContent).toContain("B 暂不可开始");
    await key("b"); expect(actions()).toHaveLength(0);
    await key("a");
    expect(document.querySelector(".game-guide")?.textContent).toContain("B 暂不可开始");
    saved.needs.energy = 10; saved.revision++;
    await act(async () => { fireEvent.focus(window); });
    expect(document.querySelector(".game-guide")?.textContent).not.toContain("B 暂不可开始");
    expect(actions()).toHaveLength(0); // State synchronization must not start a game.
    await key("b");
    expect(actions().map(a => a.kind)).toEqual(["play-walk"]);
    expect(saved.game?.walking?.paused).toBe(true);
  });

  it.each([10, 10.001])("allows explicit starts at an authoritative energy of %s", async energy => {
    saved.needs.energy = energy;
    await mount(); await select(0); await key("b");
    expect(document.querySelector(".game-guide")?.textContent).not.toContain("B 暂不可开始");
    await key("b");
    expect(actions().map(a => a.kind)).toEqual(["play"]);
  });
});
