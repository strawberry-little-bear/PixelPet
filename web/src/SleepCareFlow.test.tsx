import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.parse("2026-10-19T02:00:00Z");
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const advice = () => screen.getByLabelText("照顾建议").textContent;
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 1, species: 2, name: "休息伙伴", createdAt: at - 10000, hatchedAt: at - 9000,
    lastTick: at, sleeping: true, needs: { hunger: 10, clean: 5, energy: 100, mood: 80 },
    careCount: 0, growth: emptyGrowth(), logs: [] };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const kind = (body as { kind: string }).kind;
      saved.revision++;
      if (kind === "sleep") saved.sleeping = !saved.sleeping;
      if (kind === "clean") { saved.needs.clean += 35; saved.careCount++; }
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sleep guidance through the existing three-key flow", () => {
  it.each(["baby", "growing", "adult"] as const)("%s can read, wake and care without automatic writes", async stage => {
    saved.growth = emptyGrowth(stage);
    saved.growth.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 4;
    if (stage === "adult") saved.growth.form = "gentle";
    const growth = structuredClone(saved.growth);
    await mount(); await menu(4);
    expect(advice()).toContain("体力已满；醒来后优先洗澡"); expect(writes()).toHaveLength(0);
    await key("a"); await key("a"); await key("a"); expect(advice()).toContain("先从菜单选「起床啦」");
    await key("c"); await menu(3); await key("c");
    expect(saved.sleeping).toBe(false); expect(saved.careCount).toBe(0);
    await menu(4); expect(advice()).toContain("现在适合洗澡");
    await key("c"); await menu(2); await key("c");
    await menu(4); expect(advice()).toContain("现在适合吃点东西");
    expect(writes().map(([, b]) => (b as { kind: string }).kind)).toEqual(["sleep", "clean"]);
    expect(saved.careCount).toBe(1); expect(saved.growth).toEqual(growth);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  });
  describe.each(["baby", "growing", "adult"] as const)("%s menu destinations", stage => {
    it.each([
      ["hunger", "吃点东西", 0], ["clean", "洗个澡澡", 2],
      ["energy", "睡个好觉", 3], ["mood", "一起玩耍", 1],
    ] as const)("matches low %s advice to the actual selection", async (need, label, index) => {
      saved.sleeping = false; saved.growth = emptyGrowth(stage);
      saved.needs = { hunger: 80, clean: 80, energy: 80, mood: 80 };
      saved.needs[need] = 10;
      await mount(); await menu(4);
      expect(advice()).toContain(`从菜单选「${label}」`);
      await key("c"); await key("a");
      for (let i = 0; i < index; i++) await key("a");
      expect(document.querySelector(".care-item.selected")?.textContent).toContain(label);
      expect(writes()).toHaveLength(0);
    });
    it("keeps the full-energy sleep caveat visible before any action", async () => {
      saved.sleeping = false; saved.growth = emptyGrowth(stage);
      await mount(); await key("a");
      for (let i = 0; i < 3; i++) await key("a");
      expect(document.querySelector(".care-item.selected")?.textContent).toContain("睡个好觉");
      expect(screen.getByLabelText("所选菜单说明").textContent).toContain("饱食和清洁仍会下降");
      expect(writes()).toHaveLength(0);
    });
  });
  it("ignores an older reading and updates only after an accepted newer snapshot", async () => {
    saved.needs = { hunger: 80, clean: 80, energy: 99.999, mood: 10 };
    await mount(); await menu(4); expect(advice()).toContain("不必急着叫醒");
    const stale = result(); stale.state.revision--; stale.state.needs.energy = 100;
    api.mockResolvedValueOnce(stale); await poll(); expect(advice()).toContain("不必急着叫醒");
    saved.revision++; saved.needs.energy = 100; await poll(); expect(advice()).toContain("体力已满");
    expect(writes()).toHaveLength(0);
  });
  it("does not infer full recovery from a local clock tick", async () => {
    saved.needs = { hunger: 80, clean: 80, energy: 99.999, mood: 10 };
    await mount(); await menu(4); const original = advice();
    await act(async () => { vi.setSystemTime(at + 3600000); vi.advanceTimersByTime(1000); });
    expect(advice()).toBe(original); expect(writes()).toHaveLength(0);
  });
  it("a rejected wake cannot present the pet as awake or remove the sleeping advice", async () => {
    await mount(); await menu(4); await key("c");
    api.mockRejectedValueOnce(new RequestFailure("暂时不能起床", "rejected"));
    await menu(3); await key("c"); await menu(4);
    expect(saved.sleeping).toBe(true); expect(advice()).toContain("醒来后优先洗澡");
    expect(writes()).toHaveLength(1);
  });
  it("an external wake replaces the resting instructions without replaying it", async () => {
    await mount(); await menu(4); saved.sleeping = false; saved.revision++; await poll();
    expect(advice()).toContain("现在适合洗澡"); expect(advice()).not.toContain("起床啦");
    expect(writes()).toHaveLength(0);
  });
});
