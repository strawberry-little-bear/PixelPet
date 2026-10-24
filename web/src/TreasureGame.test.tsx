import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { TreasureGame } from "./TreasureGame";
import { nextTreasure, treasureCell, treasureDone, treasureFound } from "./treasure";
import { validCoreResponse } from "./response";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import { request } from "./api";
import type { PetState, Result, TreasureHunt } from "./types";
vi.mock("./api",()=>({request:vi.fn()}));
const api=vi.mocked(request), id="0123456789abcdef0123456789abcdef";
let saved:PetState, failure:string, delayResume:boolean, delayDig:boolean, release:()=>void;
const model=():TreasureHunt=>({layout:[1,2,3,0,0,0,0,0,0],opened:[],step:0,paused:true});
const fixture=():PetState=>({schema:16,revision:1,species:2,name:"草莓兔",createdAt:Date.now()-10000,hatchedAt:Date.now()-9000,lastTick:Date.now(),sleeping:false,needs:{hunger:70,mood:70,energy:80,clean:80},careCount:0,growth:emptyGrowth("baby"),logs:[],game:{id,kind:"treasure",treasure:model(),startedAt:Date.now(),round:0,score:0,lastBeat:-1}});
const calls=()=>api.mock.calls.filter(c=>c[0]==="action").map(c=>c[1] as {kind:string;step?:number;tile?:number;gameId?:string});
const response=():Result=>({state:structuredClone(saved),message:"",serverTime:Date.now()});
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key})})}
async function clock(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)})}
async function mount(){await act(async()=>{render(<App/>);})}
async function hidden(value:boolean){Object.defineProperty(document,"hidden",{configurable:true,value});await act(async()=>{fireEvent(document,new Event("visibilitychange"));})}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));localStorage.clear();api.mockReset();saved=fixture();failure="";delayResume=false;delayDig=false;
 api.mockImplementation(async(path,body)=>{
  if(path!=="action")return response();
  const a=body as {kind:string;step:number;tile:number};
  if(a.kind===failure)throw new RequestFailure("没有保存本次操作","rejected");
  const n=saved.game?.treasure;
  if(n){if(a.kind==="treasure-resume")n.paused=false;if(a.kind==="treasure-pause")n.paused=true;
   if(a.kind==="treasure-dig"){n.opened.push(a.tile);if(treasureDone(n))n.paused=true;}n.step++;
  }
  if(a.kind==="treasure-finish"||a.kind==="cancel-play")delete saved.game;
  saved.revision++;
  const r=response();if((a.kind==="treasure-resume"&&delayResume)||(a.kind==="treasure-dig"&&delayDig))await new Promise<void>(resolve=>{release=resolve});return r;
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();Object.defineProperty(document,"hidden",{configurable:true,value:false});});

