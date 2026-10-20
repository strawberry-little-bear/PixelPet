import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const note = () => document.querySelector(".habit-precision-note");
const row = (label: string) => [...document.querySelectorAll(".habit-rows > div")].find(el => el.querySelector("span")?.textContent === label)?.querySelector("b")?.textContent;
const tiny = [Number.MIN_VALUE, 1e-9, .001, .02, .049999];
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("nonzero habit totals remain visible", () => {
  it.each(tiny)("shows a tiny saved rest total %s without rounding it to zero", rest => {
    const g = emptyGrowth(); g.care.rest = rest; const before = structuredClone(g);
    render(<GrowthPanel growth={g} index={2} page={1} />);
    expect(row("有效休息")).toBe("<0.1");
    expect(row("适时喂食")).toBe("0.0");
    expect(note()?.textContent).toContain("不是没有记录");
    expect(g).toEqual(before);
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it.each([[0, "0.0"], [.05, "0.1"], [.099, "0.1"], [.1, "0.1"], [2, "2.0"], [999999.5, "999999.5"]])("preserves ordinary one-decimal formatting for %s", (value, text) => {
    const g = emptyGrowth(); g.care.rest = Number(value);
    render(<GrowthPanel growth={g} index={2} page={1} />);
    expect(row("有效休息")).toBe(text); expect(note()).toBeNull();
  });
  it.each(["nutrition", "play", "clean", "rest"] as const)("does not erase a fractional %s habit from an accepted save", habit => {
    const g = emptyGrowth(); g.care[habit] = .02;
    render(<GrowthPanel growth={g} index={2} page={1} />);
    expect([...document.querySelectorAll(".habit-rows b")].map(el => el.textContent).filter(text => text === "<0.1")).toHaveLength(1);
    expect(note()).toBeTruthy();
  });
  it.each(["baby", "growing", "adult"] as const)("keeps raw form predicates and the %s stage", stage => {
    const g = emptyGrowth(stage); if (stage === "adult") { g.form = "gentle"; g.points = 72; }
    g.care.rest = .02; g.care.play = 1.99999; const before = structuredClone(g);
    const { rerender } = render(<GrowthPanel growth={g} index={2} page={1} />);
    expect(row("一起玩耍")).toBe("2.0"); expect(row("有效休息")).toBe("<0.1");
    rerender(<GrowthPanel growth={g} index={2} page={2} />);
    expect(document.querySelector(".form-guide-record")?.textContent).toContain("恬静分 <0.1");
    expect(document.querySelector('[data-rule-form="lively"]')?.getAttribute("data-condition-met")).toBe("false");
    expect(document.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe(stage === "adult" ? "gentle" : "balanced");
    expect(g).toEqual(before);
  });
  it("keeps tiny play visible in the provisional form evidence", () => {
    const g = emptyGrowth(); g.care.play = .02;
    render(<GrowthPanel growth={g} index={2} page={2} />);
    expect(document.querySelector(".form-guide-record")?.textContent).toContain("当前陪玩 <0.1 · 恬静分 0.0");
    expect(note()).toBeTruthy();
  });
  it("formats frozen decision-time values without substituting later habits", () => {
    const g = emptyGrowth("adult"); g.form = "balanced"; g.points = 72; g.adultAt = Date.now();
    g.care = { ...g.care, nutrition: 10, play: 99, clean: 90, rest: 90 };
    g.formRecord = { trackedHours: 12, wellbeing: 9.6, nutrition: .02, play: .02, clean: .02, rest: .02 };
    const before = structuredClone(g), { rerender } = render(<GrowthPanel growth={g} index={2} page={2} />);
    expect(document.querySelector(".form-guide-record")?.textContent).toBe("定型时陪玩 <0.1 · 恬静分 <0.1");
    expect(document.querySelector(".form-record-care")?.textContent).toBe("当时喂食 <0.1 · 清洁 <0.1 · 休息 <0.1");
    expect(note()).toBeTruthy(); expect(g).toEqual(before);
    rerender(<GrowthPanel growth={g} index={2} page={1} />);
    expect(row("有效休息")).toBe("90.0"); expect(note()).toBeNull();
  });
  it("only mentions tiny values actually visible on the current page", () => {
    const g = emptyGrowth(); g.care.nutrition = .02;
    const { rerender } = render(<GrowthPanel growth={g} index={2} page={2} />);
    expect(note()).toBeNull();
    rerender(<GrowthPanel growth={g} index={2} page={1} />); expect(note()).toBeTruthy();
    for (const page of [0, 3, 4, 5]) { rerender(<GrowthPanel growth={g} index={2} page={page} />); expect(note()).toBeNull(); }
  });
});

let saved: PetState;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b"); await key("b"); }
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
describe("habit precision follows accepted snapshots, not the reading clock", () => {
  beforeEach(() => {
    vi.useFakeTimers(); localStorage.clear(); api.mockReset();
    saved = { schema: 12, revision: 10, species: 2, name: "一点点休息", createdAt: Date.now() - 2000, hatchedAt: Date.now() - 1000,
      lastTick: Date.now(), sleeping: true, careCount: 0, logs: [], growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 40 } };
    api.mockImplementation(async () => reply());
  });
  it("reveals saved rest after a poll, then only removes the note when a larger total is accepted", async () => {
    await mount(); expect(row("有效休息")).toBe("0.0"); expect(note()).toBeNull();
    saved.revision++; saved.growth!.care.rest = .02;
    await poll(); expect(row("有效休息")).toBe("<0.1"); expect(note()).toBeTruthy();
    await poll(); expect(row("有效休息")).toBe("<0.1");
    saved.revision++; saved.growth!.care.rest = .2;
    await poll(); expect(row("有效休息")).toBe("0.2"); expect(note()).toBeNull();
    expect(saved.careCount).toBe(0);
    expect(api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path))).toHaveLength(0);
  });
  it("ignores an older zero-valued response and keeps ordinary A/B/C navigation", async () => {
    saved.growth!.care.rest = .02; await mount(); expect(row("有效休息")).toBe("<0.1");
    const old = reply(); old.state.revision--; old.state.growth!.care.rest = 0;
    api.mockResolvedValueOnce(old); await poll(); expect(row("有效休息")).toBe("<0.1");
    await key("b"); expect(document.querySelector(".growth-page-dots")?.textContent).toBe("3 / 6");
    expect(document.querySelector(".form-guide-record")?.textContent).toContain("恬静分 <0.1");
    await key("b"); expect(document.querySelector(".growth-page-dots")?.textContent).toBe("4 / 6"); expect(note()).toBeNull();
    await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
    expect(api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path))).toHaveLength(0);
  });
});
