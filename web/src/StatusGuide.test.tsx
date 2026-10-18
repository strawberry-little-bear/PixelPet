import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { StatusGuide, statusPageCount, validCareRules } from "./StatusGuide";
import type { CareRules, GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const rules: CareRules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12 };
function pet(stage: GrowthStage = "baby"): PetState {
  return { schema: 11, revision: 10, species: 2, name: "时间伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth(stage),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("optional care rule metadata", () => {
  it.each([undefined, null, false, [], {}, 12, "rules", { ...rules, maxOfflineHours: 0 }, { ...rules, maxOfflineHours: -1 },
    { ...rules, maxOfflineHours: Infinity }, { ...rules, maxOfflineHours: NaN }, { ...rules, maxOfflineHours: "12" },
    { ...rules, awake: null }, { ...rules, sleeping: {} }, { ...rules, awake: { ...rules.awake, clean: undefined } },
    { ...rules, sleeping: { ...rules.sleeping, mood: "0" } }, { ...rules, awake: { ...rules.awake, energy: Infinity } },
    { ...rules, sleeping: { ...rules.sleeping, hunger: NaN } }])("rejects incomplete/nonfinite metadata %#", value => {
    expect(validCareRules(value)).toBe(false);
  });
  it("accepts finite non-default rules without mutation", () => {
    const custom = { awake: { hunger: -1.25, mood: 0, clean: -4, energy: 3 }, sleeping: rules.sleeping, maxOfflineHours: 7.5 };
    const original = structuredClone(custom);
    expect(validCareRules(custom)).toBe(true);
    const { container } = render(<StatusGuide pet={pet()} rules={custom} />);
    expect(container.textContent).toContain("−1.25 / 小时");
    expect(container.textContent).toContain("+3 / 小时");
    expect(container.textContent).toContain("最多 7.5 小时");
    expect(custom).toEqual(original);
  });
});

describe("read-only time guide", () => {
  it.each(["baby", "growing", "adult"] as const)("describes both modes without mutating %s", stage => {
    const p = pet(stage), original = structuredClone(p);
    const view = render(<StatusGuide pet={p} rules={rules} />);
    expect(view.container.textContent).toContain("清醒中");
    expect(view.container.querySelector('[data-need="energy"]')?.textContent).toContain("−2 / 小时");
    p.sleeping = true;
    view.rerender(<StatusGuide pet={p} rules={rules} />);
    expect(view.container.textContent).toContain("正在睡觉");
    expect(view.container.querySelector('[data-need="energy"]')?.textContent).toContain("+14 / 小时");
    expect(view.container.querySelector('[data-need="mood"]')?.textContent).toContain("不因时间流逝变化");
    expect(view.container.textContent).toContain(stage === "adult" ? "成年形态已固定" : "保持舒适有助成长");
    expect(view.container.textContent).toContain("不是一小时后的预测");
    expect(view.container.textContent).toContain("到 0 / 100 为止");
    expect(view.container.querySelector("button,a,input,[tabindex],[aria-live]")).toBeNull();
    p.sleeping = false; expect(p).toEqual(original);
  });
  it("renders a legacy fallback with no invented rate or cap", () => {
    const { container } = render(<StatusGuide pet={pet()} rules={null} />);
    expect(container.textContent).toContain("详细速率尚未读到");
    expect(container.textContent).not.toMatch(/12|14|2\.5/);
    expect(container.querySelector("dl")).toBeNull();
  });
});

let saved: PetState, metadata: unknown;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", careRules: structuredClone(metadata) as CareRules });
const guide = () => document.querySelector(".status-guide");
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import", "recap/read"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function openStatus() { await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b"); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); saved = pet(); metadata = rules;
  api.mockImplementation(async () => result());
});
describe("status guide three-key navigation and accepted snapshots", () => {
  it.each(["b", "c"])("A cycles two pages; %s returns; reopening resets", async exit => {
    await mount(); await openStatus(); expect(statusPageCount).toBe(2);
    expect(document.querySelector(".status-page-number")?.textContent).toBe("1 / 2");
    expect(guide()).toBeNull(); await key("a"); expect(guide()).toBeTruthy();
    expect(document.querySelector(".status-page-number")?.textContent).toBe("2 / 2");
    expect(document.querySelector(".lcd-top")?.textContent).toContain("MY STATUS");
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("A 换页");
    await key("a"); expect(guide()).toBeNull(); await key("a"); await key(exit);
    expect(document.querySelector(".content-home")).toBeTruthy(); await openStatus(); expect(guide()).toBeNull();
    expect(writes()).toHaveLength(0); expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
  });
  it.each([undefined, { ...rules, maxOfflineHours: 0 }, { ...rules, awake: {} }])("clears previously known rates on accepted missing/invalid metadata %#", async invalid => {
    await mount(); await openStatus(); await key("a"); expect(guide()?.textContent).toContain("−2.5 / 小时");
    metadata = invalid; saved.revision++; await poll();
    expect(guide()?.textContent).toContain("详细速率尚未读到"); expect(guide()?.textContent).not.toContain("−2.5 / 小时");
    await key("a"); expect(document.querySelector(".status-page-number")?.textContent).toBe("1 / 2"); expect(writes()).toHaveLength(0);
  });
  it("updates rules and mode only when a snapshot is accepted", async () => {
    await mount(); await openStatus(); await key("a");
    const stale = result(); stale.state.revision--; stale.state.sleeping = true;
    stale.careRules = { ...rules, maxOfflineHours: 5 }; api.mockResolvedValueOnce(stale); await poll();
    expect(guide()?.textContent).toContain("清醒中"); expect(guide()?.textContent).toContain("最多 12 小时");
    saved.sleeping = true; saved.revision++; metadata = { ...rules, sleeping: { ...rules.sleeping, energy: 7 }, maxOfflineHours: 6 };
    await poll(); expect(guide()?.textContent).toContain("正在睡觉"); expect(guide()?.textContent).toContain("+7 / 小时");
    expect(guide()?.textContent).toContain("最多 6 小时"); expect(writes()).toHaveLength(0);
  });
  it("does not predict changes using the local clock", async () => {
    await mount(); await openStatus(); const readings = document.querySelector(".content-status")?.textContent;
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(document.querySelector(".content-status")?.textContent).toBe(readings);
    await key("a"); const text = guide()?.textContent;
    await act(async () => { vi.advanceTimersByTime(3600000); }); expect(guide()?.textContent).toBe(text);
    expect(saved.needs.energy).toBe(80); expect(writes()).toHaveLength(0);
  });
  it("does not keep displaying cached rules as fresh after a failed read", async () => {
    await mount(); await openStatus(); await key("a"); api.mockRejectedValueOnce(new Error("offline")); await poll();
    expect(guide()).toBeNull(); expect(document.querySelector(".save-recovery")?.textContent).toContain("暂时未连接"); expect(writes()).toHaveLength(0);
  });
  it("an old server still supports readings and the fallback page", async () => {
    metadata = undefined; await mount(); await openStatus();
    expect(document.querySelector(".content-status")?.textContent).toContain("收到过 0 次温柔照顾");
    await key("a"); expect(guide()?.textContent).toContain("详细速率尚未读到"); expect(writes()).toHaveLength(0);
  });
});