describe("untimed treasure presentation",()=>{
 it("hides every unsearched item and clue, skips searched cells and wraps",()=>{
  const n=model();expect(treasureCell(n,0)).toEqual({opened:false,item:0,nearby:null});
  n.opened=[3];expect(treasureCell(n,3)).toEqual({opened:true,item:0,nearby:2});expect(nextTreasure(n,2)).toBe(4);expect(nextTreasure(n,8)).toBe(0);
  expect(treasureCell(n,1)).toEqual({opened:false,item:0,nearby:null});
 });
 it("counts eight neighbors, not only four, across every legal placement",()=>{
  for(let a=0;a<9;a++)for(let b=a+1;b<9;b++)for(let c=b+1;c<9;c++)for(let cell=0;cell<9;cell++){
   if([a,b,c].includes(cell))continue;
   const n=model();n.layout=Array<number>(9).fill(0);[a,b,c].forEach((i,k)=>n.layout[i]=k+1);n.opened=[cell];
   const expected=[a,b,c].filter(i=>Math.abs((i%3)-(cell%3))<=1 && Math.abs(Math.floor(i/3)-Math.floor(cell/3))<=1).length;
   expect(treasureCell(n,cell).nearby).toBe(expected);
  }
 });
 it("terminal reveal never fabricates found items; grid has no clickable controls",()=>{
  saved.game!.treasure!.opened=[3,4,5,6,7,8];saved.game!.treasure!.paused=true;
  render(<TreasureGame pet={saved} active cursor={0} choice={0}/>);
  expect(treasureDone(saved.game!.treasure!)).toBe(true);expect(treasureFound(saved.game!.treasure!)).toBe(0);
  expect(screen.getByText(/实际找到 0 件/)).toBeTruthy();expect(screen.getAllByText("留在林间")).toHaveLength(3);
  expect(screen.getAllByRole("gridcell")).toHaveLength(9);expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
 });
 it.each([
  (n:TreasureHunt)=>{n.layout=[]},(n:TreasureHunt)=>{n.layout[0]=4},(n:TreasureHunt)=>{n.opened=[0,0]},
  (n:TreasureHunt)=>{n.opened=[9]},(n:TreasureHunt)=>{n.step=NaN},(n:TreasureHunt)=>{n.step=1000001},
  (n:TreasureHunt)=>{n.paused=undefined as unknown as boolean},
 ])("rejects malformed render-critical models",mutate=>{mutate(saved.game!.treasure!);expect(validCoreResponse(response())).toBe(false)});
});

describe("visible treasure clue range", () => {
 const source = () => document.querySelector('[data-clue-source=true]');
 it("labels every neighbor, including a found object, without leaking unopened items or adding controls", () => {
  saved.game!.treasure!.opened=[3,0];
  render(<TreasureGame pet={saved} active cursor={4} choice={0}/>);
  expect(source()?.getAttribute("aria-label")).toContain("最近空地线索");
  expect(source()?.textContent).toContain("线索");
  expect(document.querySelector(".treasure-clue")?.textContent).toContain("4号格 · 数字 2");
  expect(document.querySelector(".treasure-clue")?.textContent).toContain("含斜角及已找到的小物");
  const neighbors=[...document.querySelectorAll('[data-clue-neighbor=true]')];
  expect(neighbors).toHaveLength(5);
  expect(neighbors[0].getAttribute("aria-label")).toContain("小松果，已找到");
  expect(neighbors[0].getAttribute("aria-label")).toContain("在4号格线索范围内");
  expect(neighbors[1].getAttribute("aria-label")).toContain("未探索");
  expect(document.querySelector(".treasure-grid")?.textContent).not.toMatch(/轻羽毛|光滑石/);
  expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
 });
 it.each([[0],[0,1,2],[3,4,5,6,7,8]].map(opened=>({opened})))("does not mark a range without a source or at terminal reveal: $opened", ({opened}) => {
  saved.game!.treasure!.opened=opened;
  render(<TreasureGame pet={saved} active cursor={4} choice={0}/>);
  expect(source()).toBeNull();expect(document.querySelector(".treasure-clue")).toBeNull();
  expect(document.querySelectorAll('[data-clue-neighbor=true]')).toHaveLength(0);
 });
 it("keeps the source through A, pause, reload and finding an object, replacing only after an accepted empty dig", async () => {
  saved.game!.treasure!.opened=[3];await mount();
  expect(source()?.getAttribute("aria-label")).toMatch(/^4号格/);
  await key("c");await key("a");await key("a"); // Select object 3, not a new empty clue.
  expect(calls()).toHaveLength(1);expect(source()?.getAttribute("aria-label")).toMatch(/^4号格/);
  await key("b");expect(document.querySelector(".treasure-result")?.textContent).toContain("光滑石");
  expect(source()?.getAttribute("aria-label")).toMatch(/^4号格/);
  await key("c");cleanup();await mount();
  expect(document.querySelector(".treasure-pause")).toBeTruthy();expect(source()?.getAttribute("aria-label")).toMatch(/^4号格/);
  await key("c");await key("a"); // Skip object 1 to object 2, then empty 5.
  await key("a");delayDig=true;await key("b");
  expect(source()?.getAttribute("aria-label")).toMatch(/^4号格/);
  await act(async()=>release());expect(source()?.getAttribute("aria-label")).toMatch(/^5号格/);
  expect(calls().filter(a=>a.kind==="treasure-dig")).toHaveLength(2);
 });
 it("never invents a clue for a rejected exploration or retries it", async () => {
  await mount();await key("c");await key("a");await key("a");await key("a");
  failure="treasure-dig";await key("b");await clock(20000);
  expect(source()).toBeNull();expect(document.querySelector(".treasure-clue")).toBeNull();
  expect(calls().filter(a=>a.kind==="treasure-dig")).toHaveLength(1);
 });
});

