import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { gameKeepsakes } from "./game-keepsakes";
import { emptyGrowth } from "./growth";
import { QuietMoment } from "./QuietMoment";
import { nextQuietMemory, quietMemories } from "./quiet-memory";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.UTC(2026, 9, 25, 2);
const pet = (): PetState => ({
  schema: 21, revision: 1, species: 2, name: "记着小物件", createdAt: at - 7200000, hatchedAt: at - 7200000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0,
  logs: [], growth: { ...emptyGrowth("adult"), form: "gentle" },
  album: { since: at - 7200000, legacy: false, entries: gameKeepsakes.map(k => ({
    kind: "keepsake", item: k.item, at: at - 1000, source: "shared",
  })) },
});
const copy = () => document.querySelector(".quiet-moment-copy > p")?.textContent;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(gameKeepsakes)("recalls the saved $item with its own words, art and original date", keepsake => {
  const saved = pet(), before = structuredClone(saved);
  const memory = quietMemories(saved).find(m => m.keepsake === keepsake.item)!;
  render(<QuietMoment pet={saved} choice={2} replied memoryKey={memory.key} />);
  expect(copy()).toBe(keepsake.reply);
  expect(copy()).not.toMatch(/今天|刚才|昨天|奖励|金币|第一次/);
  expect(document.querySelector(".quiet-memory-source")?.textContent).toContain(keepsake.title);
  expect(document.querySelector(".quiet-memory-source time")?.getAttribute("datetime")).toBe(new Date(at - 1000).toISOString());
  expect(document.querySelector(".quiet-keepsake [data-keepsake-art]")?.getAttribute("data-keepsake-art")).toBe(keepsake.item);
  expect(document.querySelector(".quiet-keepsake")?.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
  expect(saved).toEqual(before);
});
it("cycles all seven same-time keepsakes independently and deterministically", () => {
  const saved = pet(), memories = quietMemories(saved);
  expect(new Set(memories.map(m => m.key)).size).toBe(7);
  let selected: string | null = null;
  const keys = Array.from({ length: 8 }, () => selected = nextQuietMemory(memories, selected));
  expect(new Set(keys.slice(0, 7)).size).toBe(7); expect(keys[7]).toBe(keys[0]);
  saved.album!.entries.reverse();
  expect(quietMemories(saved)).toEqual(memories);
});
it.each(["old schema", "unknown item", "missing item", "saved source", "future", "invalid time", "no album"])("does not invent a keepsake conversation from %s", condition => {
  const saved = pet(); saved.album!.entries = [saved.album!.entries[0]];
  const entry = saved.album!.entries[0];
  if (condition === "old schema") saved.schema = 20;
  if (condition === "unknown item") entry.item = "future-keepsake";
  if (condition === "missing item") delete entry.item;
  if (condition === "saved source") entry.source = "saved";
  if (condition === "future") entry.at = at + 1;
  if (condition === "invalid time") entry.at = NaN;
  if (condition === "no album") delete saved.album;
  expect(quietMemories(saved)).toEqual([]);
});
it("does not infer ownership from completed games or interest, or replay an extra recent session", () => {
  const saved = pet();
  saved.album!.entries.push({ kind: "stars", at: at - 1000, source: "shared" });
  saved.companion = { since: at - 7200000, interests: [{ kind: "stars", points: 5, lastAt: at - 1000 }],
    recent: { kind: "stars", id: "actual-session", at: at - 1000 } };
  expect(quietMemories(saved).filter(m => m.source === "game")).toHaveLength(0);
  saved.album!.entries = saved.album!.entries.filter(m => m.kind !== "keepsake");
  expect(quietMemories(saved).some(m => m.keepsake)).toBe(false);
});
it.each(["sleeping", "not replied", "different interaction", "removed", "replaced item"])("clears the keepsake art and words when %s", condition => {
  const saved = pet(), memory = quietMemories(saved)[0];
  const { rerender } = render(<QuietMoment pet={saved} choice={2} replied memoryKey={memory.key} />);
  expect(document.querySelector(".quiet-keepsake")).not.toBeNull();
  if (condition === "sleeping") saved.sleeping = true;
  if (condition === "removed") saved.album!.entries = [];
  if (condition === "replaced item") saved.album!.entries = saved.album!.entries.filter(m => m.item !== memory.keepsake);
  rerender(<QuietMoment pet={saved} choice={condition === "different interaction" ? 0 : 2}
    replied={condition !== "not replied"} memoryKey={memory.key} />);
  expect(document.querySelector(".quiet-keepsake")).toBeNull();
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  expect(copy()).not.toBe(memory.reply);
});
it("keeps the selected same-time item on sync, removes it when absent, and uses only three read-only keys", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const saved = pet(); api.mockReset();
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), serverTime: at, message: "" }));
  const before = structuredClone(saved);
  await act(async () => { render(<App />); });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  await key("a"); for (let n = 0; n < 12; n++) await key("a"); await key("b");
  await key("a"); await key("a");
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    await key("b"); seen.add(document.querySelector(".quiet-keepsake [data-keepsake-art]")?.getAttribute("data-keepsake-art"));
  }
  expect(seen.size).toBe(7); expect(seen.has(undefined)).toBe(false);
  expect(saved).toEqual(before);
  const selected = document.querySelector(".quiet-keepsake [data-keepsake-art]")!.getAttribute("data-keepsake-art");
  saved.album!.entries.reverse(); saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".quiet-keepsake [data-keepsake-art]")?.getAttribute("data-keepsake-art")).toBe(selected);
  saved.album!.entries = saved.album!.entries.filter(m => m.item !== selected); saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".quiet-keepsake")).toBeNull(); expect(copy()).toContain("你好呀");
  await key("b"); expect(document.querySelector(".quiet-keepsake")).not.toBeNull();
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
