import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap, pending: boolean;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), returnRecap: structuredClone(recap), recapPending: pending });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function review() { await key("b"); for (let i=0;i<7;i++) await key("a"); await key("b"); }
const counter = () => document.querySelector(".return-panel header span")?.textContent;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); pending = false;
  saved = { schema: 11, revision: 1, species: 2, name: "回访伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth(),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 12, rest: 0, trackedHours: 1 };
  recap = { id: "last-absence", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: { ...snapshot, points: 13, trackedHours: 2 } };
  api.mockImplementation(async path => {
    if (path === "recap/read") { pending = false; return { ...result(), recapClaimed: true }; }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("return summary two-page navigation", () => {
  it.each([false, true])("A cycles only the two existing pages (automatic=%s)", async automatic => {
    pending = automatic; await mount(); if (!automatic) await review();
    for (let i=0;i<8;i++) {
      expect(counter()).toBe(`${i%2+1} / 2`);
      await key("a");
    }
    expect(counter()).toBe("1 / 2");
    expect(api.mock.calls.filter(([p]) => p === "recap/read")).toHaveLength(automatic ? 1 : 0);
    expect(api.mock.calls.filter(([p]) => ["action","import","reset"].includes(p))).toHaveLength(0);
  });

  it("B continues to page two then returns home, without acknowledging twice", async () => {
    pending = true; await mount(); expect(counter()).toBe("1 / 2");
    await key("b"); expect(counter()).toBe("2 / 2");
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 回小窝");
    await key("b"); expect(document.querySelector(".content-home")).toBeTruthy();
    await review(); expect(counter()).toBe("1 / 2");
    expect(api.mock.calls.filter(([p]) => p === "recap/read")).toHaveLength(1);
  });

  it.each([0, 1])("C leaves page %s without changing or clearing the stored recap", async page => {
    await mount(); await review(); if (page) await key("a");
    const original = structuredClone(recap); await key("c");
    expect(document.querySelector(".content-home")).toBeTruthy();
    await review(); expect(counter()).toBe("1 / 2"); expect(recap).toEqual(original);
    expect(api.mock.calls.filter(([p]) => p === "recap/read")).toHaveLength(0);
  });
});

it("keeps historical sleeping endpoints through A/B/C reading and a live poll", async () => {
  recap.before.sleeping = true; recap.after.sleeping = true;
  await mount(); await review();
  const context = () => document.querySelector('[aria-label="历史睡眠状态"]')?.textContent;
  const history = context();
  expect(history).toContain("离开时：睡眠结算结束时：睡眠");
  expect(saved.sleeping).toBe(false);
  saved.needs.energy = 60; saved.revision++;
  await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
  expect(context()).toBe(history);
  await key("a"); expect(counter()).toBe("2 / 2"); expect(context()).toBe(history);
  await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
  await review(); expect(context()).toBe(history);
  await key("b"); await key("b"); expect(document.querySelector(".content-home")).toBeTruthy();
  expect(api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p))).toHaveLength(0);
});