describe("three-key treasure flow",()=>{
 it("explains pause choices through rules, continuing, a saved dig and cancelled discard",async()=>{
  saved.game!.treasure!.opened=[0,3];saved.game!.treasure!.step=4;
  await mount();
  const hint=()=>document.querySelector(".treasure-pause-hint")?.textContent;
  expect(hint()).toContain("仍选中 2 号未探索格");
  await key("a");expect(hint()).toContain("不消耗探索次数");await key("b");
  expect(document.querySelector(".game-guide")).toBeTruthy();await key("b");await key("c");
  expect(hint()).toContain("不消耗探索次数");await key("a");
  expect(hint()).toContain("先打开放弃确认");expect(calls()).toHaveLength(0);
  // C always continues, even when discard is selected; it never confirms it.
  await key("c");expect(hint()).toBeUndefined();expect(calls().map(a=>a.kind)).toEqual(["treasure-resume"]);
  expect(saved.game!.treasure!.opened).toEqual([0,3]);await key("b");
  expect(calls().at(-1)).toEqual(expect.objectContaining({kind:"treasure-dig",tile:1,step:5,gameId:id}));
  await key("c");expect(hint()).toContain("仍选中 3 号未探索格");
  const before=structuredClone(saved.game), count=calls().length;
  await key("a");await key("a");await key("b");
  expect(document.querySelector(".game-abandon")).toBeTruthy();await key("c");
  expect(hint()).toContain("仍选中 3 号未探索格");
  expect(calls()).toHaveLength(count);expect(saved.game).toEqual(before);
 });

 it("never runs from a read or elapsed time; explicit resume then A selects and B digs",async()=>{
  saved.game!.treasure!.paused=false;await mount();await clock(60000);
  expect(calls()).toHaveLength(0);expect(document.querySelector(".treasure-pause")).toBeTruthy();
  await key("c");await key("a");expect(calls().map(a=>a.kind)).toEqual(["treasure-resume"]);
  await key("b");expect(calls().at(-1)).toEqual(expect.objectContaining({kind:"treasure-dig",tile:1,step:1,gameId:id}));
  expect(screen.getByRole("gridcell",{name:/3号格/}).getAttribute("aria-selected")).toBe("true");
  await clock(60000);expect(calls()).toHaveLength(2);
  await key("c");expect(calls().at(-1)?.kind).toBe("treasure-pause");
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);expect(document.querySelectorAll(".lcd button,.lcd a,.lcd [role=button]")).toHaveLength(0);
 });
 it("rules are read-only and return to pause, including a locally paused server session",async()=>{
  saved.game!.treasure!.paused=false;await mount();await key("a");await key("b");
  expect(document.querySelector(".game-guide")).toBeTruthy();await key("b");await key("c");await clock(20000);
  expect(calls()).toHaveLength(0);expect(document.querySelector(".treasure-pause")).toBeTruthy();await key("c");expect(calls().at(-1)?.kind).toBe("treasure-resume");
 });
 it("requires abandon confirmation; A/C cancel without writing and B confirms original session",async()=>{
  await mount();for(const k of ["a","a","b"])await key(k);expect(document.querySelector(".game-abandon")).toBeTruthy();
  await key("c");expect(calls()).toHaveLength(0);for(const k of ["a","a","b"])await key(k);await key("b");
  expect(calls()).toEqual([expect.objectContaining({kind:"cancel-play",gameId:id})]);expect(document.querySelector(".content-home")).toBeTruthy();
 });
 it.each(["hidden","blur","help","tools"])("%s clears local permission without spending an exploration",async reason=>{
  await mount();await key("c");
  if(reason==="hidden"){await hidden(true);await hidden(false)}
  else if(reason==="blur"){await act(async()=>{fireEvent.blur(window);fireEvent.focus(window)})}
  else if(reason==="help"){await act(async()=>fireEvent.click(screen.getByRole("button",{name:"玩法说明"})));await act(async()=>fireEvent.click(screen.getByRole("button",{name:"关闭"})))}
  else {await act(async()=>fireEvent.click(screen.getByRole("button",{name:"存档盒"})));await act(async()=>fireEvent.click(screen.getByRole("button",{name:"存档盒"})))}
  await clock(5000);expect(calls()).toHaveLength(1);expect(document.querySelector(".treasure-pause")).toBeTruthy();
 });
 it("a late resume acknowledgement cannot reactivate after backgrounding",async()=>{
  delayResume=true;await mount();await key("c");await hidden(true);await hidden(false);await act(async()=>release());await clock(5000);
  expect(calls()).toHaveLength(1);expect(document.querySelector(".treasure-pause")).toBeTruthy();
 });
 it.each(["treasure-resume","treasure-dig"])("rejected %s neither retries nor invents progress",async kind=>{
  failure=kind;await mount();await key("c");if(kind==="treasure-dig")await key("b");
  const count=calls().length;await clock(20000);expect(calls()).toHaveLength(count);expect(saved.game!.treasure!.opened).toHaveLength(0);
 });
 it.each(["b","c"])("only explicit %s collects completed explorations, A and time never settle",async finishKey=>{
  saved.game!.treasure!.opened=[3,4,5,6,7,8];await mount();await key("a");await clock(20000);expect(calls()).toHaveLength(0);
  await key(finishKey);expect(calls()).toEqual([expect.objectContaining({kind:"treasure-finish",gameId:id,step:0})]);expect(document.querySelector(".content-home")).toBeTruthy();
 });
 it.each([
  { reason: "credited", points: .25, habitGain: 1 },
  { reason: "credited", points: 0, habitGain: 1 },
  { reason: "cooldown", points: 0, habitGain: 0 },
 ] as const)("keeps confirmed treasure learning after the toast and later reads: $reason/$points", async result => {
  saved.game!.treasure!.opened=[3,4,5,6,7,8];
  const original=api.getMockImplementation()!;
  api.mockImplementation(async(path,body)=>{
   const r=await original(path,body);
   if(path==="action"&&(body as {kind:string}).kind==="treasure-finish"){
    r.careFeedback={kind:"treasure-finish",habit:"play",...result,effect:{at:Date.now(),before:{...saved.needs},after:{...saved.needs,mood:80}}};
   }
   return r;
  });
  await mount();expect(screen.queryByLabelText("本次成长与习惯")).toBeNull();await key("b");
  const learning=screen.getByLabelText("本次成长与习惯");
  expect(learning.textContent).toContain(result.points === 0 ? "本次没有新增成长点" : `本次成长：+${result.points.toFixed(2)} 点`);
  expect(learning.textContent).toContain(result.habitGain === 0 ? "陪玩习惯：本次不计入" : `陪玩习惯：+${result.habitGain}`);
  expect(learning.textContent).toContain(result.reason==="credited"?"已计入":"记录时同类习惯仍在间隔内");
  const receipt=screen.getByLabelText("上次操作的即时变化").textContent;
  await key("c"); // Explicitly skip the play clip before the toast reading interval.
  saved.growth!.points=60;saved.growth!.care.play=20;saved.needs.mood=30;saved.revision++;
  await clock(15000);expect(document.querySelector("[data-feedback=idle]")).not.toBeNull();
  expect(screen.getByLabelText("上次操作的即时变化").textContent).toBe(receipt);
  // Status page reads the same acknowledged snapshot, not the latest totals.
  for(const k of ["a","a","a","a","a","b"])await key(k);
  expect(screen.getByLabelText("上次操作的即时变化").textContent).toBe(receipt);
  expect(calls()).toHaveLength(1);expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  cleanup();await mount();expect(screen.queryByLabelText("上次操作的即时变化")).toBeNull();
 });
 it("accepts saved settlement feedback and shows the local companion echo only once",async()=>{
  saved.game!.treasure!.opened=[3,4,5,6,7,8];
  const original=api.getMockImplementation()!;
  api.mockImplementation(async(path,body)=>{
   const r=await original(path,body);
   if(path==="action"&&(body as {kind:string}).kind==="treasure-finish"){
    saved.companion={since:saved.createdAt,interests:[{kind:"treasure",points:1,lastAt:Date.now()}],recent:{kind:"treasure",id,at:Date.now()}};
    saved.careCount=1;saved.needs={hunger:68,mood:80,energy:77,clean:80};
    r.state=structuredClone(saved);
    r.careFeedback={kind:"treasure-finish",points:2,habit:"play",habitGain:1,reason:"credited",effect:{at:Date.now(),before:{hunger:70,mood:70,energy:80,clean:80},after:{hunger:68,mood:80,energy:77,clean:80}}};
   }
   return r;
  });
  await mount();await key("b");expect(document.querySelector(".content-home")).toBeTruthy();
  expect(document.querySelector(".save-recovery")).toBeNull();await clock(4000);
  expect(document.querySelector('[data-echo="treasure"]')).toBeTruthy();
  await clock(13000);expect(document.querySelector('[data-echo="treasure"]')).toBeNull();
  await hidden(true);await hidden(false);expect(document.querySelector('[data-echo="treasure"]')).toBeNull();
  expect(calls()).toHaveLength(1);
 });

});

