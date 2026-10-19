import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap | undefined;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: "a".repeat(32), message: "", serverTime: Date.now(), returnRecap: structuredClone(recap), recapPending: false });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function review() { await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b"); }
const counter = () => document.querySelector('.return-panel header span')?.textContent;
const notice = () => document.querySelector('.return-sync-note')?.textContent;
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path));
function newRecap(id: string, hours: number): ReturnRecap {
  const snapshot = { needs: { ...saved.needs }, stage: "baby" as const, form: "" as const, points: 12, rest: 0, trackedHours: 1 };
  return { id, from: Date.now() - hours * 3600000, to: Date.now(), before: snapshot, after: { ...snapshot, points: 13, trackedHours: 2 } };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 10, species: 2, name: "读完再走", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  recap = newRecap("old", 1); api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("reading a newly synchronized return summary", () => {
  it.each([0, 1])("a new record on page %s starts at needs and explains the change", async page => {
    await mount(); await review(); if (page) await key("a");
    recap = newRecap("new", 2); saved.revision++; await sync();
    expect(counter()).toBe("1 / 2"); expect(notice()).toContain("已更新为最新回访记录");
    expect(document.querySelector('.return-panel')?.textContent).toContain("离开了 2 小时");
    expect(document.querySelector('.lcd-bottom')?.textContent).toContain("B 继续");
    await key("b"); expect(counter()).toBe("2 / 2"); expect(notice()).toContain("已更新为最新回访记录");
    await sync(); expect(counter()).toBe("2 / 2"); expect(notice()).toContain("已更新为最新回访记录");
    await key("b"); expect(document.querySelector('.content-home')).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it.each([0, 1])("a routine same-ID heartbeat preserves page %s without a replacement notice", async page => {
    await mount(); await review(); if (page) await key("a");
    for (let i = 0; i < 3; i++) { saved.revision++; saved.needs.hunger--; await sync(); }
    expect(counter()).toBe(`${page + 1} / 2`); expect(notice()).toBeUndefined(); expect(writes()).toHaveLength(0);
  });
  it("repeated new records reset each time; reentry starts clean, not with an old notice", async () => {
    await mount(); await review(); await key("a"); recap = newRecap("second", 2); await sync();
    await key("a"); recap = newRecap("third", 3); await sync(); expect(counter()).toBe("1 / 2");
    await key("c"); await review(); expect(counter()).toBe("1 / 2"); expect(notice()).toBeUndefined();
    expect(document.querySelector('.return-panel')?.textContent).toContain("离开了 3 小时"); expect(writes()).toHaveLength(0);
  });
  it("only announces replacement while reading, not when first opening the latest record", async () => {
    await mount(); recap = newRecap("new-at-home", 2); await sync(); await review();
    expect(counter()).toBe("1 / 2"); expect(notice()).toBeUndefined(); expect(writes()).toHaveLength(0);
  });
  it("a cleared recap returns home and a later record does not inherit the old reading intent", async () => {
    await mount(); await review(); await key("a"); recap = undefined; await sync(); expect(document.querySelector('.content-home')).toBeTruthy();
    recap = newRecap("after-clear", 3); await sync(); await review(); expect(counter()).toBe("1 / 2"); expect(notice()).toBeUndefined();
    expect(writes()).toHaveLength(0);
  });
  it("does not replace the record or position from a rejected stale read", async () => {
    await mount(); await review(); await key("a");
    const stale = { ...result(), state: { ...saved, revision: 1 }, returnRecap: newRecap("stale", 5) };
    api.mockResolvedValueOnce(stale); await sync(); expect(counter()).toBe("2 / 2"); expect(notice()).toBeUndefined();
    await key("a"); expect(document.querySelector('.return-panel')?.textContent).toContain("离开了 1 小时"); expect(writes()).toHaveLength(0);
  });
});
