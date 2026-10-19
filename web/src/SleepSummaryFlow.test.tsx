import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { CareFeedback, PetState, Result } from "./types";

vi.mock("./api",()=>({request:vi.fn()}));
const api=vi.mocked(request),at=Date.parse("2026-10-19T02:00:00Z");
let saved:PetState,generation:string;
const result=():Result=>({state:structuredClone(saved),message:"",serverTime:Date.now(),saveGeneration:generation});
const summary=()=>screen.queryByRole("group",{name:"这次睡眠的实际结算"});
const writes=()=>api.mock.calls.filter(([p])=>p==="action");
const key=async(key:string)=>{await act(async()=>{fireEvent.keyDown(window,{key});});};
const mount=async()=>{await act(async()=>{render(<App/>);});};
async function wake(){await key("a");for(let i=0;i<3;i++)await key("a");await key("b");await key("c");}
async function poll(){await act(async()=>{vi.advanceTimersByTime(15000);});}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(at);localStorage.clear();api.mockReset();generation="a".repeat(32);
 saved={schema:17,revision:1,species:2,name:"好梦伙伴",createdAt:at-2*3600000,hatchedAt:at-2*3600000,lastTick:at,sleeping:true,
  needs:{hunger:77,mood:80,clean:88,energy:54},careCount:0,growth:emptyGrowth(),logs:[],
  sleepSession:{startedAt:at-3600000,settledHours:1,energyRecovered:14,restGain:.5,growthPoints:1.17}};
 saved.growth!.points=1.17;saved.growth!.trackedHours=1;saved.growth!.wellbeing=.73;saved.growth!.care.rest=.5;
 api.mockImplementation(async path=>{
  if(path!=="action")return result();
  const session=saved.sleepSession!;saved.sleeping=false;saved.sleepSession=undefined;saved.revision++;
  const feedback:CareFeedback={kind:"sleep",reason:"awake",points:0,habitGain:0,
   effect:{at,before:structuredClone(saved.needs),after:structuredClone(saved.needs)},sleepSummary:{...session,wokeAt:at}};
  return {...result(),careFeedback:feedback};
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it("does not expose an active session as a completed sleep; explicit wake shows the server receipt",async()=>{
 await mount();expect(summary()).toBeNull();await wake();
 expect(summary()?.textContent).toContain("恢复体力：+14.00");
 expect(writes()).toHaveLength(1);expect(writes()[0][3]).toBe(true);
 expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
 expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
});
it("keeps the original receipt after polls and status navigation, never reconstructs it on reload",async()=>{
 await mount();await wake();const original=summary()?.textContent;
 saved.revision++;saved.needs.energy=20;saved.growth!.care.rest+=2;await poll();
 expect(summary()?.textContent).toBe(original);
 await key("a");for(let i=0;i<4;i++)await key("a");await key("b");expect(summary()?.textContent).toBe(original);
 cleanup();await mount();expect(summary()).toBeNull();expect(writes()).toHaveLength(1);
});
it.each(["unknown","rejected"] as const)("a %s wake or its recovery read cannot invent the missing receipt",async disposition=>{
 await mount();
 if(disposition==="unknown"){saved.sleeping=false;saved.sleepSession=undefined;saved.revision++;}
 api.mockRejectedValueOnce(new RequestFailure("no acknowledgement",disposition,disposition==="rejected"?"sleep_changed":undefined));
 await wake();expect(summary()).toBeNull();await key("b");expect(summary()).toBeNull();expect(writes()).toHaveLength(1);
});
it("clears the confirmed sleep receipt when the save generation changes",async()=>{
 await mount();await wake();expect(summary()).not.toBeNull();generation="b".repeat(32);saved.revision++;await poll();
 expect(summary()).toBeNull();expect(writes()).toHaveLength(1);
});
