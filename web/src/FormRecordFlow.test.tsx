import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { AdultForm, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.parse("2026-10-19T02:00:00Z");
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const panel = () => document.querySelector('.growth-panel')!;
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function open() { await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b"); await key("b"); await key("b"); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
function adult(form: AdultForm = "lively") {
  const g = emptyGrowth("adult"); g.points = 72; g.form = form; g.adultAt = at - 3600000;
  g.trackedHours = 40; g.wellbeing = 32; g.care.play = 99; g.care.clean = 40; g.care.rest = 40;
  g.formRecord = { trackedHours: 12, wellbeing: form === "easygoing" ? 2.4 : 9.6, nutrition: 1,
    play: form === "lively" ? 8 : 2, clean: form === "gentle" ? 4 : 2, rest: form === "gentle" ? 4 : 2 };
  return g;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  saved = { schema: 12, revision: 1, species: 2, name: "成长伙伴", createdAt: at - 80 * 3600000, hatchedAt: at - 80 * 3600000,
    lastTick: at, sleeping: false, needs: { hunger: 80, clean: 80, energy: 80, mood: 80 }, careCount: 1, growth: adult(), logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("saved adult evidence through A/B/C", () => {
  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("reads %s without changing the pet or replaying evolution", async form => {
    saved.growth = adult(form); const before = structuredClone(saved);
    await mount(); await open();
    expect(panel().textContent).toContain("定型时 · 形态依据");
    expect(panel().querySelector('[data-selected="true"]')?.getAttribute('data-rule-form')).toBe(form);
    await poll(); await key("c");
    expect(document.querySelector('.growth-celebration')).toBeNull();
    await open(); expect(panel().textContent).toContain("定型时保存的记录");
    expect(document.querySelectorAll('.physical-button')).toHaveLength(3);
    expect(document.querySelector('.lcd button,.lcd a,.lcd input')).toBeNull();
    expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  });
  it("syncs a real new adulthood on this page, but rejects a stale snapshot without evidence", async () => {
    saved.growth = emptyGrowth("growing"); saved.growth.points = 71.9;
    await mount(); await open(); const stale = result();
    saved.revision++; saved.growth = adult(); await poll();
    expect(panel().textContent).toContain("定型时 · 形态依据");
    api.mockResolvedValueOnce(stale); await poll();
    expect(panel().textContent).toContain("定型时陪玩 8.0");
    expect(panel().getAttribute('data-growth-page')).toBe("2"); expect(writes()).toHaveLength(0);
  });
  it("later care does not rewrite the saved evidence during polling", async () => {
    await mount(); await open(); const original = panel().textContent;
    saved.revision++; saved.growth!.care.play++; saved.growth!.trackedHours++; await poll();
    expect(panel().textContent).toBe(original); expect(writes()).toHaveLength(0);
  });
  it("refresh preserves the stored record without celebrating old adulthood", async () => {
    await mount(); await open(); const original = panel().textContent;
    cleanup(); await mount(); expect(document.querySelector('.growth-celebration')).toBeNull();
    await open(); expect(panel().textContent).toBe(original); expect(writes()).toHaveLength(0);
  });
  it("old-service or migrated adults use an explicit unknown-history fallback", async () => {
    saved.schema = 11; delete saved.growth!.formRecord;
    await mount(); await open(); expect(panel().textContent).toContain("未保存定型时的依据");
    expect(panel().querySelector('time')).toBeNull(); expect(writes()).toHaveLength(0);
  });
});


describe("unrounded condition reading through three keys", () => {
  it("updates current conditions on a fresh poll without another action or stage celebration", async () => {
    const g = emptyGrowth("growing"); g.points = 40; g.trackedHours = 12; g.wellbeing = 12 * .44999;
    saved.growth = g;
    await mount(); await open();
    expect(panel().querySelector('[data-rule-form="easygoing"]')?.textContent).toContain("满足 · 首项");
    const stale = result();
    saved.revision++; saved.growth!.wellbeing = 12 * .45001; await poll();
    expect(panel().textContent).toContain("平均舒适约 45%");
    expect(panel().querySelector('[data-rule-form="easygoing"]')?.textContent).toContain("未满足");
    expect(panel().querySelector('[data-rule-form="balanced"]')?.textContent).toContain("满足 · 首项");
    api.mockResolvedValueOnce(stale); await poll();
    expect(panel().querySelector('[data-rule-form="easygoing"]')?.textContent).toContain("未满足");
    await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".growth-celebration")).toBeNull(); expect(writes()).toHaveLength(0);
  });
});
