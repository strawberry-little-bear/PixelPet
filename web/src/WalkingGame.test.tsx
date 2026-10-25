import { RequestFailure } from "./requestFailure";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { WalkingGame, ParkAlbum, WalkTrailPicker } from "./WalkingGame";
import { parkCatalog, walkingCompanions, walkTrails, walkMenuFor, canChooseWalkTrail } from "./walk";
import { petRigKind } from "./PetArt";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { PetState, Walking, Result } from "./types";
vi.mock("./api",()=>({request:vi.fn()}));const api=vi.mocked(request);
const id="0123456789abcdef0123456789abcdef";
let saved:PetState,failure:string,delayResume:boolean,release:()=>void;
const baseWalk=():Walking=>({route:Array<"rock"|"branch">(12).fill("rock"),souvenirs:["leaf","shell","flower"],beat:0,step:0,cleared:0,pose:"",poseUntil:0,lastPulseAt:Date.now(),lastInputAt:0,paused:true});
const fixture=():PetState=>({schema:11,revision:1,species:3,name:"海豚宝",createdAt:Date.now()-10000,hatchedAt:Date.now()-9000,lastTick:Date.now(),sleeping:false,needs:{hunger:70,mood:70,energy:80,clean:80},careCount:0,growth:emptyGrowth("baby"),logs:[],park:{since:Date.now()-10000,finds:[],walks:0,lastWalkAt:0},game:{id,kind:"walk",walking:baseWalk(),startedAt:Date.now(),round:0,score:0,lastBeat:-1}});
const calls=()=>api.mock.calls.filter(c=>c[0]==="action").map(c=>c[1] as {kind:string;step?:number;gameId?:string});
const response=():Result=>({state:structuredClone(saved),message:"",serverTime:Date.now()});
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key})})}
async function clock(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)})}
async function mount(){await act(async()=>{render(<App/>)})}
async function hidden(value:boolean){Object.defineProperty(document,"hidden",{configurable:true,value});await act(async()=>{document.dispatchEvent(new Event("visibilitychange"))})}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));Object.defineProperty(document,"hidden",{configurable:true,value:false});localStorage.clear();api.mockReset();saved=fixture();failure="";delayResume=false;
 api.mockImplementation(async(path,body)=>{if(path==="action"){const a=body as {kind:string;step:number;item?:string};if(a.kind===failure)throw new RequestFailure("这一步没有保存", "rejected");const n=saved.game?.walking;
  if(n){if(a.kind==="walk-trail"){n.trail=a.item as Walking["trail"];n.souvenirs=["shell","pebble","feather"];}if(a.kind==="walk-resume"){n.paused=false;n.lastPulseAt=Date.now()}if(a.kind==="walk-pause")n.paused=true;
   if(a.kind==="walk-step"){n.beat++;n.lastPulseAt=Date.now();if(n.beat%24===0)saved.park!.finds!.push({id:n.souvenirs[n.beat/24-1],firstAt:Date.now(),lastAt:Date.now(),count:1})}
   if(a.kind==="walk-jump"||a.kind==="walk-duck"){n.pose=a.kind==="walk-jump"?"jump":"duck";n.poseUntil=Math.min(72,n.beat+3);n.lastInputAt=Date.now()}
   n.step++;
  }
  if(a.kind==="walk-finish"||a.kind==="cancel-play")delete saved.game;saved.revision++;
  const r=response();if(a.kind==="walk-resume"&&delayResume)await new Promise<void>(resolve=>{release=resolve});return r;
 }return response()});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();Object.defineProperty(document,"hidden",{configurable:true,value:false})});
