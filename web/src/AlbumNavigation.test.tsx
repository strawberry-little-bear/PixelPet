import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: generation, message: "", serverTime: Date.now() });
const panel = () => document.querySelector<HTMLElement>('[aria-label="永久纪念册"]')!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function open(choice = 0) {
  await key("a"); for (let i = 0; i < 8; i++) await key("a"); await key("b");
  for (let i = 0; i < choice; i++) await key("a"); await key("b");
}
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = "a".repeat(32);
  const at = Date.now() - 60000;
  saved = { schema: 11, revision: 1, species: 2, name: "纪念伙伴", createdAt: at - 10000,
    hatchedAt: at - 10000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth(),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [],
    album: { since: at - 10000, legacy: false, entries: [
      { kind: "hatch", at: at - 10000, source: "shared" }, { kind: "meal", at, source: "shared" },
    ] } };
  api.mockImplementation(async () => result());
});
afterEach(() => {
  try { expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0); }
  finally { cleanup(); vi.useRealTimers(); }
});

describe("album reading synchronization", () => {
  it("keeps the actual memory selected when a tied-timestamp record sorts before it", async () => {
    await mount(); await open(); await key("a"); await key("a");
    expect(panel().dataset.albumKind).toBe("meal");
    saved.album!.entries.push({ kind: "bath", at: saved.album!.entries[1].at, source: "shared" });
    await refresh();
    expect(panel().dataset.albumKind).toBe("meal");
    expect(panel().textContent).toContain("4 / 4");
    await key("b"); expect(panel().dataset.albumKind).toBeUndefined();
    await key("a"); expect(panel().dataset.albumKind).toBe("hatch");
    await key("b"); expect(panel().dataset.albumKind).toBe("bath");
  });
  it("anchors within a category and advances from the updated position with either key", async () => {
    await mount(); await open(2); await key("b");
    expect(panel().dataset.albumKind).toBe("meal");
    saved.album!.entries.push({ kind: "bath", at: saved.album!.entries[1].at, source: "shared" });
    await refresh(); expect(panel().dataset.albumKind).toBe("meal"); expect(panel().textContent).toContain("3 / 3");
    await key("a"); expect(panel().dataset.albumKind).toBeUndefined();
    await key("b"); expect(panel().dataset.albumKind).toBe("bath");
    await key("a"); expect(panel().dataset.albumKind).toBe("meal");
  });
  it("keeps the cover and category directory still when new memories arrive", async () => {
    await mount(); await open(2);
    saved.album!.entries.push({ kind: "bath", at: Date.now(), source: "shared" });
    await refresh(); expect(panel().dataset.albumKind).toBeUndefined(); expect(panel().textContent).toContain("1 / 3");
    await key("c"); await refresh();
    expect(document.querySelector('[data-album-directory="care"]')).toBeTruthy();
    await key("b"); expect(panel().dataset.albumKind).toBeUndefined();
  });
  it("shows authoritative changes to an existing memory without stale contents", async () => {
    saved.album!.legacy = true;
    saved.album!.entries.push({ kind: "stars", at: Date.now() - 1000, source: "shared", score: 2 });
    await mount(); await open(3); await key("a"); expect(panel().textContent).toContain("接住了 2 颗");
    saved.album!.entries[2].score = 4; await refresh(); expect(panel().textContent).toContain("接住了 4 颗");
    expect(panel().querySelector("time")?.dateTime).toBe(new Date(saved.album!.entries[2].at).toISOString());
    expect(panel().textContent).toContain("来自已保存的真实经历");
  });
  it("distinguishes separate elapsed-day milestones, even after earlier records arrive", async () => {
    const at = Date.now() - 8 * 86400000;
    saved.createdAt = at; saved.hatchedAt = at; saved.album!.since = at;
    saved.album!.entries = [{ kind: "days", days: 7, at: at + 7 * 86400000, source: "elapsed" }];
    await mount(); await open(5); await key("a"); expect(panel().textContent).toContain("相识 7 天");
    saved.album!.entries.unshift({ kind: "days", days: 1, at: at + 86400000, source: "elapsed" });
    await refresh(); expect(panel().textContent).toContain("相识 7 天"); expect(panel().textContent).toContain("3 / 3");
    expect(panel().textContent).toContain("不代表连续登录");
    await key("a"); await key("b"); expect(panel().textContent).toContain("相识 1 天");
  });
  it("returns to the cover explicitly if the selected memory is absent, without retaining a ghost", async () => {
    await mount(); await open(); await key("a"); await key("a");
    saved.album!.entries.pop(); await refresh();
    expect(panel().dataset.albumKind).toBeUndefined(); expect(panel().textContent).toContain("同步时未找到刚才那条回忆");
    expect(panel().textContent).not.toContain("一份暖暖的小饭团");
    await refresh(); expect(panel().textContent).toContain("刚才那条回忆");
    await key("b"); expect(panel().dataset.albumKind).toBe("hatch");
    expect(panel().textContent).not.toContain("刚才那条回忆");
  });
  it("does not reuse reading position or a missing notice after leaving the category", async () => {
    await mount(); await open(); await key("a");
    saved.album!.entries = []; await refresh(); expect(panel().textContent).toContain("刚才那条回忆");
    await key("c"); await key("b"); expect(panel().textContent).not.toContain("刚才那条回忆");
    expect(panel().textContent).toContain("1 / 1");
    await key("c"); await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
    await open(); expect(panel().dataset.albumKind).toBeUndefined();
  });
  it.each([undefined, { since: 0, legacy: false, entries: [] }])("keeps an empty or old-server album read-only (%s)", async album => {
    saved.album = album; await mount(); await open(3); await key("a"); await key("b"); await refresh();
    expect(panel().textContent).toContain("1 / 1"); expect(panel().querySelector("time")).toBeNull();
    expect(panel().querySelector("button,a,input")).toBeNull();
    expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
  });

  it("does not carry a reading anchor across an authoritative same-pet import", async () => {
    await mount(); await open(); await key("a"); await key("a");
    generation = "b".repeat(32); saved.revision = 0;
    saved.album!.entries = [saved.album!.entries[0]];
    await refresh(); expect(document.querySelector(".content-home")).toBeTruthy();
    await open(); expect(panel().dataset.albumKind).toBeUndefined();
    expect(panel().textContent).toContain("1 / 2"); expect(panel().textContent).not.toContain("刚才那条回忆");
    await key("b"); expect(panel().dataset.albumKind).toBe("hatch");
  });
  it("stays on the explained cover if a missing memory later returns", async () => {
    await mount(); await open(2); await key("a"); const meal = saved.album!.entries.pop()!;
    await refresh(); expect(panel().textContent).toContain("刚才那条回忆");
    saved.album!.entries.push(meal); await refresh();
    expect(panel().dataset.albumKind).toBeUndefined(); expect(panel().textContent).toContain("刚才那条回忆");
    await key("a"); expect(panel().dataset.albumKind).toBe("meal"); expect(panel().textContent).not.toContain("刚才那条回忆");
  });

});

it("reaches saved scenery with only A/B/C and never resumes play or writes history", async () => {
  saved.schema = 13;
  saved.album!.entries.push({ kind: "scenery-walk-rain", at: Date.now(), source: "shared" });
  await mount(); await open(6);
  expect(panel().dataset.albumCategory).toBe("scenery");
  await key("b"); expect(panel().dataset.albumKind).toBe("scenery-walk-rain");
  expect(panel().textContent).toContain("来自真实发现时的虚构风景");
  await refresh(); expect(panel().dataset.albumKind).toBe("scenery-walk-rain");
  await key("c"); expect(document.querySelector('[data-album-directory="scenery"]')).toBeTruthy();
  await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
});