describe("explicit treasure viewport feedback", () => {
 beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
   const top = this.matches(".device-buttons") ? 600 : -400;
   return { top, bottom: top + 100, height: 100, width: 200, left: 0, right: 200, x: 0, y: top, toJSON: () => ({}) };
  });
 });
 it("only explicit resume, selection and accepted dig reveal their feedback; reads never replay", async () => {
  await mount(); expect(window.scrollBy).not.toHaveBeenCalled();
  await key("c"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  expect(document.querySelector(".treasure-result")?.textContent).toContain("2号格");
  expect(document.querySelector(".treasure-result")?.textContent).toContain("轻羽毛");
  expect(document.querySelector(".treasure-grid [aria-selected=true]")?.getAttribute("aria-label")).toMatch(/^3号格/);
  await clock(60000); expect(window.scrollBy).toHaveBeenCalledTimes(3);
 });
 it("does not replay a late accepted resume after backgrounding", async () => {
  await mount(); delayResume = true; await key("c"); await hidden(true);
  await act(async () => release()); await hidden(false);
  expect(window.scrollBy).not.toHaveBeenCalled();
  expect(document.querySelector(".treasure-pause")).toBeTruthy();
 });
 it.each(["blur", "help", "hidden"])("an accepted dig interrupted by %s saves the result without jumping on return", async reason => {
  await mount(); await key("c"); vi.mocked(window.scrollBy).mockClear(); delayDig=true; await key("b");
  if(reason==="hidden")await hidden(true);
  else if(reason==="blur")await act(async()=>fireEvent.blur(window));
  else await act(async()=>fireEvent.click(screen.getByRole("button",{name:"玩法说明"})));
  await act(async()=>release());
  if(reason==="hidden")await hidden(false);
  else if(reason==="blur")await act(async()=>fireEvent.focus(window));
  else await act(async()=>fireEvent.click(screen.getByRole("button",{name:"关闭"})));
  expect(window.scrollBy).not.toHaveBeenCalled();
  expect(document.querySelector(".treasure-result")?.textContent).toContain("1号格");
  expect(document.querySelector(".treasure-pause")).toBeTruthy();
 });
 it("a rejected dig neither invents a result nor scrolls it", async () => {
  await mount(); await key("c"); vi.mocked(window.scrollBy).mockClear(); failure = "treasure-dig";
  await key("b"); expect(window.scrollBy).not.toHaveBeenCalled();
  expect(document.querySelector(".treasure-result")).toBeNull();
 });
});