describe("three-key walking",()=>{
 it("starts and reloads paused, only manual resume starts foreground beats",async()=>{saved.game!.walking!.paused=false;await mount();await clock(12000);expect(calls()).toHaveLength(0);expect(screen.getByText("慢慢走，不必赶路")).toBeTruthy();await key("c");await clock(1100);expect(calls().map(a=>a.kind)).toEqual(["walk-resume","walk-step"]);expect(calls()[1]).toEqual(expect.objectContaining({gameId:id,step:1}));await key("a");expect(saved.game!.walking!.pose).toBe("jump");await key("b");expect(saved.game!.walking!.pose).toBe("duck");await key("c");const count=calls().length;await clock(12000);expect(calls()).toHaveLength(count);expect(calls().at(-1)?.kind).toBe("walk-pause");expect(document.querySelectorAll(".physical-button")).toHaveLength(3);expect(document.querySelectorAll(".lcd button,.lcd [role=button],.lcd a")).toHaveLength(0)});
 it("keeps discoveries read-only and returns without resuming",async()=>{await mount();await key("a");await key("b");expect(document.querySelector(".park-album")).toBeTruthy();for(let i=0;i<6;i++)await key("b");await key("c");await clock(12000);expect(calls()).toHaveLength(0);expect(document.querySelector(".walk-pause")).toBeTruthy()});
 it("confirms abandoning and retains discoveries without rewards",async()=>{saved.park!.finds=[{id:"leaf",firstAt:Date.now(),lastAt:Date.now(),count:1}];await mount();await key("a");await key("a");await key("b");expect(screen.getByText(/实际遇见的发现仍会保留/)).toBeTruthy();await key("c");expect(calls()).toHaveLength(0);await key("a");await key("a");await key("b");await key("b");expect(calls()).toEqual([expect.objectContaining({kind:"cancel-play",gameId:id})]);expect(saved.park!.finds).toHaveLength(1)});
 it("stops when hidden or help opens and never catches up on return",async()=>{await mount();await key("c");await clock(1100);await hidden(true);const count=calls().length;await clock(20000);await hidden(false);await clock(5000);expect(calls()).toHaveLength(count);await key("c");fireEvent.click(screen.getByRole("button",{name:"玩法说明"}));await clock(4000);fireEvent.click(screen.getByRole("button",{name:"关闭"}));await clock(4000);expect(calls()).toHaveLength(count+1)});
 it("does not restart after a resume response crosses background and foreground",async()=>{delayResume=true;await mount();await key("c");expect(calls()).toHaveLength(1);await hidden(true);await hidden(false);await act(async()=>release());await clock(9000);expect(calls()).toHaveLength(1);expect(document.querySelector(".walk-pause")).toBeTruthy()});
 it.each(["walk-resume","walk-step"])("fails safe when %s is rejected, without retry loops",async kind=>{failure=kind;await mount();await key("c");await clock(2000);const count=calls().length;await clock(8000);expect(calls()).toHaveLength(count);expect(document.querySelector(".walk-pause")).toBeTruthy();failure="";await key("c");await clock(1100);expect(calls().at(-1)?.kind).toBe("walk-step")});
 it("keeps this route readable after the transient find message, without exposing future or historical finds",async()=>{
  saved.game!.walking!.beat=28;
  saved.park!.finds=[{id:"flower",firstAt:Date.now()-1000,lastAt:Date.now()-1000,count:4}];
  await mount();
  const region=screen.getByRole("region",{name:"本次沿途发现"});
  expect(within(region).getByText("银杏叶")).toBeTruthy();
  expect(within(region).queryByText("水边贝壳")).toBeNull();
  expect(within(region).queryByText("落花")).toBeNull();
  region.focus();
  for(const k of ["Enter"," ","ArrowDown"])await act(async()=>{fireEvent.keyDown(region,{key:k})});
  await clock(9000);
  expect(calls()).toHaveLength(0);
  expect(document.querySelector('.walk-pause span[data-selected="true"]')?.textContent).toContain("继续散步");
  await key("a");await key("b");
  expect(document.querySelector(".park-album")).toBeTruthy();
  await key("c");
  expect(screen.getByRole("region",{name:"本次沿途发现"})).toBeTruthy();
  expect(calls()).toHaveLength(0);
 });
 it("hides the route reading while running and restores it on pause and reload without replaying discoveries",async()=>{
  saved.game!.walking!.beat=28;
  await mount();
  await key("c");
  expect(screen.queryByRole("region",{name:"本次沿途发现"})).toBeNull();
  await clock(1100);await key("c");
  const text=screen.getByRole("region",{name:"本次沿途发现"}).textContent;
  expect(calls().map(a=>a.kind)).toEqual(["walk-resume","walk-step","walk-pause"]);
  cleanup();const count=calls().length;await mount();await clock(12000);
  expect(screen.getByRole("region",{name:"本次沿途发现"}).textContent).toBe(text);
  expect(calls()).toHaveLength(count);
  expect(saved.park!.finds).toHaveLength(0);
 });
 it("lets a focused route summary use explicit B to collect exactly once, not Enter or reading keys",async()=>{
  saved.game!.walking!.beat=72;
  saved.game!.walking!.souvenirs=["leaf","shell","leaf"];
  await mount();const region=screen.getByRole("region",{name:"本次沿途发现"});region.focus();
  expect(within(region).getAllByRole("listitem")).toHaveLength(3);
  expect(within(region).getAllByText("银杏叶")).toHaveLength(2);
  for(const k of ["Enter"," ","ArrowDown","a"])await act(async()=>{fireEvent.keyDown(region,{key:k})});
  expect(calls()).toHaveLength(0);
  await key("b");
  expect(calls().map(a=>a.kind)).toEqual(["walk-finish"]);
  expect(screen.queryByRole("region",{name:"本次沿途发现"})).toBeNull();
  expect(document.querySelector(".content-home")).toBeTruthy();
 });
 it("offers explicit B/C settlement at the end, A never submits",async()=>{saved.game!.walking!.beat=72;await mount();await clock(5000);await key("a");expect(calls()).toHaveLength(0);expect(document.querySelector(".walk-warning")?.textContent).toContain("A 暂不操作");await key("c");expect(calls()).toEqual([expect.objectContaining({kind:"walk-finish",gameId:id,step:0})]);expect(document.querySelector(".content-home")).toBeTruthy()});
 it("opens park records from the permanent home menu without writing",async()=>{delete saved.game;await mount();await key("a");for(let i=0;i<11;i++)await key("a");await key("b");expect(document.querySelector(".park-album")).toBeTruthy();await key("b");await key("c");expect(calls()).toHaveLength(0)});
});
describe("home response after a newly discovered park item",()=>{
 it("shows a one-shot discovery echo after collecting the route",async()=>{
  saved.game!.walking!.beat=72;saved.park!.finds=[];
  api.mockImplementation(async(path,body)=>{
   if(path==="action") {
    const a=body as {kind:string};
    if(a.kind==="walk-finish") {
     saved.park!.finds=[{id:"leaf",firstAt:Date.now(),lastAt:Date.now(),count:1}];
     delete saved.game;saved.revision++;
    }
   }
   return response();
  });
  await mount();await key("a");await key("c");
  expect(document.querySelector('[data-echo="park-discovery"]')).toBeTruthy();
  expect(screen.getByText("新发现 · 沿途")).toBeTruthy();
  await clock(12000);expect(document.querySelector("[data-echo]")).toBeNull();
  expect(calls()).toHaveLength(1);
 });
});
describe("real discoveries and species-specific participation",()=>{
 it("never invents undiscovered items and shows real first dates and counts",()=>{const {rerender}=render(<ParkAlbum pet={saved} page={0}/>);expect(screen.getByText("还未遇见")).toBeTruthy();expect(document.querySelector(".park-art text")).toBeTruthy();saved.park!.finds=[{id:"leaf",firstAt:Date.parse("2026-10-18T08:00:00Z"),lastAt:Date.now(),count:2}];rerender(<ParkAlbum pet={saved} page={0}/>);expect(screen.getByText("银杏叶")).toBeTruthy();expect(screen.getByText(/遇见 2 次/)).toBeTruthy();expect(document.querySelector(".park-art text")).toBeNull()});
 it.each(parkCatalog)("renders a distinct $id discovery only after actually meeting it",item=>{saved.park!.finds=[{id:item.id,firstAt:Date.now(),lastAt:Date.now(),count:1}];render(<ParkAlbum pet={saved} page={parkCatalog.indexOf(item)}/>);expect(screen.getByText(item.name)).toBeTruthy();expect(document.querySelectorAll("button,a,input")).toHaveLength(0)});
 it.each(walkingCompanions.flatMap((method,index)=>["baby","growing","adult"].map(stage=>({method,index,stage}))))("uses $stage anatomy for species $index in every pose",({method,index,stage})=>{saved.species=index;saved.growth!.stage=stage as "baby"|"growing"|"adult";const rig=petRigKind(index,saved.growth!.stage);saved.economy={coins:0,lastDailyAt:0,lastGameAt:0,gameCoins:0,owned:["sky-bow"],equipped:{accessory:"sky-bow",room:""}};saved.game!.walking!.paused=false;const {rerender}=render(<WalkingGame pet={saved} active choice={0}/>);expect(screen.getByText(method)).toBeTruthy();for(const pose of ["","jump","duck"] as const){saved.game!.walking!.pose=pose;rerender(<WalkingGame pet={saved} active choice={0}/>);expect(document.querySelector(`.park-scene[data-rig="${rig}"][data-pose="${pose||"moving"}"]`)).toBeTruthy();expect(document.querySelector(`.${rig}-rig[data-rig-stage="${stage}"]`)).toBeTruthy();expect(document.querySelectorAll(".walking-actor svg")).toHaveLength(1);expect(document.querySelector(".walking-actor svg")?.classList.contains("rig-motion-walking")).toBe(true);expect(document.querySelectorAll(".equipped-accessory")).toHaveLength(1);expect(document.querySelectorAll("button,a,input")).toHaveLength(0)}});
});

