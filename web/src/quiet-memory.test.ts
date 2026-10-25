import { describe, expect, it } from "vitest";
import { nextQuietMemory, previousQuietMemory, quietMemories } from "./quiet-memory";
import type { Memory, PetState } from "./types";

const pet = (entries: Memory[], lastTick = 1000) => ({
  lastTick, album: { since: 1, legacy: false, entries },
}) as PetState;

describe("quiet memory conversations", () => {
  it("cycles genuine shared memories newest first without mutating their save", () => {
    const saved = pet([
      { kind: "meal", at: 100, source: "shared" },
      { kind: "walk", at: 300, source: "shared" },
      { kind: "bath", at: 200, source: "shared" },
    ]);
    const before = structuredClone(saved), memories = quietMemories(saved);
    expect(memories.map(m => m.title)).toEqual([
      "公园里走过的第一条小路", "泡泡里的小陪伴", "一份暖暖的小饭团",
    ]);
    let selected: string | null = null;
    const titles = Array.from({ length: 4 }, () => {
      selected = nextQuietMemory(memories, selected);
      return memories.find(m => m.key === selected)?.title;
    });
    expect(titles).toEqual([...memories.map(m => m.title), memories[0].title]);
    expect(saved).toEqual(before);
  });

  it("never invents shared events from legacy, calendar, future or unsupported entries", () => {
    const entries: Memory[] = [
      { kind: "adult", at: 200, source: "saved" },
      { kind: "days", at: 300, source: "elapsed", days: 7 },
      { kind: "days", at: 300, source: "shared", days: 7 },
      ...[NaN, Infinity, 0, -1, 1.5, 1001].map(at => ({ kind: "meal", at, source: "shared" }) as Memory),
      { kind: "unknown", at: 400, source: "shared" } as unknown as Memory,
      { kind: "meal", at: 500 } as Memory,
    ];
    expect(quietMemories(pet(entries))).toEqual([]);
    expect(quietMemories({ lastTick: 1000 } as PetState)).toEqual([]);
    expect(quietMemories(pet([{ kind: "meal", at: 100, source: "shared" }], NaN))).toEqual([]);
    expect(nextQuietMemory([], "missing")).toBeNull();
  });

  it("keeps an existing identity when new memories arrive and recovers when it disappears", () => {
    const first: Memory = { kind: "meal", at: 100, source: "shared" };
    const current = quietMemories(pet([first]))[0].key;
    const memories = quietMemories(pet([first, { kind: "walk", at: 200, source: "shared" }]));
    expect(memories.find(m => m.key === current)?.title).toBe("一份暖暖的小饭团");
    expect(nextQuietMemory(memories, current)).toBe(memories[0].key);
    expect(nextQuietMemory(memories.slice(0, 1), current)).toBe(memories[0].key);
  });

  it("offers a timeless response to recorded scenery without claiming real weather", () => {
    const [memory] = quietMemories(pet([{ kind: "scenery-walk-rain", at: 100, source: "shared" }]));
    expect(memory.title).toBe("细雨里的沿途发现");
    expect(memory.reply).toContain("手记");
    expect(memory.reply).not.toMatch(/今天|刚才|昨天|外面|正在下雨/);
  });
});

it("browses previous saved memories with wraparound and missing-key fallback", () => {
  const memories = quietMemories(pet([{ kind: "meal", at: 100, source: "shared" }, { kind: "bath", at: 200, source: "shared" }]));
  const before = structuredClone(memories);
  expect(previousQuietMemory(memories, memories[1].key)).toBe(memories[0].key);
  expect(previousQuietMemory(memories, memories[0].key)).toBe(memories[1].key);
  expect(previousQuietMemory(memories, "removed")).toBe(memories[1].key);
  expect(previousQuietMemory([], null)).toBeNull();
  expect(memories).toEqual(before);
});
