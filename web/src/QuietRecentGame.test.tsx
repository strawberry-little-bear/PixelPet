import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { games } from "./games";
import { emptyGrowth } from "./growth";
import { QuietMoment } from "./QuietMoment";
import { nextQuietMemory, quietMemories } from "./quiet-memory";
import type { GameExperience, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.UTC(2026, 9, 24, 3);
const pet = (): PetState => ({
  schema: 19, revision: 1, species: 2, name: "一起记得", createdAt: at - 7200000, hatchedAt: at - 7200000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0,
  logs: [], growth: { ...emptyGrowth("adult"), form: "gentle" },
  album: { since: at - 7200000, legacy: false, entries: [{ kind: "stars", at: at - 60000, source: "shared" }] },
  companion: { since: at - 7200000, interests: games.map(game => ({ kind: game.id, points: 5, lastAt: at - 60000 })),
    recent: { kind: "stars", id: "actual-repeat", at: at - 1000 } },
});
const copy = () => document.querySelector(".quiet-moment-copy > p")?.textContent;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(games)("recalls a genuine recent $id completion independently of capped familiarity", game => {
  const saved = pet(); saved.companion!.recent!.kind = game.id;
  const before = structuredClone(saved), memories = quietMemories(saved);
  expect(memories[0].title).toBe(`最近一次一起玩「${game.title}」`);
  render(<QuietMoment pet={saved} choice={2} replied memoryKey={memories[0].key} />);
  expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("从共同游戏记录想起：");
  expect(document.querySelector(".quiet-memory-source time")?.getAttribute("datetime")).toBe(new Date(at - 1000).toISOString());
  expect(copy()).not.toMatch(/今天|刚才|昨天|奖励|成长|金币/);
  expect(document.querySelector(".lcd button,button,a,input")).toBeNull();
  expect(saved).toEqual(before);
});
it.each([
  ["missing recent", undefined], ["empty id", { kind: "stars", id: " ", at: at - 1000 }],
  ["wrong id type", { kind: "stars", id: 12, at: at - 1000 }],
  ["unknown game", { kind: "other", id: "x", at: at - 1000 }],
  ...[0, NaN, Infinity, at + 1, at - 7200001, at - .5].map(moment => [String(moment), { kind: "stars", id: "x", at: moment }] as const),
] as const)("does not invent recent history: %s", (_, recent) => {
  const saved = pet(); saved.companion!.recent = recent as GameExperience | undefined;
  expect(quietMemories(saved)).toHaveLength(1);
  expect(quietMemories(saved)[0].title).toBe("一起追过的星光");
});
it.each(["missing companion", "missing hatch", "future since", "invalid clock"])("retains album-only fallback for %s", scenario => {
  const saved = pet();
  if (scenario === "missing companion") delete saved.companion;
  if (scenario === "missing hatch") saved.hatchedAt = 0;
  if (scenario === "future since") saved.companion!.since = at + 1;
  if (scenario === "invalid clock") saved.lastTick = NaN;
  expect(quietMemories(saved).filter(m => m.title.startsWith("最近一次"))).toEqual([]);
});
it.each(["stars", "perfect-stars"] as const)("does not repeat a first completion already present as %s", kind => {
  const saved = pet(); saved.album!.entries = [{ kind, at: at - 1000, source: "shared" }];
  expect(quietMemories(saved)).toHaveLength(1);
  expect(quietMemories(saved)[0].key).toBe(`${kind}:${at - 1000}`);
});
it("merges recent play with newer care and older first-game memories in saved order", () => {
  const saved = pet(); saved.album!.entries.push({ kind: "meal", at, source: "shared" });
  const memories = quietMemories(saved);
  expect(memories.map(m => m.title)).toEqual(["一份暖暖的小饭团", "最近一次一起玩「接星星」", "一起追过的星光"]);
  let key: string | null = null;
  const cycle = Array.from({ length: 4 }, () => key = nextQuietMemory(memories, key));
  expect(cycle).toEqual([...memories.map(m => m.key), memories[0].key]);
});
it("does not speak a replacement session automatically, and keeps sleeping company quiet", () => {
  const saved = pet(), selected = quietMemories(saved)[0].key;
  const { rerender } = render(<QuietMoment pet={saved} choice={2} replied memoryKey={selected} />);
  saved.companion!.recent!.id = "another-session";
  rerender(<QuietMoment pet={saved} choice={2} replied memoryKey={selected} />);
  expect(copy()).toContain("已不在当前读取的记录里"); expect(document.querySelector(".quiet-memory-source")).toBeNull();
  saved.sleeping = true;
  rerender(<QuietMoment pet={saved} choice={2} replied memoryKey={quietMemories(saved)[0].key} />);
  expect(copy()).toContain("甜甜地睡着"); expect(document.querySelector(".quiet-memory-source")).toBeNull();
});
it("selects recent games with three keys, clears replaced history on sync, and makes no action writes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const saved = pet(); api.mockReset();
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), serverTime: at, message: "" }));
  await act(async () => { render(<App />); });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  await key("a"); for (let n = 0; n < 12; n++) await key("a"); await key("b");
  await key("a"); await key("a");
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  await key("b"); expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("最近一次一起玩「接星星」");
  const before = structuredClone(saved);
  await key("b"); expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("从纪念册想起：");
  await key("b"); expect(saved).toEqual(before);
  saved.companion!.recent = { kind: "walk", id: "another-real-session", at: at - 500 }; saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(copy()).toContain("已不在当前读取的记录里"); expect(document.querySelector(".quiet-memory-source")).toBeNull();
  await key("b"); expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("最近一次一起玩「公园散步」");
  await key("c"); expect(document.querySelector(".quiet-moment")).not.toBeNull();
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