describe("visualize an approaching obstacle", () => {
 it("raises a gentle scene alert without changing the three-key timing copy", () => {
  const pet = fixture(), n = pet.game!.walking!; n.paused = false; n.route.fill("rock");
  const { rerender } = render(<WalkingGame pet={pet} active choice={0} />);
  const scene = () => document.querySelector(".park-scene");
  expect(scene()?.getAttribute("data-obstacle-distance")).toBe("6");
  expect(scene()?.classList.contains("obstacle-near")).toBe(false);
  n.beat = 3; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(scene()?.getAttribute("data-obstacle-distance")).toBe("3");
  expect(scene()?.classList.contains("obstacle-near")).toBe(true);
  expect(scene()?.classList.contains("obstacle-imminent")).toBe(false);
  n.beat = 5; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(scene()?.getAttribute("data-obstacle-distance")).toBe("1");
  expect(scene()?.classList.contains("obstacle-imminent")).toBe(true);
  expect(document.querySelector(".walk-find")?.textContent).toContain("现在按 A");
  n.paused = true; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(scene()?.getAttribute("data-obstacle-distance")).toBeNull();
  expect(scene()?.classList.contains("obstacle-imminent")).toBe(false);
 });
});

describe("read the timing of a walking action", () => {
 it.each([
  { species: 2, obstacle: "rock", pose: "jump", action: "跳跃", input: "A" },
  { species: 2, obstacle: "branch", pose: "duck", action: "蹲下", input: "B" },
  { species: 3, obstacle: "rock", pose: "jump", action: "跃水", input: "A" },
  { species: 3, obstacle: "branch", pose: "duck", action: "下潜", input: "B" },
 ] as const)("explains early, timely and wrong actions for species $species / $obstacle", ({ species, obstacle, pose, action, input }) => {
  const pet = fixture(); pet.species = species;
  const n = pet.game!.walking!; n.route.fill(obstacle); n.paused = false;
  const { rerender } = render(<WalkingGame pet={pet} active choice={0} />);
  const hint = () => document.querySelector(".walk-find")?.textContent;
  expect(hint()).toBe(`近 3 步再按 ${input} ${action} · 动作保持 3 步。`);
  Object.assign(n, { pose, poseUntil: 3 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(hint()).toBe(`动作会先结束 · 近 3 步再按 ${input} ${action}。`);
  Object.assign(n, { beat: 3, pose: "", poseUntil: 0 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(hint()).toBe(`现在按 ${input} ${action} · 动作保持 3 步。`);
  Object.assign(n, { pose, poseUntil: 6 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(hint()).toBe(`${action}可覆盖本处 · 不必连按。`);
  Object.assign(n, { beat: 5 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(hint()).toBe(`${action}可覆盖本处 · 不必连按。`);
  n.pose = pose === "jump" ? "duck" : "jump"; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(hint()).toBe(`现在按 ${input} ${action} · 动作保持 3 步。`);
 });
 it("uses the next visible obstacle, not the previous one or future souvenirs", () => {
  const pet = fixture(), n = pet.game!.walking!;
  Object.assign(n, { beat: 9, paused: false, pose: "jump", poseUntil: 12 }); n.route[1] = "branch";
  render(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toBe("现在按 B 下潜 · 动作保持 3 步。");
  expect(document.querySelector(".walking-game")?.textContent).not.toMatch(/水边贝壳|落花/);
  expect(api).not.toHaveBeenCalled();
 });
 it("preserves discovery, boundary and finish messages instead of inventing obstacle history", () => {
  const pet = fixture(), n = pet.game!.walking!; n.paused = false;
  const { rerender } = render(<WalkingGame pet={pet} active choice={0} />);
  Object.assign(n, { beat: 6, cleared: 1, pose: "duck", poseUntil: 9 });
  rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toBe("这一处走过啦，绊到也能继续，不扣状态。");
  n.beat = 24; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toBe("发现了银杏叶！已留在沿途发现。");
  Object.assign(n, { beat: 28, pose: "", poseUntil: 0 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toBe("现在按 A 跃水 · 动作保持 3 步。");
  n.beat = 72; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-warning")?.textContent).toContain("B / C 收好");
  expect(document.querySelector(".walk-find")?.textContent).toBe("发现了落花！已留在沿途发现。");
 });
 it.each([true, false])("does not invite a timed action during a saved/local pause (saved %s)", paused => {
  const pet = fixture(); Object.assign(pet.game!.walking!, { beat: 3, paused });
  render(<WalkingGame pet={pet} active={paused} choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toBe("每 24 步一次发现 · 已走过 0 / 3 处");
  expect(document.querySelector(".walk-find")?.textContent).not.toContain("现在按");
 });
 it("only shows coverage after the App receives the saved action", async () => {
  saved.game!.walking!.beat = 3;
  await mount(); await key("c");
  const normal = api.getMockImplementation()!;
  let accept!: () => Promise<void>;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-jump"
   ? new Promise(resolve => { accept = async () => resolve(await normal(...args)); }) : normal(...args));
  await key("a");
  expect(document.querySelector(".walk-find")?.textContent).toBe("现在按 A 跃水 · 动作保持 3 步。");
  expect(saved.game!.walking!.pose).toBe("");
  await act(async () => { await accept(); });
  expect(document.querySelector(".walk-find")?.textContent).toBe("跃水可覆盖本处 · 不必连按。");
  expect(calls().filter(a => a.kind === "walk-jump")).toHaveLength(1);
 });
 it("does not expire or extend a pose using local time", async () => {
  const pet = fixture(); Object.assign(pet.game!.walking!, { beat: 3, paused: false, pose: "jump", poseUntil: 6 });
  const before = structuredClone(pet); render(<WalkingGame pet={pet} active choice={0} />);
  await clock(10000);
  expect(document.querySelector(".walk-find")?.textContent).toBe("跃水可覆盖本处 · 不必连按。");
  expect(pet).toEqual(before); expect(api).not.toHaveBeenCalled();
  expect(document.querySelectorAll(".lcd button,.walking-game button,.walking-game a,.walking-game input")).toHaveLength(0);
 });
});

describe("pause while an automatic walking step is in flight", () => {
 async function pendingStep(beat = 0) {
  saved.game!.walking!.beat = beat;
  await mount(); await key("c");
  const normal = api.getMockImplementation()!;
  let resolve!: (value: Result) => void;
  let reject!: (error: unknown) => void;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-step"
   ? new Promise((yes, no) => { resolve = yes; reject = no; }) : normal(...args));
  await clock(1100);
  return { normal, resolve, reject };
 }
 it("accepts physical C during a step, immediately stops locally, and saves once with the new step", async () => {
  const pending = await pendingStep();
  expect(screen.getByRole("button", {name: "C 返回"}).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("button", {name: "A 选择"}).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", {name: "B 确认"}).hasAttribute("disabled")).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: "C 返回"})); });
  await key("c"); await key("a"); await key("b");
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
  await clock(5000);
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step", "walk-pause"]);
  expect(calls()[2]).toMatchObject({gameId: id, step: 2});
  expect(saved.game!.walking!.paused).toBe(true);
  expect(saved.game!.walking!.beat).toBe(1);
  await clock(5000); expect(calls()).toHaveLength(3);
 });
 it("does not buffer movement keys during the automatic write", async () => {
  const pending = await pendingStep();
  await key("a"); await key("b");
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
  await key("c");
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step", "walk-pause"]);
  expect(saved.game!.walking!.pose).toBe("");
 });
 it("keeps the queued pause single while its own save remains in flight", async () => {
  const pending = await pendingStep(); await key("c");
  const pendingAPI = api.getMockImplementation()!;
  let resolvePause!: (value: Result) => void;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-pause"
   ? new Promise(yes => { resolvePause = yes; }) : pendingAPI(...args));
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  expect(calls()[2]).toMatchObject({kind: "walk-pause", gameId: id, step: 2});
  expect(screen.getByRole("button", {name: "C 返回"}).hasAttribute("disabled")).toBe(true);
  await key("c"); await key("c"); await clock(5000);
  expect(calls()).toHaveLength(3);
  await act(async () => { resolvePause(await pending.normal("action", calls()[2])); });
  await clock(5000);
  expect(saved.game!.walking!.paused).toBe(true);
  expect(calls()).toHaveLength(3);
 });
 it.each(["unknown", "rejected"] as const)("does not retry a %s deferred pause or resume after readback", async outcome => {
  const pending = await pendingStep(); await key("c");
  const pendingAPI = api.getMockImplementation()!;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-pause"
   ? Promise.reject(new RequestFailure("暂停结果未确认", outcome)) : pendingAPI(...args));
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  await clock(16000);
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step", "walk-pause"]);
  cleanup(); await mount(); await clock(5000);
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  expect(calls()).toHaveLength(3);
 });
 it("does not swallow the physical click before React paints the automatic busy state", async () => {
  await mount(); await key("c");
  const normal = api.getMockImplementation()!;
  let resolve!: (value: Result) => void;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-step"
   ? new Promise(yes => { resolve = yes; }) : normal(...args));
  const button = screen.getByRole("button", {name: "C 返回"});
  await act(async () => {
   vi.advanceTimersByTime(1050);
   expect(calls().at(-1)?.kind).toBe("walk-step");
   expect(button.hasAttribute("disabled")).toBe(false);
   fireEvent.click(button);
  });
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  await act(async () => { resolve(await normal("action", calls()[1])); });
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step", "walk-pause"]);
 });
 it("does not turn the pending C into settlement when the accepted step reaches the finish", async () => {
  const pending = await pendingStep(71); await key("c");
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  expect(saved.game!.walking!.beat).toBe(72);
  expect(screen.getByText(/到终点啦/)).toBeTruthy();
  await clock(12000);
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
  await key("b");
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step", "walk-finish"]);
 });
 it("preserves a discovery accepted with the held step without repeating it or rewarding a pause", async () => {
  const pending = await pendingStep(23); await key("c");
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  expect(saved.game!.walking!.beat).toBe(24);
  expect(saved.park!.finds).toEqual([expect.objectContaining({id: "leaf", count: 1})]);
  expect(screen.getByRole("region", {name: "本次沿途发现"}).textContent).toContain("银杏叶");
  expect(saved.careCount).toBe(0);
  cleanup(); const count = calls().length; await mount(); await clock(12000);
  expect(calls()).toHaveLength(count);
  expect(saved.park!.finds![0].count).toBe(1);
  expect(document.querySelector(".walk-pause")).toBeTruthy();
 });
 it.each(["walk-resume", "walk-jump", "walk-duck"])("does not queue C behind explicit %s", async kind => {
  await mount(); if (kind !== "walk-resume") await key("c");
  const normal = api.getMockImplementation()!;
  let resolve!: (value: Result) => void;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === kind
   ? new Promise(yes => { resolve = yes; }) : normal(...args));
  await key(kind === "walk-resume" ? "c" : kind === "walk-jump" ? "a" : "b");
  await key("c");
  expect(screen.getByRole("button", {name: "C 返回"}).hasAttribute("disabled")).toBe(true);
  await act(async () => { resolve(await normal("action", calls().at(-1))); });
  expect(calls().filter(a => a.kind === "walk-pause")).toHaveLength(0);
 });
 it.each(["generation", "session", "already-paused", "unmount"])("discards the deferred pause after %s changes", async change => {
  const pending = await pendingStep(); await key("c");
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  await act(async () => {
   const reply = await pending.normal("action", calls()[1]);
   if (change === "generation") reply.saveGeneration = "fedcba9876543210fedcba9876543210";
   if (change === "session") reply.state.game!.id = "fedcba9876543210fedcba9876543210";
   if (change === "already-paused") reply.state.game!.walking!.paused = true;
   if (change === "unmount") cleanup();
   pending.resolve(reply);
  });
  await clock(5000);
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
 });
 it.each(["rejected", "unknown"] as const)("does not replay pause after a %s step or subsequent reconciliation", async outcome => {
  const pending = await pendingStep(); await key("c");
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  // Hold reconciliation unavailable until the explicit B, so B cannot be
  // mistaken for a fresh resume after an already successful automatic read.
  let readsAvailable = outcome !== "unknown";
  const pendingAPI = api.getMockImplementation()!;
  api.mockImplementation((...args) => args[0] === "state" && !readsAvailable
   ? Promise.reject(new RequestFailure("暂时不能核对", "unavailable")) : pendingAPI(...args));
  await act(async () => { pending.reject(new RequestFailure("步进未确认", outcome)); });
  await clock(5000);
  readsAvailable = true;
  if (outcome === "unknown") await key("b");
  await clock(5000);
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
  expect(document.querySelector(".walk-pause")).toBeTruthy();
 });
 it.each(["blur", "help", "hidden"])("cancels the deferred pause when %s interrupts the request", async interruption => {
  const pending = await pendingStep(); await key("c");
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  await act(async () => {
   if (interruption === "blur") window.dispatchEvent(new Event("blur"));
   else if (interruption === "help") fireEvent.click(screen.getByRole("button", {name: "玩法说明"}));
   else { Object.defineProperty(document, "hidden", {configurable: true, value: true}); document.dispatchEvent(new Event("visibilitychange")); }
  });
  await act(async () => { pending.resolve(await pending.normal("action", calls()[1])); });
  await clock(5000);
  expect(calls().map(a => a.kind)).toEqual(["walk-resume", "walk-step"]);
  expect(document.querySelector(".walk-pause")).toBeTruthy();
 });
});

describe("discoveries do not hide the next obstacle's action feedback", () => {
 it("keeps boundary feedback with timing, without duplicating ordinary timing", () => {
  const pet = fixture(), n = pet.game!.walking!;
  Object.assign(n, { beat: 6, paused: false, pose: "", poseUntil: 0 });
  const { rerender } = render(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toContain("这一处走过啦");
  expect(document.querySelector(".walk-action-note")?.textContent).toContain("近 3 步再按");
  n.beat = 7; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-action-note")).toBeNull();
  expect(document.querySelector(".walk-find")?.textContent).toContain("近 3 步再按");
 });
 it.each([24, 48].flatMap(beat => [
  { beat, species: 2, obstacle: "rock", pose: "jump", action: "跳跃", input: "A" },
  { beat, species: 2, obstacle: "branch", pose: "duck", action: "蹲下", input: "B" },
  { beat, species: 3, obstacle: "rock", pose: "jump", action: "跃水", input: "A" },
  { beat, species: 3, obstacle: "branch", pose: "duck", action: "下潜", input: "B" },
 ] as const))("keeps discovery and saved timing together at $beat / $species / $obstacle", ({ beat, species, obstacle, pose, action, input }) => {
  const pet = fixture(), n = pet.game!.walking!; pet.species = species;
  Object.assign(n, { beat, paused: false, pose, poseUntil: beat + 3 }); n.route.fill(obstacle);
  const { rerender } = render(<WalkingGame pet={pet} active choice={0} />);
  const feedback = () => document.querySelector(".walk-action-note")?.textContent;
  const discovery = parkCatalog.find(item => item.id === n.souvenirs[beat / 24 - 1])!.name;
  expect(document.querySelector(".walk-find")?.textContent).toContain(`发现了${discovery}`);
  expect(feedback()).toBe(`动作会先结束 · 近 3 步再按 ${input} ${action}。`);
  Object.assign(n, { beat: beat + 3, poseUntil: beat + 6 }); rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(document.querySelector(".walk-find")?.textContent).toContain(`发现了${discovery}`);
  expect(feedback()).toBe(`${action}可覆盖本处 · 不必连按。`);
  n.pose = pose === "jump" ? "duck" : "jump"; rerender(<WalkingGame pet={pet} active choice={0} />);
  expect(feedback()).toBe(`现在按 ${input} ${action} · 动作保持 3 步。`);
  n.paused = true; rerender(<WalkingGame pet={pet} active choice={0} />); expect(feedback()).toBeUndefined();
  n.paused = false; rerender(<WalkingGame pet={pet} active={false} choice={0} />); expect(feedback()).toBeUndefined();
  n.beat = 72; rerender(<WalkingGame pet={pet} active choice={0} />); expect(feedback()).toBeUndefined();
  expect(document.querySelector(".walk-find")?.textContent).toContain("发现了落花");
  expect(api).not.toHaveBeenCalled();
 });
 it("waits for the saved action while a discovery is visible, and removes action advice on pause", async () => {
  saved.game!.walking!.beat = 27; await mount(); await key("c");
  const normal = api.getMockImplementation()!; let accept!: () => Promise<void>;
  api.mockImplementation((...args) => args[0] === "action" && (args[1] as {kind: string}).kind === "walk-jump"
   ? new Promise(resolve => { accept = async () => resolve(await normal(...args)); }) : normal(...args));
  await key("a");
  expect(document.querySelector(".walk-action-note")?.textContent).toBe("现在按 A 跃水 · 动作保持 3 步。");
  expect(saved.game!.walking!.pose).toBe("");
  await act(async () => { await accept(); });
  expect(document.querySelector(".walk-action-note")?.textContent).toBe("跃水可覆盖本处 · 不必连按。");
  expect(document.querySelector(".walk-find")?.textContent).toContain("发现了银杏叶");
  await key("c"); expect(document.querySelector(".walk-action-note")).toBeNull();
  expect(document.querySelector(".walk-pause")).toBeTruthy();
  expect(calls().filter(a => a.kind === "walk-jump")).toHaveLength(1);
 });
});


describe("optional walk trails",()=>{
 async function openPicker(){for(let i=0;i<5;i++)await key("a");await key("b");expect(screen.getByRole("region",{name:"出发前挑条小路"})).toBeTruthy();}
 it("cancels without a write and chooses once, returning paused until explicit resume",async()=>{
  saved.game!.walking!.trail="park";await mount();
  await openPicker();await key("a");expect(document.querySelector(".walk-trail-selection")?.textContent).toContain("池畔小路");
  await key("c");await clock(6000);expect(calls()).toHaveLength(0);
  await openPicker();await key("a");await key("b");
  expect(calls()).toEqual([expect.objectContaining({kind:"walk-trail",item:"pond",step:0,gameId:id})]);
  expect(document.querySelector(".walk-pause")).toBeTruthy();expect(screen.queryByRole("region",{name:"出发前挑条小路"})).toBeNull();
  expect(document.querySelector(".walking-game header")?.textContent).toContain("池畔小路 · 浅水道");
  expect(document.querySelector('[data-trail-scenery="pond"]')).toBeTruthy();
  expect(document.querySelector(".walk-pause")?.textContent).not.toContain("挑条小路");
  await clock(9000);expect(calls()).toHaveLength(1);
  cleanup();await mount();await clock(9000);expect(calls()).toHaveLength(1);
  expect(document.querySelector('[data-trail="pond"]')).toBeTruthy();
  await key("c");await clock(1100);expect(calls().map(a=>a.kind)).toEqual(["walk-trail","walk-resume","walk-step"]);
 });
 it("keeps rejected choices readable and never retries an uncertain write",async()=>{
  saved.game!.walking!.trail="park";await mount();await openPicker();failure="walk-trail";await key("b");
  expect(screen.getByRole("region",{name:"出发前挑条小路"})).toBeTruthy();await clock(6000);expect(calls()).toHaveLength(1);
  api.mockRejectedValueOnce(new RequestFailure("结果未知", "unknown"));await key("b");await clock(6000);
  expect(calls().filter(a=>a.kind==="walk-trail")).toHaveLength(2);
 });
 it("keeps a late accepted choice paused after a foreground interruption",async()=>{
  saved.game!.walking!.trail="park";await mount();await openPicker();
  const normal=api.getMockImplementation()!;let accept!:()=>void;
  api.mockImplementation(async(...args)=>{
   const r=await normal(...args);
   if(args[0]==="action"&&(args[1] as {kind:string}).kind==="walk-trail")await new Promise<void>(resolve=>{accept=resolve});
   return r;
  });
  await key("b");await hidden(true);await hidden(false);await act(async()=>accept());await clock(7000);
  expect(calls().map(a=>a.kind)).toEqual(["walk-trail"]);
  expect(screen.getByRole("region",{name:"出发前挑条小路"})).toBeTruthy();
  expect(screen.getByText(/本次路线已留好：林荫小径/)).toBeTruthy();
  await key("b");expect(calls()).toHaveLength(1);
  await key("c");expect(document.querySelector(".walk-pause")).toBeTruthy();
 });
 it.each(walkTrails)("renders $name with a distinct saved scene and no new controls",trail=>{
  const pet=fixture();pet.game!.walking!.trail=trail.id;
  render(<WalkingGame pet={pet} active={false} choice={0}/>);
  expect(document.querySelector(`[data-trail-scenery="${trail.id}"]`)).toBeTruthy();
  expect(document.querySelector(".walking-game header")?.textContent).toContain(trail.name);
  cleanup();render(<WalkTrailPicker walking={{...baseWalk(),trail:"park"}} choice={walkTrails.indexOf(trail)}/>);
  expect(document.querySelector(".walk-trail-selection")?.textContent).toContain(trail.name);
  expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
 });
 it("does not offer legacy, completed, moving or already chosen routes a reroll",()=>{
  for(const n of [baseWalk(),{...baseWalk(),trail:"pond" as const},{...baseWalk(),trail:"park" as const,beat:1},{...baseWalk(),trail:"park" as const,paused:false}]){
   expect(canChooseWalkTrail(n)).toBe(false);expect(walkMenuFor(n)).not.toContain("挑条小路");
  }
 });
});