describe("local accepted treasure reactions", () => {
 const activity = () => document.querySelector(".treasure-companion")?.getAttribute("data-reaction");
 it("does not replay on initial read, resume, elapsed time, polling or reload", async () => {
  saved.game!.treasure!.paused=false;saved.game!.treasure!.opened=[0];
  await mount();expect(activity()).toBe("quiet");await key("c");expect(activity()).toBe("quiet");
  saved.game!.treasure!.opened.push(1);saved.game!.treasure!.step++;saved.revision++;
  await clock(60000);expect(activity()).toBe("quiet");
  cleanup();await mount();expect(activity()).toBe("quiet");expect(calls()).toHaveLength(1);
 });
 it("reacts only after saving, retains it across selection, and replaces its timer on the next dig", async () => {
  await mount();await key("c");delayDig=true;await key("b");expect(activity()).toBe("quiet");
  await act(async()=>release());expect(activity()).toBe("found");
  expect(document.querySelector(".treasure-companion-note")?.textContent).toContain("小松果");
  await clock(800);await key("a");expect(activity()).toBe("found");expect(calls()).toHaveLength(2);
  delayDig=false;await key("b");expect(document.querySelector(".treasure-object")?.getAttribute("data-item")).toBe("3");
  await clock(800);expect(activity()).toBe("found");await clock(800);expect(activity()).toBe("quiet");
  expect(document.querySelector(".treasure-result")?.textContent).toContain("光滑石");
 });
 it("an empty terminal dig does not react to three unsearched revealed items", async () => {
  saved.game!.treasure!.opened=[3,4,5,6,7];saved.game!.treasure!.step=5;
  await mount();await key("c"); // Initial cursor is first unsearched (0); choose 8.
  for(let i=0;i<3;i++)await key("a");await key("b");
  expect(activity()).toBe("empty");expect(document.querySelector(".treasure-object")).toBeNull();
  expect(document.querySelector(".treasure-companion-note")?.textContent).toContain("这里是空地");
  expect(document.querySelector(".treasure-game")?.getAttribute("data-done")).toBe("true");
  expect(screen.getAllByText("留在林间")).toHaveLength(3);
 });
 it("never invents a reaction for a rejected or late dig", async () => {
  await mount();await key("c");failure="treasure-dig";await key("b");expect(activity()).toBe("quiet");
  failure="";delayDig=true;const monotonic=vi.spyOn(performance,"now").mockReturnValue(0);
  await key("b");monotonic.mockReturnValue(2001);await act(async()=>release());
  expect(activity()).toBe("quiet");expect(document.querySelector(".treasure-result")?.textContent).toContain("小松果");
 });
 it.each(["hidden","blur","help","tools","pause","rules"])("%s stops the reaction without replaying on return",async reason=>{
  await mount();await key("c");await key("b");expect(activity()).toBe("found");
  if(reason==="hidden"){await hidden(true);await hidden(false)}
  else if(reason==="blur"){await act(async()=>{fireEvent.blur(window);fireEvent.focus(window)})}
  else if(reason==="help"){await act(async()=>fireEvent.click(screen.getByRole("button",{name:"玩法说明"})));await act(async()=>fireEvent.click(screen.getByRole("button",{name:"关闭"})))}
  else if(reason==="tools"){await act(async()=>fireEvent.click(screen.getByRole("button",{name:"存档盒"})));await act(async()=>fireEvent.click(screen.getByRole("button",{name:"存档盒"})))}
  else {await key("c");if(reason==="rules"){await key("a");await key("b");await key("c")}}
  expect(activity()).toBe("quiet");await key("c");expect(activity()).toBe("quiet");
 });
 it.each(["hidden","blur","help"])("%s in flight suppresses late accepted reaction",async reason=>{
  await mount();await key("c");delayDig=true;await key("b");
  if(reason==="hidden")await hidden(true);
  else if(reason==="blur")await act(async()=>fireEvent.blur(window));
  else await act(async()=>fireEvent.click(screen.getByRole("button",{name:"玩法说明"})));
  await act(async()=>release());
  if(reason==="hidden")await hidden(false);
  else if(reason==="blur")await act(async()=>fireEvent.focus(window));
  else await act(async()=>fireEvent.click(screen.getByRole("button",{name:"关闭"})));
  expect(activity()).toBe("quiet");await key("c");expect(activity()).toBe("quiet");
 });
});


