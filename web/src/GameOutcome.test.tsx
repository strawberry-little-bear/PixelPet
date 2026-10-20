import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GameOutcome } from "./GameOutcome";
import { completedGameOutcome } from "./game-outcome";
import { games } from "./games";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef", at = Date.parse("2026-10-20T06:00:00Z");
const terminalActions = { stars: "catch", tiles: "tile-pick", snake: "snake-finish", tetris: "tetris-finish", fishing: "fish-finish", walk: "walk-finish", treasure: "treasure-finish" };
const fixture = (): PetState => ({ schema: 16, revision: 1, species: 2, name: "收好回忆", createdAt: at - 10000, hatchedAt: at - 9000,
  lastTick: at, sleeping: false, needs: { hunger: 70, mood: 80, clean: 80, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [],
  game: { id, kind: "snake", startedAt: at, round: 0, score: 0, lastBeat: -1,
    snake: { body: [{ x: 5, y: 5 }], food: { x: 8, y: 6 }, direction: 0, eaten: 0, step: 4, lastMoveAt: at, paused: true, end: "wall" } } });
const result = (state = fixture()): Result => ({ state, message: "一起吃到 0 颗果子！吃到 3 颗后完成才计入陪伴与金币，下次再试！", serverTime: at });
const outcome = () => screen.queryByLabelText("本页最近一次游戏结算");
const writes = () => api.mock.calls.filter(([p]) => !["state", "visit"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
let saved: PetState, generation: string, fail: string;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset(); saved = fixture(); generation = "a".repeat(32); fail = "";
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      if (fail) throw new RequestFailure("本次没有收到确认", fail as "unknown" | "rejected");
      const action = body as { kind: string };
      if (Object.values(terminalActions).includes(action.kind) || action.kind === "cancel-play") delete saved.game;
      saved.revision++;
      return { ...result(structuredClone(saved)), saveGeneration: generation };
    }
    return { ...result(structuredClone(saved)), message: "新的读取不是新的结算", saveGeneration: generation };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(games)("captures $id only after its own final action, without guessing score or wallet delta", game => {
  const before = fixture(); before.game!.kind = game.id === "stars" ? undefined : game.id;
  const after = structuredClone(before); delete after.game; after.revision++;
  const r = { ...result(after), message: "服务端最终成绩 · 实得 +0 金币" }, original = structuredClone(r);
  const receipt = completedGameOutcome(terminalActions[game.id], before, r);
  expect(receipt).toEqual({ kind: game.id, at, message: r.message, shared: null });
  expect(r).toEqual(original);
  render(<GameOutcome outcome={receipt} />);
  expect(outcome()?.textContent).toContain(game.title); expect(outcome()?.textContent).toContain("实得 +0 金币");
  expect(outcome()?.textContent).toContain("未提供共同游戏记录");
  expect(outcome()?.querySelector("button,a,input,[role=button]")).toBeNull(); expect(outcome()?.hasAttribute("aria-live")).toBe(false);
});
it.each([true, false])("separates shared memory from coins and habit credit (recorded=%s)", recorded => {
  const before = fixture(), after = structuredClone(before); delete after.game;
  after.companion = { since: at - 1000, interests: [], recent: { kind: "snake", id: recorded ? id : "old-session", at } };
  const receipt = completedGameOutcome("snake-finish", before, result(after));
  expect(receipt?.shared).toBe(recorded); render(<GameOutcome outcome={receipt} />);
  expect(outcome()?.textContent).toContain(recorded ? "不代表本次兴趣或成长增加" : "本局未新增共同游戏记录");
});
it("rejects cancellation, reads, nonfinal actions, missing IDs, replacement pets and unsafe metadata", () => {
  const before = fixture(), after = structuredClone(before); delete after.game;
  const r = result(after);
  for (const action of ["cancel-play", "state", "snake-step", "feed", "walk-finish"]) expect(completedGameOutcome(action, before, r)).toBeNull();
  expect(completedGameOutcome("snake-finish", before, result(before))).toBeNull();
  for (const key of ["createdAt", "hatchedAt", "species", "revision"] as const) {
    const changed = structuredClone(r); changed.state[key] = key === "revision" ? 0 : changed.state[key] + 1;
    expect(completedGameOutcome("snake-finish", before, changed)).toBeNull();
  }
  for (const message of ["", "  ", "x".repeat(4097), 1] as unknown[]) expect(completedGameOutcome("snake-finish", before, { ...r, message } as Result)).toBeNull();
  for (const serverTime of [0, NaN, Infinity, 8.64e15 + 1]) expect(completedGameOutcome("snake-finish", before, { ...r, serverTime })).toBeNull();
  delete before.game!.id; expect(completedGameOutcome("snake-finish", before, r)).toBeNull();
});
it("renders result text literally, not as markup or a derived coin balance", () => {
  render(<GameOutcome outcome={{ kind: "stars", at, message: "<b>不是标签</b>\n+0 金币", shared: null }} />);
  expect(outcome()?.textContent).toContain("<b>不是标签</b>"); expect(outcome()?.querySelector("b")).toBeNull();
});
it("App retains a failed-criteria completion after toast, fresh reads and status navigation", async () => {
  await mount(); expect(outcome()).toBeNull(); await key("b");
  const text = outcome()?.textContent; expect(text).toContain("一起吃到 0 颗果子");
  expect(outcome()?.querySelector("time")?.dateTime).toBe(new Date(at).toISOString());
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  saved.needs.hunger = 20; saved.revision++; await poll(); expect(outcome()?.textContent).toBe(text);
  await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b");
  expect(outcome()?.textContent).toBe(text); expect(document.querySelector(".lcd-meter b")?.textContent).toBe("20");
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(writes()).toHaveLength(1);
});
it("App never reconstructs a result on initial reads or remount", async () => {
  delete saved.game; await mount(); expect(outcome()).toBeNull(); await poll(); expect(outcome()).toBeNull();
  cleanup(); await mount(); expect(outcome()).toBeNull(); expect(writes()).toHaveLength(0);
});
it.each(["unknown", "rejected"])("App does not fabricate completion for a %s write", async reason => {
  await mount(); fail = reason; await key("b"); expect(outcome()).toBeNull();
  fail = ""; delete saved.game; saved.revision++;
  if (reason === "unknown") await key("b"); else await poll();
  expect(outcome()).toBeNull(); expect(writes()).toHaveLength(1);
});
it("App does not turn abandon confirmation into a completion receipt", async () => {
  delete saved.game!.snake!.end; await mount(); await key("b"); await key("b"); expect(outcome()).toBeNull(); expect(saved.game).toBeUndefined();
});
it("App clears a known result after generation replacement and does not rehydrate it", async () => {
  await mount(); await key("b"); expect(outcome()).toBeTruthy(); generation = "b".repeat(32); saved.revision++; await poll();
  expect(outcome()).toBeNull(); cleanup(); await mount(); expect(outcome()).toBeNull();
});

it.each(games)("App captures $id through its final three-key action (mocked terminal reply)", async game => {
  const base = { id, startedAt: at, round: 9, score: 2, lastBeat: -1 };
  saved.game = game.id === "stars" ? base
    : game.id === "tiles" ? { ...base, kind: "tiles", tiles: { board: [1,1,...Array<number>(14).fill(0)], pick: 1, pairs: 7, shuffles: 0 } }
    : game.id === "snake" ? saved.game
    : game.id === "tetris" ? { ...base, kind: "tetris", tetris: { board: Array<number>(96).fill(0), active: {kind:3,rotation:0,x:2,y:0}, next:1, bag:[4,5,6,7], lines:0,pieces:0,step:4,paused:true,lastFallAt:at,end:"stacked" } }
    : game.id === "fishing" ? { ...base, kind: "fishing", fishing: { spot:0,casts:3,catches:[],phase:"done",step:4,waitMs:32000,elapsedMs:5000,candidate:"reed-minnow",lastPulseAt:at,paused:true } }
    : game.id === "walk" ? { ...base, kind: "walk", walking: { route:Array<"rock">(12).fill("rock"),souvenirs:["leaf","shell","flower"],beat:72,step:4,cleared:0,pose:"",poseUntil:0,lastPulseAt:at,lastInputAt:0,paused:true } }
    : { ...base, kind: "treasure", treasure: {layout:[1,2,3,0,0,0,0,0,0],opened:[3,4,5,6,7,8],step:4,paused:true} };
  saved.companion = { since: at - 9000, interests: [], recent: {id,kind:game.id,at} };
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches(".game-outcome > h3") ? 80 : 0, top = 900;
    return {top,bottom:top+height,left:40,right:240,width:200,height,x:40,y:top,toJSON:()=>({})};
  });
  await mount(); expect(window.scrollBy).not.toHaveBeenCalled(); await key("b");
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:888,behavior:"instant"});
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({kind:terminalActions[game.id],gameId:id});
  expect(outcome()?.textContent).toContain(game.title); expect(outcome()?.textContent).toContain("本局共同游戏已记录");
});
it("ordinary care keeps the last game result, but an uncertain write clears it before recovery", async () => {
  await mount(); await key("b"); const text = outcome()?.textContent; expect(text).toBeTruthy();
  await key("a"); await key("b"); await key("c"); // feed, skip care motion
  expect(outcome()?.textContent).toBe(text);
  fail = "unknown"; await key("a"); await key("b"); expect(outcome()).toBeNull();
  fail = ""; await key("b"); expect(outcome()).toBeNull();
});
it("a subsequent accepted completion replaces, rather than appends to, the page receipt", async () => {
  await mount(); await key("b"); expect(outcome()).toBeTruthy();
  saved.game = fixture().game; saved.game!.id = "another-session"; saved.revision++; await poll();
  api.mockImplementationOnce(async () => {
    delete saved.game; saved.revision++;
    return {...result(structuredClone(saved)),message:"第二局服务端结算原文",saveGeneration:generation};
  });
  await key("b"); expect(outcome()?.textContent).toContain("第二局服务端结算原文");
  expect(screen.getAllByLabelText("本页最近一次游戏结算")).toHaveLength(1);
});
it("an old server's empty completion message is not replaced with an invented receipt", async () => {
  await mount(); api.mockImplementationOnce(async () => {
    delete saved.game; saved.revision++; return {...result(structuredClone(saved)),message:"",saveGeneration:generation};
  });
  await key("b"); expect(saved.game).toBeUndefined(); expect(outcome()).toBeNull();
});
it.each(["unavailable", "corrupt", "clock"] as const)("clears stale results across %s recovery without rebuilding them", async kind => {
  await mount(); await key("b"); expect(outcome()).toBeTruthy();
  api.mockRejectedValueOnce(new RequestFailure("读取失败", "unavailable", kind === "corrupt" ? "save_corrupt" : kind === "clock" ? "clock_ahead" : undefined));
  await poll(); expect(outcome()).toBeNull(); await key("b"); expect(outcome()).toBeNull();
});
it.each(["import", "reset"] as const)("explicit %s clears the page result even for the same pet", async kind => {
  await mount(); await key("b"); expect(outcome()).toBeTruthy();
  if (kind === "import") {
    const body = JSON.stringify(saved), file = new File([body], "same-pet.json");
    Object.defineProperty(file, "text", {value:async () => body});
    await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), {target:{files:[file]}}); });
    await key("b");
  } else {
    await act(async () => { fireEvent.click(screen.getByRole("button", {name:/存档盒/})); });
    await act(async () => { fireEvent.click(screen.getByRole("button", {name:"重新开始"})); });
    await act(async () => { fireEvent.click(screen.getByRole("button", {name:"确认重新开始"})); });
  }
  expect(outcome()).toBeNull(); expect(writes()).toHaveLength(2);
});

