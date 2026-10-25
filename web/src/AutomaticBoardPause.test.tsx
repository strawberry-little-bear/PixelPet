import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { TetrisStepInterval } from "./TetrisGame";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
let saved: PetState;
const calls = () => api.mock.calls.filter(c => c[0] === "action").map(c => c[1] as {kind: string; step: number; turn?: number});
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, {key}); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe.each(["snake", "tetris"] as const)("%s automatic step pause ordering", kind => {
 const interval = kind === "snake" ? 650 : TetrisStepInterval + 50;
 const model = () => kind === "snake" ? saved.game!.snake! : saved.game!.tetris!;
 const overlay = () => document.querySelector(`.${kind}-overlay`);
 beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", {configurable: true, value: false});
  saved = {schema: 6, revision: 1, species: 2, name: "草莓兔", createdAt: Date.now()-10000,
   hatchedAt: Date.now()-9000, lastTick: Date.now(), sleeping: false, needs: {hunger:70,mood:70,clean:80,energy:80},
   careCount: 0, growth: emptyGrowth("baby"), logs: [], economy: {coins:0,lastDailyAt:0,lastGameAt:0,gameCoins:0,owned:[],equipped:{accessory:"",room:""}},
   game: {id,kind,startedAt:Date.now(),round:0,score:0,lastBeat:-1,
    ...(kind === "snake" ? {snake:{body:[{x:4,y:5},{x:3,y:5},{x:2,y:5}],food:{x:9,y:9},eaten:0,step:0,direction:0,paused:true,lastMoveAt:Date.now()}}
     : {tetris:{board:Array(96).fill(0),active:{kind:3,rotation:0,x:2,y:0},next:1,bag:[4,5,6,7],lines:0,pieces:0,step:0,paused:true,lastFallAt:Date.now()}})}};
  api.mockImplementation(async (path, body) => {
   if (path === "action") {
    const a = body as {kind:string;step:number;turn?:number}, n = model();
    if (a.step !== n.step) throw new RequestFailure("stale step", "rejected");
    if (a.kind === `${kind}-pause`) n.paused = true;
    if ([`${kind}-resume`, "tetris-rotate", "tetris-drop"].includes(a.kind)) {
     n.paused = false;
     if (kind === "snake") saved.game!.snake!.lastMoveAt = Date.now(); else saved.game!.tetris!.lastFallAt = Date.now();
    }
    if (kind === "tetris") {
     const t = saved.game!.tetris!;
     if (a.kind === "tetris-step") { t.active!.y++; t.lastFallAt = Date.now(); }
     if (a.kind === "tetris-move") t.active!.x += a.turn!;
     t.step++;
    } else if (a.kind === "snake-step") {
     const s = saved.game!.snake!; s.step++; s.direction = (s.direction + (a.turn || 0) + 4) % 4; s.lastMoveAt = Date.now();
    }
    if (a.kind === `${kind}-finish`) delete saved.game;
    saved.revision++;
   }
   return {state:structuredClone(saved),message:"",serverTime:Date.now()};
  });
 });
 async function pendingStep() {
  await mount(); await key("c");
  const normal = api.getMockImplementation()!;
  let resolve!: (r: Result) => void, reject!: (e: unknown) => void;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind:string}).kind === `${kind}-step`
   ? new Promise((yes,no) => { resolve=yes; reject=no; }) : normal(...args));
  await clock(interval);
  expect(calls().at(-1)?.kind).toBe(`${kind}-step`);
  return {normal,resolve,reject};
 }
 it("accepts physical C, stops locally, and serializes one pause with the acknowledged step", async () => {
  const p = await pendingStep();
  expect(screen.getByRole("button",{name:"C 返回"}).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("button",{name:"A 选择"}).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button",{name:"B 确认"}).hasAttribute("disabled")).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button",{name:"C 返回"})); });
  await key("c"); await key("a"); await key("b");
  expect(overlay()).toBeTruthy();
  await clock(5000); expect(calls()).toHaveLength(2);
  await act(async () => { p.resolve(await p.normal("action",calls()[1])); });
  expect(calls().map(a=>a.kind)).toEqual([`${kind}-resume`,`${kind}-step`,`${kind}-pause`]);
  expect(calls()[2]).toMatchObject({gameId:id,step:kind === "snake" ? 1 : 2});
  expect(model().paused).toBe(true);
  await clock(5000); expect(calls()).toHaveLength(3);
  expect(saved.careCount).toBe(0); expect(saved.economy!.coins).toBe(0);
 });
 it("does not lose C in the pre-paint busyRef window", async () => {
  await mount(); await key("c"); const normal=api.getMockImplementation()!;
  let resolve!: (r:Result)=>void;
  api.mockImplementation((...args)=>args[0]==="action" && (args[1] as {kind:string}).kind===`${kind}-step`
   ? new Promise(yes=>{resolve=yes;}) : normal(...args));
  const button=screen.getByRole("button",{name:"C 返回"});
  await act(async()=>{vi.advanceTimersByTime(interval);expect(calls().at(-1)?.kind).toBe(`${kind}-step`);fireEvent.click(button);});
  expect(overlay()).toBeTruthy();
  await act(async()=>{resolve(await normal("action",calls()[1]));});
  expect(calls().at(-1)?.kind).toBe(`${kind}-pause`);
 });
 it("does not buffer A/B movement behind the automatic step", async()=>{
  const p=await pendingStep();await key("a");await key("b");await key("c");
  expect(overlay()).toBeTruthy();
  await act(async()=>{p.resolve(await p.normal("action",calls()[1]));});
  await key("c");await clock(interval);
  expect(calls().filter(a=>a.kind==="tetris-move")).toHaveLength(0);
  if(kind==="snake") expect(calls().filter(a=>a.kind==="snake-step").map(a=>a.turn)).toEqual([0,0]);
 });
 if (kind === "snake") it("keeps the turn already sent with a step but never replays it after resuming", async()=>{
  await mount();await key("c");await key("a");
  const normal=api.getMockImplementation()!;let resolve!:(r:Result)=>void;
  api.mockImplementation((...args)=>args[0]==="action"&&(args[1] as {kind:string}).kind==="snake-step"
   ?new Promise(yes=>{resolve=yes;}):normal(...args));
  await clock(interval);expect(calls()[1].turn).toBe(-1);
  await key("c");
  await act(async()=>{resolve(await normal("action",calls()[1]));});
  expect(saved.game!.snake!.direction).toBe(3);
  api.mockImplementation(normal);await key("c");await clock(interval);
  expect(calls().filter(a=>a.kind==="snake-step").map(a=>a.turn)).toEqual([-1,0]);
  expect(saved.game!.snake!.direction).toBe(3);
 });
 it("locks the pause save itself without repeated C or automatic resumes", async()=>{
  const p=await pendingStep();await key("c"); const pendingAPI=api.getMockImplementation()!;
  let resolve!: (r:Result)=>void;
  api.mockImplementation((...args)=>args[0]==="action" && (args[1] as {kind:string}).kind===`${kind}-pause`
   ? new Promise(yes=>{resolve=yes;}) : pendingAPI(...args));
  await act(async()=>{p.resolve(await p.normal("action",calls()[1]));});
  expect(calls()).toHaveLength(3);
  expect(screen.getByRole("button",{name:"C 返回"}).hasAttribute("disabled")).toBe(true);
  await key("c");await key("c");await clock(5000);expect(calls()).toHaveLength(3);
  await act(async()=>{resolve(await p.normal("action",calls()[2]));});
  await clock(5000);expect(calls()).toHaveLength(3);expect(model().paused).toBe(true);
 });
 it.each(["won", "limit", "lost"])("never turns pending C into collection at %s",async end=>{
  const p=await pendingStep();await key("c");expect(overlay()).toBeTruthy();
  await act(async()=>{
   const reply=await p.normal("action",calls()[1]);
   if(kind==="snake") reply.state.game!.snake!.end=end==="lost"?"wall":end as "won"|"limit";
   else {reply.state.game!.tetris!.end=end==="lost"?"stacked":end as "won"|"limit";delete reply.state.game!.tetris!.active;}
   saved=structuredClone(reply.state);p.resolve(reply);
  });
  await clock(5000);expect(calls()).toHaveLength(2);
  await key("a");expect(calls()).toHaveLength(2);
  await key("b");expect(calls().at(-1)?.kind).toBe(`${kind}-finish`);
 });
 it.each(["generation","session","already-paused","unmount","no-game"])("discards pending C after %s",async change=>{
  const p=await pendingStep();await key("c");expect(overlay()).toBeTruthy();
  await act(async()=>{const reply=await p.normal("action",calls()[1]);
   if(change==="generation")reply.saveGeneration="fedcba9876543210fedcba9876543210";
   if(change==="session")reply.state.game!.id="fedcba9876543210fedcba9876543210";
   if(change==="already-paused") {if(kind==="snake")reply.state.game!.snake!.paused=true;else reply.state.game!.tetris!.paused=true;}
   if(change==="no-game")delete reply.state.game;
   if(change==="unmount")cleanup();p.resolve(reply);
  });
  await clock(5000);expect(calls()).toHaveLength(2);
 });
 it("revalidates once on pageshow without resuming the paused board", async () => {
  await mount();
  const before = api.mock.calls.length;
  await act(async () => {
   window.dispatchEvent(new Event("pagehide"));
   window.dispatchEvent(new Event("pageshow"));
   await Promise.resolve();
  });
  expect(api.mock.calls.slice(before).some(([path]) => path === "visit" || path === "state")).toBe(true);
  expect(calls()).toHaveLength(0);
  expect(model().paused).toBe(true);
 });
 it("does not restore a queued pause when pagehide is followed by pageshow", async () => {
  const p = await pendingStep();
  await key("c");
  await act(async () => {
   window.dispatchEvent(new Event("pagehide"));
   window.dispatchEvent(new Event("pageshow"));
  });
  await act(async () => { p.resolve(await p.normal("action", calls()[1])); });
  await clock(5000);
  expect(calls()).toHaveLength(2);
 });
 it.each(["blur","help","tools","hidden","pagehide"])("invalidates pending C after %s",async interruption=>{
  const p=await pendingStep();await key("c");expect(overlay()).toBeTruthy();
  await act(async()=>{
   if(interruption==="blur")window.dispatchEvent(new Event("blur"));
   else if(interruption==="pagehide")window.dispatchEvent(new Event("pagehide"));
   else if(interruption==="help")fireEvent.click(screen.getByRole("button",{name:"玩法说明"}));
   else if(interruption==="tools")fireEvent.click(screen.getByRole("button",{name:"存档盒"}));
   else {Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));}
  });
  await act(async()=>{p.resolve(await p.normal("action",calls()[1]));});
  await clock(5000);expect(calls()).toHaveLength(2);
 });
 it.each(["unknown","rejected"] as const)("does not replay after a %s step and readback",async outcome=>{
  const p=await pendingStep();await key("c");expect(overlay()).toBeTruthy();
  let readsAvailable=outcome!=="unknown";const pendingAPI=api.getMockImplementation()!;
  api.mockImplementation((...args)=>args[0]==="state"&&!readsAvailable
   ?Promise.reject(new RequestFailure("暂时不能核对","unavailable")):pendingAPI(...args));
  await act(async()=>{p.reject(new RequestFailure("步进未确认",outcome));});
  await clock(5000);readsAvailable=true;if(outcome==="unknown")await key("b");
  await clock(5000);expect(calls()).toHaveLength(2);expect(overlay()).toBeTruthy();
 });
 it.each(["unknown","rejected"] as const)("does not retry a %s pause save",async outcome=>{
  const p=await pendingStep();await key("c");const pendingAPI=api.getMockImplementation()!;
  api.mockImplementation((...args)=>args[0]==="action"&&(args[1] as {kind:string}).kind===`${kind}-pause`
   ?Promise.reject(new RequestFailure("暂停未确认",outcome)):pendingAPI(...args));
  await act(async()=>{p.resolve(await p.normal("action",calls()[1]));});
  await clock(16000);expect(calls().map(a=>a.kind)).toEqual([`${kind}-resume`,`${kind}-step`,`${kind}-pause`]);
  cleanup();await mount();await clock(5000);expect(calls()).toHaveLength(3);expect(overlay()).toBeTruthy();
 });
 it.each(kind === "snake" ? ["snake-resume"] : ["tetris-resume","tetris-move","tetris-rotate","tetris-drop"])("does not queue C behind explicit %s",async action=>{
  await mount();if(action==="tetris-move")await key("c");
  if(action==="tetris-rotate"||action==="tetris-drop") {await key("a");if(action==="tetris-drop")await key("a");}
  const normal=api.getMockImplementation()!;let resolve!:(r:Result)=>void;
  api.mockImplementation((...args)=>args[0]==="action"&&(args[1] as {kind:string}).kind===action
   ?new Promise(yes=>{resolve=yes;}):normal(...args));
  await key(action.endsWith("resume")?"c":action==="tetris-move"?"a":"b");
  expect(calls().at(-1)?.kind).toBe(action);
  await key("c");expect(screen.getByRole("button",{name:"C 返回"}).hasAttribute("disabled")).toBe(true);
  await act(async()=>{resolve(await normal("action",calls().at(-1)));});
  expect(calls().filter(a=>a.kind===`${kind}-pause`)).toHaveLength(0);
 });
});