describe("treasure finish explains the saved result, not the revealed map", () => {
 it.each([
  {opened:[3,4,5,6,7,8],found:0,reason:"六次已用完",base:3},
  {opened:[0,3,4,5,6,7],found:1,reason:"六次已用完",base:4},
  {opened:[0,1,3,4,5,6],found:2,reason:"六次已用完",base:5},
  {opened:[0,1,2],found:3,reason:"三件已找齐",base:6},
  {opened:[0,3,1,4,5,2],found:3,reason:"三件已找齐",base:6},
 ])("explains $found actual finds and $reason", ({opened,found,reason,base}) => {
  saved.game!.treasure!.opened=opened;
  render(<TreasureGame pet={saved} active cursor={0} choice={0}/>);
  expect(document.querySelector(".treasure-status")?.textContent).toContain(reason);
  expect(document.querySelector(".treasure-status")?.textContent).toContain(`实际找到 ${found} 件，A 暂不操作 · B / C 收好`);
  const rule=document.querySelector(".treasure-game > small")?.textContent;
  expect(rule).toContain(`本局基础 ${base} 币＝3 币探索 + ${found} 币发现`);
  expect(rule).toContain("每日额度和钱包上限");
  expect(rule).toContain("揭示不算找到");
  expect(rule).toContain("B / C 收好才计陪伴与金币");
  expect(document.querySelectorAll(".treasure-grid [data-revealed=true] span")).toHaveLength(9-opened.length);
  expect(calls()).toHaveLength(0);
 });
 it("does not announce a final award basis before an acknowledged terminal dig, or settle on A/reload", async()=>{
  saved.game!.treasure!.opened=[0,1];await mount();await key("c");
  delayDig=true;await key("b");
  expect(document.querySelector(".treasure-game")?.getAttribute("data-done")).toBe("false");
  expect(document.querySelector(".treasure-game > small")?.textContent).not.toContain("本局基础");
  await act(async()=>release());
  expect(document.querySelector(".treasure-status")?.textContent).toContain("三件已找齐");
  expect(document.querySelector(".treasure-game > small")?.textContent).toContain("本局基础 6 币");
  await key("a");expect(calls().some(a=>a.kind==="treasure-finish")).toBe(false);
  cleanup();await mount();await clock(20000);
  expect(document.querySelector(".treasure-game > small")?.textContent).toContain("本局基础 6 币");
  expect(calls().some(a=>a.kind==="treasure-finish")).toBe(false);
  await key("c");expect(calls().filter(a=>a.kind==="treasure-finish")).toHaveLength(1);
 });
 it.each([true,false])("keeps the general rule before the session ends (paused %s)",paused=>{
  saved.game!.treasure!.opened=[0,1];saved.game!.treasure!.paused=paused;
  render(<TreasureGame pet={saved} active cursor={2} choice={0}/>);
  expect(document.querySelector(".treasure-game > small")?.textContent).not.toContain("本局基础");
  expect(document.querySelector(".treasure-game > small")?.textContent).toContain("收好后 3–6 币");
  expect(document.querySelector(".treasure-status")?.textContent).not.toMatch(/三件已找齐|六次已用完/);
 });
});
