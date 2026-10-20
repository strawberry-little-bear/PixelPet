import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import { ImportPreview } from "./ImportPreview";
import { previewBackup } from "./backup";
import type { PetState, Result } from "./types";
vi.mock("./api",()=>({request:vi.fn()}));
const api=vi.mocked(request);
let saved:PetState;
const result=():Result=>({state:structuredClone(saved),serverTime:Date.now(),message:""});
const imports=()=>api.mock.calls.filter(([path])=>path==="import");
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key});});}
async function mount(){await act(async()=>{render(<App/>);});}
async function chooseFile(body:string, options:{name?:string;size?:number;text?:()=>Promise<string>}={}){
  const file=new File([body],options.name??"pixelpet-backup.json",{type:"application/json"});
  Object.defineProperty(file,"text",{value:options.text??(async()=>body)});
  if(options.size!==undefined)Object.defineProperty(file,"size",{value:options.size});
  await act(async()=>{fireEvent.change(screen.getByLabelText("导入存档文件"),{target:{files:[file]}});});
}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();api.mockReset();
 saved={schema:2,revision:1,species:2,name:"当前伙伴",createdAt:Date.now()-10000,hatchedAt:Date.now()-9000,lastTick:Date.now(),sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:80},careCount:0,growth:emptyGrowth("baby"),logs:[]};
 api.mockImplementation(async(path,body)=>{if(path==="import")saved={...body as PetState,game:undefined,revision:saved.revision+1};return result();});
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("three-key import confirmation",()=>{
 it.each(["a","c"])("does not import on selection and %s cancels without changing the save",async cancel=>{
  const before=structuredClone(saved);await mount();await chooseFile(JSON.stringify({...saved,name:"备份伙伴",species:7}));
  expect(screen.getByLabelText("备份导入确认")).toBeTruthy();expect(screen.getByText(/备份伙伴 · 樱花喵/)).toBeTruthy();
  expect(screen.getByText(/将替换当前「当前伙伴」/)).toBeTruthy();expect(imports()).toHaveLength(0);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  await key(cancel);expect(document.querySelector(".import-preview")).toBeNull();expect(saved).toEqual(before);expect(imports()).toHaveLength(0);
  await key("b");expect(document.querySelector(".care-menu")).toBeTruthy();expect(imports()).toHaveLength(0);
 });
 it("imports exactly the previewed object on B, blocks repeated confirmation, and uses the server result",async()=>{
  await mount();const backup={...saved,name:"文件中的伙伴",species:7};await chooseFile(JSON.stringify(backup));
  const gate=deferred<Result>();api.mockImplementation(async path=>path==="import"?gate.promise:result());
  await key("b");await key("b");await key("a");await key("c");
  expect(imports()).toHaveLength(1);expect(imports()[0][1]).toEqual(backup);expect(screen.getByText("正在导入，请稍候…")).toBeTruthy();
  saved={...backup,name:"服务端确认伙伴",growth:emptyGrowth("adult"),revision:2};saved.growth!.form="gentle";
  await act(async()=>{gate.resolve(result());});
  expect(document.querySelector(".import-preview")).toBeNull();expect(screen.getByRole("heading",{name:"服务端确认伙伴"})).toBeTruthy();
  expect(document.querySelector('[data-motion="evolve"]')).toBeNull();expect(imports()).toHaveLength(1);
 });
 it.each(["{", "{}", "null"])("a locally invalid file %j never reaches import, B cannot confirm it",async text=>{
  await mount();await chooseFile(text);await key("b");expect(imports()).toHaveLength(0);
  expect(screen.getByText(/没有发送导入请求，当前存档未被替换/)).toBeTruthy();await key("c");expect(document.querySelector(".content-home")).toBeTruthy();
 });
 it("rejects oversized files without reading their bytes",async()=>{
  await mount();const text=vi.fn(async()=>JSON.stringify(saved));await chooseFile("{}",{size:65537,text});
  expect(text).not.toHaveBeenCalled();expect(screen.getByText(/文件过大/)).toBeTruthy();await key("b");expect(imports()).toHaveLength(0);
 });
 it("cancels while reading and ignores a later file completion",async()=>{
  await mount();const gate=deferred<string>();await chooseFile("{}",{text:()=>gate.promise});await key("b");expect(imports()).toHaveLength(0);
  await key("c");await act(async()=>{gate.resolve(JSON.stringify(saved));});
  expect(document.querySelector(".import-preview")).toBeNull();expect(document.querySelector(".content-home")).toBeTruthy();expect(imports()).toHaveLength(0);
 });
 it("a newly selected file wins over an earlier delayed file or read error",async()=>{
  await mount();const gate=deferred<string>();await chooseFile("{}",{name:"old.json",text:()=>gate.promise});
  await chooseFile(JSON.stringify({...saved,name:"新文件伙伴"}),{name:"new.json"});
  await act(async()=>{gate.reject(new Error("old read failed"));});
  expect(screen.getByText("文件：new.json")).toBeTruthy();expect(screen.getByText(/新文件伙伴 · 草莓兔/)).toBeTruthy();
  await key("b");expect(imports()).toHaveLength(1);expect((imports()[0][1] as PetState).name).toBe("新文件伙伴");
 });
 it("allows selecting the same file after cancel and clears the file input",async()=>{
  await mount();const body=JSON.stringify(saved);await chooseFile(body);await key("a");await chooseFile(body);
  expect((screen.getByLabelText("导入存档文件") as HTMLInputElement).value).toBe("");await key("b");expect(imports()).toHaveLength(1);
 });
 it("keeps authoritative rejection readable and cancellable without replacing the current save",async()=>{
  await mount();const before=structuredClone(saved),body={...saved,extra:"must not be stripped"};
  await chooseFile(JSON.stringify(body));api.mockRejectedValueOnce(new RequestFailure("备份校验失败","rejected"));
  await key("b");expect(screen.getByRole("alert").textContent).toContain("校验失败");
  expect(imports()[0][1]).toEqual(body);expect(document.querySelector(".import-preview")).toBeTruthy();
  await key("c");expect(saved).toEqual(before);expect(imports()).toHaveLength(1);
 });
 it("discarded confirmation cannot resend after an unknown write result is reconciled",async()=>{
  await mount();await chooseFile(JSON.stringify({...saved,name:"新伙伴"}));
  api.mockImplementation(async(path,body)=>{if(path==="import"){saved={...body as PetState,revision:2};throw new RequestFailure("lost","unknown");}return result();});
  await key("b");expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b");expect(document.querySelector(".import-preview")).toBeNull();await key("b");expect(imports()).toHaveLength(1);
  expect(saved.name).toBe("新伙伴");expect(document.querySelector(".care-menu")).toBeTruthy();
 });
 it("a failed poll discards a pending file and late parse cannot reopen it after reconnect",async()=>{
  await mount();const gate=deferred<string>();await chooseFile("{}",{text:()=>gate.promise});
  api.mockRejectedValueOnce(new RequestFailure("offline","unavailable"));await act(async()=>{vi.advanceTimersByTime(15000);});
  expect(document.querySelector(".save-recovery")).toBeTruthy();await key("b");await act(async()=>{gate.resolve(JSON.stringify(saved));});
  expect(document.querySelector(".import-preview")).toBeNull();expect(document.querySelector(".content-home")).toBeTruthy();expect(imports()).toHaveLength(0);
 });
 it("returns to the original reading page without triggering a menu action",async()=>{
  await mount();await key("a");for(let i=0;i<4;i++)await key("a");await key("b");
  expect(document.querySelector(".screen-status")).toBeTruthy();await chooseFile(JSON.stringify(saved));await key("a");
  expect(document.querySelector(".screen-status")).toBeTruthy();expect(api.mock.calls.some(([path])=>path==="action")).toBe(false);
 });
 it("cancelling over a game does not auto-resume or produce a step, reward or care write",async()=>{
  saved.game={kind:"snake",id:"0123456789abcdef0123456789abcdef",startedAt:Date.now(),round:0,score:0,lastBeat:-1,snake:{body:[{x:3,y:3},{x:2,y:3}],food:{x:7,y:7},direction:1,eaten:0,step:0,lastMoveAt:Date.now(),paused:true}};
  await mount();await chooseFile(JSON.stringify(saved));await key("c");
  expect(document.querySelector(".snake-overlay")).toBeTruthy();await act(async()=>{vi.advanceTimersByTime(5000);});
  expect(api.mock.calls.some(([path])=>path==="action")).toBe(false);expect(imports()).toHaveLength(0);
 });
 it("keeps a file read failure local and allows cancel", async () => {
  await mount();
  await chooseFile("{}", { text: async () => { throw new Error("无法读取文件"); } });
  expect(screen.getByRole("alert").textContent).toContain("无法读取文件");
  await key("b");
  expect(imports()).toHaveLength(0);
  await key("a");
  expect(document.querySelector(".content-home")).toBeTruthy();
 });
 it("falls back home when another tab ended the game while previewing", async () => {
  saved.game = { id: "game-before-preview", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
  await mount();
  await chooseFile(JSON.stringify(saved));
  saved.game = undefined;
  saved.revision++;
  await act(async () => { vi.advanceTimersByTime(15000); });
  await key("c");
  expect(document.querySelector(".content-home")).toBeTruthy();
  expect(api.mock.calls.some(([path]) => path === "action")).toBe(false);
 });
 it("uses the server result that clears an imported unfinished game without granting rewards", async () => {
  await mount();
  const backup = { ...saved, game: {
    kind: "snake", id: "0123456789abcdef0123456789abcdef", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1,
    snake: { body: [{ x: 3, y: 3 }, { x: 2, y: 3 }], food: { x: 7, y: 7 }, direction: 1, eaten: 0, step: 0, lastMoveAt: Date.now(), paused: false },
  } };
  await chooseFile(JSON.stringify(backup));
  await key("b");
  expect(document.querySelector(".content-home")).toBeTruthy();
  expect(saved.game).toBeUndefined();
  expect(saved.careCount).toBe(backup.careCount);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(api.mock.calls.some(([path]) => path === "action")).toBe(false);
  expect(imports()).toHaveLength(1);
 });
 it("ignores an earlier poll response that arrives after confirmed import", async () => {
  await mount();
  await chooseFile(JSON.stringify({ ...saved, name: "确认后的伙伴" }));
  const old = result(), gate = deferred<Result>();
  api.mockImplementation(async (path, body) => {
    if (path === "visit") return gate.promise;
    if (path === "import") saved = { ...body as PetState, revision: saved.revision + 1 };
    return result();
  });
  await act(async () => { vi.advanceTimersByTime(15000); });
  await key("b");
  await act(async () => { gate.resolve(old); });
  expect(screen.getByRole("heading", { name: "确认后的伙伴" })).toBeTruthy();
  expect(imports()).toHaveLength(1);
 });
 it("escapes hostile filename and pet names as text, never markup",()=>{
  render(<ImportPreview pet={saved} busy={false} pending={{fileName:'<img src=x onerror=alert(1)>.json',backup:previewBackup(JSON.stringify({...saved,name:'<script>x</script>'}))}}/>);
  expect(screen.getByText(/<img src=x/)).toBeTruthy();expect(document.querySelector("img,script,button,a,input")).toBeNull();
 });
});

it("clears the page-local game choice after a successful same-lifecycle legacy import, but not cancellation", async () => {
  await mount();
  const directory = async () => { for (const k of ["a", "a", "b"]) await key(k); };
  await directory(); await key("a"); await key("c");
  await chooseFile(JSON.stringify(saved)); await key("c");
  await directory(); expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe("tiles");
  await key("c"); await chooseFile(JSON.stringify(saved)); await key("b");
  await directory(); expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe("stars");
  expect(imports()).toHaveLength(1); expect(api.mock.calls.some(([path]) => path === "action")).toBe(false);
});