describe("acknowledged game result reading position", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const height = this.matches(".game-outcome > h3") ? 80 : 0, top = 900;
      return {top,bottom:top+height,left:40,right:240,width:200,height,x:40,y:top,toJSON:()=>({})};
    });
  });
  it("positions an offscreen result exactly once and preserves physical key focus", async () => {
    await mount(); expect(window.scrollBy).not.toHaveBeenCalled();
    const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
    await key("b"); expect(outcome()).toBeTruthy();
    expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:888,behavior:"instant"});
    expect(document.activeElement).toBe(button);
    await poll(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
    await key("a"); for (let i=0;i<4;i++) await key("a"); await key("b"); await key("c");
    fireEvent.click(screen.getByRole("button",{name:"玩法说明"})); fireEvent.click(screen.getByRole("button",{name:"关闭"}));
    expect(window.scrollBy).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(1);
  });
  it("keeps an already visible heading still", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({top:40,bottom:120,left:40,right:240,width:200,height:80,x:40,y:40,toJSON:()=>({})}));
    await mount(); await key("b"); expect(outcome()).toBeTruthy(); expect(window.scrollBy).not.toHaveBeenCalled();
  });
  it("also brings an above-viewport heading back into view", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this: HTMLElement) {
      const height=this.matches(".game-outcome > h3")?80:0,top=-500;
      return {top,bottom:top+height,left:40,right:240,width:200,height,x:40,y:top,toJSON:()=>({})};
    });
    await mount(); await key("b"); expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:-512,behavior:"instant"});
  });
  it.each(["unknown","rejected"])("does not navigate from a %s completion or its recovery read", async reason => {
    await mount(); fail=reason; await key("b"); expect(window.scrollBy).not.toHaveBeenCalled();
    fail=""; delete saved.game; saved.revision++; if(reason==="unknown")await key("b"); else await poll();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
  it("does not navigate for a plain read of an already completed game", async () => {
    delete saved.game; await mount(); await poll(); expect(window.scrollBy).not.toHaveBeenCalled();
  });
  it.each(["help","background","evolution"] as const)("discards navigation interrupted by %s, without replay", async interruption => {
    await mount(); let resolve!: (r: Result) => void;
    api.mockImplementationOnce(() => new Promise<Result>(done => {resolve=done;}));
    await key("b");
    if(interruption==="help") fireEvent.click(screen.getByRole("button",{name:"玩法说明"}));
    if(interruption==="background") {
      Object.defineProperty(document,"hidden",{configurable:true,value:true});
      await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));});
    }
    delete saved.game; saved.revision++;
    if(interruption==="evolution") {saved.growth=emptyGrowth("growing");saved.growth.points=24;saved.growth.growingAt=at;}
    await act(async()=>{resolve({...result(structuredClone(saved)),saveGeneration:generation});});
    expect(window.scrollBy).not.toHaveBeenCalled();
    if(interruption==="help") fireEvent.click(screen.getByRole("button",{name:"关闭"}));
    if(interruption==="background") {
      Object.defineProperty(document,"hidden",{configurable:true,value:false}); await poll();
    }
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(outcome()).toBeTruthy(); expect(window.scrollBy).not.toHaveBeenCalled();
  });
  it("does not replay a receipt's old navigation after same-pet restore", async () => {
    await mount(); await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
    generation="b".repeat(32); saved.revision++; await poll(); expect(outcome()).toBeNull();
    await poll(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  });
});
