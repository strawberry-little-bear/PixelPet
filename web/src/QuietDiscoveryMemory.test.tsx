import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { fishCatalog } from "./fishing";
import { parkCatalog } from "./walk";
import { QuietMoment } from "./QuietMoment";
import { nextQuietMemory, quietMemories } from "./quiet-memory";
import type { FishDiscovery, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.UTC(2026, 9, 25, 3);
const discovery = (id: string, firstAt = at - 1000): FishDiscovery => ({ id, firstAt, lastAt: firstAt, count: 1 });
const pet = (): PetState => ({
  schema: 22, revision: 1, species: 2, name: "一起发现", createdAt: at - 3600000, hatchedAt: at - 3600000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
  pond: { since: at - 3600000, fish: [discovery("reed-minnow")] },
  park: { since: at - 3600000, finds: [discovery("leaf", at - 2000)], walks: 0, lastWalkAt: 0 },
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([...fishCatalog.map(item => ({ ...item, source: "fish" })), ...parkCatalog.map(item => ({ ...item, source: "park" }))])(
  "recalls the actual named $id discovery without needing a completed game", item => {
    const saved = pet(); saved.pond!.fish = []; saved.park!.finds = [];
    (item.source === "fish" ? saved.pond!.fish : saved.park!.finds)!.push(discovery(item.id));
    const before = structuredClone(saved), [memory] = quietMemories(saved);
    expect(memory).toMatchObject({ key: `${item.source}:${item.id}:${at - 1000}`, source: item.source,
      discovery: item.id, title: `初次遇见「${item.name}」`, at: at - 1000 });
    expect(memory.reply).toContain(item.name);
    expect(memory.reply).not.toMatch(/今天|昨天|刚才|完成|奖励|金币|集齐/);
    expect(saved).toEqual(before);
  },
);
it.each([
  { count: 0 }, { count: 10000 }, { count: 1.5 }, { count: NaN }, { id: "unknown" }, { id: "toString" },
  ...[0, -1, NaN, Infinity, at + 1, at - 3600001, at - 1000.5].map(firstAt => ({ firstAt })),
  { lastAt: at - 1001 }, { lastAt: at + 1 }, { lastAt: NaN }, { lastAt: Infinity },
])("excludes malformed discovery metadata %j", (change: Partial<FishDiscovery>) => {
  const saved = pet(); Object.assign(saved.pond!.fish![0], change);
  // Both entries use the same first timestamp for these boundary checks.
  saved.park!.finds![0] = { ...saved.pond!.fish![0], id: change.id ?? "leaf" };
  expect(quietMemories(saved)).toEqual([]);
});
it.each([0, NaN, Infinity, at + 1])("requires a valid catalog start and hatch: %s", since => {
  const saved = pet(); saved.pond!.since = since; saved.park!.since = since;
  expect(quietMemories(saved)).toEqual([]);
  saved.pond!.since = saved.park!.since = at - 3600000; saved.hatchedAt = since;
  expect(quietMemories(saved)).toEqual([]);
});
it("keeps optional old catalogs empty and respects schema-specific fish eligibility", () => {
  const saved = pet(); delete saved.pond; delete saved.park;
  expect(quietMemories(saved)).toEqual([]);
  const legacy = pet(); legacy.pond!.fish = [discovery("rain-koi"), discovery("willow-darter")];
  legacy.schema = 7; expect(quietMemories(legacy)).toEqual([]);
  legacy.schema = 10; expect(quietMemories(legacy)).toEqual([]);
  legacy.schema = 14; expect(quietMemories(legacy).map(m => m.discovery)).toEqual(["leaf"]);
  legacy.schema = 15; expect(quietMemories(legacy).map(m => m.discovery)).toEqual(["rain-koi", "leaf"]);
  legacy.schema = 20; expect(quietMemories(legacy)).toHaveLength(3);
});
it("orders equal-time discoveries deterministically and preserves first identity after repeat encounters", () => {
  const saved = pet(); saved.pond!.fish!.push(discovery("sun-carp")); saved.park!.finds![0].firstAt = at - 1000;
  saved.park!.finds![0].lastAt = at - 1000;
  const memories = quietMemories(saved), selected = memories[0];
  saved.pond!.fish!.reverse(); saved.pond!.fish![0].count++; saved.pond!.fish![0].lastAt = at;
  expect(quietMemories(saved)).toEqual(memories);
  const cycle = []; let key: string | null = null;
  for (let n = 0; n < memories.length + 1; n++) { key = nextQuietMemory(memories, key); cycle.push(key); }
  expect(cycle).toEqual([...memories.map(m => m.key), selected.key]);
});
it("interleaves first discoveries with care and game memories using saved times", () => {
  const saved = pet(); saved.album = { since: saved.hatchedAt, legacy: false, entries: [{ kind: "meal", at: at - 1500, source: "shared" }] };
  expect(quietMemories(saved).map(m => m.source)).toEqual(["fish", "album", "park"]);
});
it("shows named art and first-record time, falls back if removed, and stays quiet during sleep", () => {
  const saved = pet(), memory = quietMemories(saved)[0];
  const { rerender } = render(<QuietMoment pet={saved} choice={2} replied memoryKey={memory.key} />);
  expect(document.querySelector(".quiet-discovery .fish-art")).not.toBeNull();
  expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("从鱼图鉴想起：初次遇见「青苇小鲦」");
  expect(document.querySelector("time")?.dateTime).toBe(new Date(memory.at).toISOString());
  saved.pond!.fish = [];
  rerender(<QuietMoment pet={saved} choice={2} replied memoryKey={memory.key} />);
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  expect(document.querySelector(".quiet-discovery")).toBeNull();
  saved.sleeping = true;
  rerender(<QuietMoment pet={saved} choice={2} replied memoryKey={quietMemories(saved)[0].key} />);
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  expect(document.querySelector(".quiet-moment-copy > p")?.textContent).toContain("甜甜地睡着");
});
it("cycles catalog memories with A/B/C, preserves a selected first record on sync, and never writes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const saved = pet(); api.mockReset();
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), serverTime: at, message: "" }));
  await act(async () => { render(<App />); });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  await key("a"); for (let n = 0; n < 12; n++) await key("a"); await key("b"); await key("a"); await key("a");
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  await key("b"); const text = document.querySelector(".quiet-memory-source")?.textContent;
  expect(text).toContain("青苇小鲦");
  saved.pond!.fish![0].count++; saved.pond!.fish![0].lastAt = at; saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".quiet-memory-source")?.textContent).toBe(text);
  await key("b"); expect(document.querySelector(".quiet-discovery .park-art")).not.toBeNull();
  expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("从公园图鉴想起：初次遇见「银杏叶」");
  await key("b"); expect(document.querySelector(".quiet-memory-source")?.textContent).toBe(text);
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
});
