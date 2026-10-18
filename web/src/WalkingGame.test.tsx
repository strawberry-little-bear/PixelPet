import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { WalkingGame, ParkAlbum } from "./WalkingGame";
import { parkCatalog, walkingCompanions } from "./walk";
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
 api.mockImplementation(async(path,body)=>{if(path==="action"){const a=body as {kind:string;step:number};if(a.kind===failure)throw new Error("这一步没有保存");const n=saved.game?.walking;
  if(n){if(a.kind==="walk-resume"){n.paused=false;n.lastPulseAt=Date.now()}if(a.kind==="walk-pause")n.paused=true;
   if(a.kind==="walk-step"){n.beat++;n.lastPulseAt=Date.now();if(n.beat%24===0)saved.park!.finds.push({id:n.souvenirs[n.beat/24-1],firstAt:Date.now(),lastAt:Date.now(),count:1})}
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
 it("offers explicit B/C settlement at the end, A never submits",async()=>{saved.game!.walking!.beat=72;await mount();await clock(5000);await key("a");expect(calls()).toHaveLength(0);await key("c");expect(calls()).toEqual([expect.objectContaining({kind:"walk-finish",gameId:id,step:0})]);expect(document.querySelector(".content-home")).toBeTruthy()});
 it("opens park records from the permanent home menu without writing",async()=>{delete saved.game;await mount();await key("a");for(let i=0;i<11;i++)await key("a");await key("b");expect(document.querySelector(".park-album")).toBeTruthy();await key("b");await key("c");expect(calls()).toHaveLength(0)});
});
describe("real discoveries and species-specific participation",()=>{
 it("never invents undiscovered items and shows real first dates and counts",()=>{const {rerender}=render(<ParkAlbum pet={saved} page={0}/>);expect(screen.getByText("还未遇见")).toBeTruthy();expect(document.querySelector(".park-art text")).toBeTruthy();saved.park!.finds=[{id:"leaf",firstAt:Date.parse("2026-10-18T08:00:00Z"),lastAt:Date.now(),count:2}];rerender(<ParkAlbum pet={saved} page={0}/>);expect(screen.getByText("银杏叶")).toBeTruthy();expect(screen.getByText(/遇见 2 次/)).toBeTruthy();expect(document.querySelector(".park-art text")).toBeNull()});
 it.each(parkCatalog)("renders a distinct $id discovery only after actually meeting it",item=>{saved.park!.finds=[{id:item.id,firstAt:Date.now(),lastAt:Date.now(),count:1}];render(<ParkAlbum pet={saved} page={parkCatalog.indexOf(item)}/>);expect(screen.getByText(item.name)).toBeTruthy();expect(document.querySelectorAll("button,a,input")).toHaveLength(0)});
 it.each(walkingCompanions.flatMap((method,index)=>["baby","growing","adult"].map(stage=>({method,index,stage}))))("uses $stage anatomy for species $index in every pose",({method,index,stage})=>{saved.species=index;saved.growth!.stage=stage as "baby"|"growing"|"adult";const rig=petRigKind(index,saved.growth!.stage);saved.economy={coins:0,lastDailyAt:0,lastGameAt:0,gameCoins:0,owned:["sky-bow"],equipped:{accessory:"sky-bow",room:""}};saved.game!.walking!.paused=false;const {rerender}=render(<WalkingGame pet={saved} active choice={0}/>);expect(screen.getByText(method)).toBeTruthy();for(const pose of ["","jump","duck"] as const){saved.game!.walking!.pose=pose;rerender(<WalkingGame pet={saved} active choice={0}/>);expect(document.querySelector(`.park-scene[data-rig="${rig}"][data-pose="${pose||"moving"}"]`)).toBeTruthy();expect(document.querySelector(`.${rig}-rig[data-rig-stage="${stage}"]`)).toBeTruthy();expect(document.querySelectorAll(".walking-actor svg")).toHaveLength(1);expect(document.querySelector(".walking-actor svg")?.classList.contains("rig-motion-walking")).toBe(true);expect(document.querySelectorAll(".equipped-accessory")).toHaveLength(1);expect(document.querySelectorAll("button,a,input")).toHaveLength(0)}});
});
