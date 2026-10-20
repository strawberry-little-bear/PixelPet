import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { albumCategories, albumMemories } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import type { Memory, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const panel = () => document.querySelector<HTMLElement>("[data-album-page]")!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function open(choice = 0) {
  await key("a"); for (let i = 0; i < 8; i++) await key("a"); await key("b");
  for (let i = 0; i < choice; i++) await key("a"); await key("b");
}
async function mount() { await act(async () => { render(<App />); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const at = Date.now() - 10 * 86400000;
  const entries: Memory[] = [
    {kind:"hatch",at,source:"shared"}, {kind:"growing",at:at+1,source:"shared"},
    {kind:"meal",at:at+2,source:"shared"}, {kind:"bath",at:at+3,source:"shared"},
    {kind:"goodnight",at:at+4,source:"shared"}, {kind:"stars",at:at+5,source:"shared",score:2},
    {kind:"tiles",at:at+6,source:"shared"}, {kind:"outfit",at:at+7,source:"shared",item:"leaf-pin"},
    {kind:"decoration",at:at+8,source:"shared",item:"clover-pot"},
    {kind:"days",days:1,at:at+86400000,source:"elapsed"}, {kind:"days",days:7,at:at+7*86400000,source:"elapsed"},
    {kind:"scenery-walk-clear",at:at+9,source:"shared"}, {kind:"scenery-walk-rain",at:at+10,source:"shared"},
  ];
  saved = {schema:18,revision:1,species:2,name:"回忆伙伴",createdAt:at,hatchedAt:at,lastTick:Date.now(),sleeping:false,
    needs:{hunger:60,mood:80,clean:60,energy:80},careCount:0,logs:[],growth:emptyGrowth("growing"),
    album:{since:at,legacy:false,entries}};
  saved.growth!.points=30;
  api.mockImplementation(async () => ({state:structuredClone(saved),saveGeneration:"a".repeat(32),serverTime:Date.now(),message:""}) as Result);
});
afterEach(() => {
  try { expect(api.mock.calls.filter(([path]) => !["state","visit"].includes(path))).toHaveLength(0); }
  finally { cleanup(); vi.useRealTimers(); }
});
it.each(albumCategories.map((category,choice) => ({...category,choice})))
  ("$id: A reads backwards, B forwards, both wrap through the cover and C keeps the category", async ({id,choice}) => {
    const before=structuredClone(saved); await mount(); await open(choice);
    const memories=albumMemories(saved,id);
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("A 上一页");
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 下一页");
    await key("a"); expect(panel().dataset.albumKind).toBe(memories.at(-1)?.kind);
    await key("b"); expect(panel().dataset.albumKind).toBeUndefined();
    await key("b"); expect(panel().dataset.albumKind).toBe(memories[0].kind);
    await key("a"); expect(panel().dataset.albumKind).toBeUndefined();
    await key("a");
    for (let i=memories.length-1;i>=0;i--) {
      expect(panel().dataset.albumKind).toBe(memories[i].kind);
      expect(panel().dataset.albumPage).toBe(String(i+1)); await key("a");
    }
    expect(panel().dataset.albumPage).toBe("0");
    await key("c"); expect(document.querySelector(`[data-album-directory="${id}"]`)).toBeTruthy();
    await key("b"); expect(panel().dataset.albumPage).toBe("0");
    await key("c"); await key("c"); expect(document.querySelector(".home-caption")).toBeTruthy();
    expect(saved).toEqual(before); expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  });
it("reverses from the selected identity after sync inserts an earlier tied-date care memory", async () => {
  saved.album!.entries=saved.album!.entries.filter(m => ["hatch","meal"].includes(m.kind));
  await mount(); await open(2); await key("b"); expect(panel().dataset.albumKind).toBe("meal");
  saved.album!.entries.push({kind:"bath",at:saved.album!.entries[1].at,source:"shared"}); await refresh();
  expect(panel().dataset.albumKind).toBe("meal"); await key("a"); expect(panel().dataset.albumKind).toBe("bath");
  await key("b"); expect(panel().dataset.albumKind).toBe("meal");
  saved.album!.entries=saved.album!.entries.filter(m=>m.kind!=="meal"); await refresh();
  expect(panel().dataset.albumKind).toBeUndefined(); expect(panel().textContent).toContain("同步时未找到");
  await key("a"); expect(panel().dataset.albumKind).toBe("bath"); expect(panel().textContent).not.toContain("同步时未找到");
});
it.each([undefined,{since:0,legacy:false,entries:[]}])("empty or old albums have no phantom reverse page (%s)", async album => {
  saved.album=album; await mount(); await open(); await key("a"); await key("b");
  expect(panel().textContent).toContain("1 / 1"); expect(panel().querySelector("time")).toBeNull();
});
