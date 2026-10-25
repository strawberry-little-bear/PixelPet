import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api=vi.mocked(request);
let saved: PetState;
const result=(): Result => ({state: structuredClone(saved),serverTime:Date.now()-120000,message:"",recapPending:false});
async function key(key:string) { await act(async()=>{fireEvent.keyDown(window,{key});}); }
async function info() {
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:/存档盒/}));});
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"运行信息 · 查看"}));});
 return within(screen.getByRole("region",{name:"运行信息"}));
}
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();api.mockReset();
 saved={schema:23,revision:10,species:2,name:"连接伙伴",createdAt:Date.now()-3600000,hatchedAt:Date.now()-3500000,lastTick:Date.now()-180000,sleeping:false,
  needs:{hunger:60,mood:70,clean:65,energy:80},careCount:0,growth:emptyGrowth("baby"),logs:[]};
 api.mockImplementation(async()=>result());
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({schema:23,build:{}}))));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
it("records local receipt time, ignores stale replies and keeps C/ABC usable after inspecting",async()=>{
 await act(async()=>{render(<App/>);});
 expect(fetch).not.toHaveBeenCalled();
 await info();
 const initial=document.querySelector(".runtime-info time")!.getAttribute("datetime");
 expect(initial).toBe(new Date(Date.now()).toISOString());
 expect(initial).not.toBe(new Date(saved.lastTick).toISOString());
 expect(initial).not.toBe(new Date(result().serverTime).toISOString());
 const stale=result(); stale.state.revision--;
 api.mockResolvedValueOnce(stale);
 await act(async()=>{vi.advanceTimersByTime(15000);});
 expect(document.querySelector(".runtime-info time")!.getAttribute("datetime")).toBe(initial);
 await key("c");expect(document.querySelector(".tools-menu")).toBeNull();
 await key("a");expect(document.querySelector(".content-menu")).toBeTruthy();
 expect(api.mock.calls.filter(([path])=>["action","import","reset"].includes(path))).toHaveLength(0);
 expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
 expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
});
it.each([
 ["unavailable",undefined,"暂时连接不上"],
 ["rejected","save_corrupt","存档需要修复"],
 ["rejected","clock_ahead","服务时间待校准"],
] as const)("distinguishes %s / %s even if version reads succeed",async(outcome,code,text)=>{
 api.mockRejectedValue(new RequestFailure("test diagnosis",outcome,code));
 await act(async()=>{render(<App/>);});
 const panel=await info();
 expect(panel.getByText(text)).toBeTruthy();
 expect(panel.getByText("本页还没有成功同步")).toBeTruthy();
 expect(panel.getByText("schema 23")).toBeTruthy();
 expect(api.mock.calls.filter(([path])=>["action","import","reset"].includes(path))).toHaveLength(0);
});
it.each([true, false])("reconciles unknown saves without repeating the action (close tools first: %s)",async(close)=>{
 await act(async()=>{render(<App/>);});
 await key("a");
 api.mockRejectedValueOnce(new RequestFailure("reply lost","unknown"));
 await key("b"); // Confirm default meal, whose result is unknown.
 const panel=await info();expect(panel.getByText("保存结果待核对")).toBeTruthy();
 expect(document.querySelector(".runtime-info time")).toBeTruthy();
 if (close) await key("c");
 await key("b");
 expect(document.querySelector(".save-recovery")).toBeNull();
 expect(api.mock.calls.filter(([path])=>path==="action")).toHaveLength(1);
});
