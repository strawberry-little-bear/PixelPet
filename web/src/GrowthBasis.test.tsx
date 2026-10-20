import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { GrowthPanel } from "./GrowthPanel";
import type { CareRules, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const growth = { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 };
const rules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12, growth };
const basis = () => document.querySelector('[aria-label="成长与照顾基准"]');
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

// Read the server rule book, not a local copy of its numeric defaults.
describe("growth basis handbook", () => {
  it.each(["baby", "growing"] as const)("explains %s integration and actual rest without promising a deadline", stage => {
    const g = emptyGrowth(stage), before = structuredClone(g);
    const { container } = render(<GrowthPanel growth={g} index={2} page={4} rules={rules} />);
    expect(basis()?.textContent).toContain("0.5 + 0.75 × 舒适比例");
    expect(basis()?.textContent).toContain("四项需求的平均值 ÷ 100");
    expect(basis()?.textContent).toContain("随状态变化累计");
    expect(basis()?.textContent).toContain("每实际恢复 28 点体力");
    expect(basis()?.textContent).toContain("1 点休息习惯、+0.25 成长点");
    expect(basis()?.textContent).toContain("不是到达下一阶段的时间预测");
    expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
    expect(g).toEqual(before);
  });
  it("takes all four numeric values from metadata rather than hardcoding the present rules", () => {
    render(<GrowthPanel growth={emptyGrowth()} index={2} page={4} rules={{ ...rules, growth: { basePerHour: .4, comfortPerHour: .6, restEnergyPerHabit: 20, restPointsPerHabit: .2 } }} />);
    expect(basis()?.textContent).toContain("0.4 + 0.6 × 舒适比例");
    expect(basis()?.textContent).toContain("每实际恢复 20 点体力");
    expect(basis()?.textContent).toContain("+0.2 成长点");
    expect(basis()?.textContent).not.toMatch(/0\.75|28|0\.25/);
  });
  it("explains adult habit-only rest without suggesting more growth or a new form", () => {
    const g = emptyGrowth("adult"); g.points = 72; g.form = "gentle";
    render(<GrowthPanel growth={g} index={2} page={4} rules={rules} />);
    expect(basis()?.textContent).toContain("成长已完成，不再增加成长点");
    expect(basis()?.textContent).toContain("每实际恢复 28 点体力");
    expect(basis()?.textContent).toContain("1 点休息习惯");
    expect(basis()?.textContent).not.toMatch(/0\.5|0\.75|\+0\.25/);
  });
  it("does not invent growth before hatching", () => {
    render(<GrowthPanel growth={emptyGrowth("egg")} index={2} page={4} rules={rules} />);
    expect(basis()?.textContent).toContain("孵化后才开始积累成长");
    expect(basis()?.textContent).not.toMatch(/0\.5|28|0\.25/);
  });
  it.each([undefined, null, {}, { ...growth, basePerHour: NaN }, { ...growth, comfortPerHour: Infinity },
    { ...growth, restEnergyPerHabit: 0 }, { ...growth, restPointsPerHabit: -1 }, { ...growth, basePerHour: "0.5" },
    { ...growth, comfortPerHour: 73 }, { ...growth, restEnergyPerHabit: 101 }, { ...growth, restPointsPerHabit: 73 },
    { ...growth, basePerHour: -1 }, { ...growth, comfortPerHour: -1 }, { ...growth, restPointsPerHabit: NaN },
  ])("falls back without guessed numbers for missing/malformed growth rules %#", invalid => {
    const metadata = { ...rules, growth: invalid } as unknown as CareRules;
    render(<GrowthPanel growth={emptyGrowth()} index={2} page={4} rules={metadata} />);
    expect(basis()?.textContent).toContain("成长基准尚未读到，暂不显示数字");
    expect(basis()?.textContent).not.toMatch(/0\.5|0\.75|28|0\.25/);
  });
  it.each([undefined, null])("supports a legacy rule book or standalone handbook %#", metadata => {
    render(<GrowthPanel growth={emptyGrowth()} index={2} page={4} rules={metadata} />);
    expect(basis()?.textContent).toContain("成长基准尚未读到");
  });
  it.each([0, 1, 2, 3, 5])("does not add the block to unrelated page %s", page => {
    render(<GrowthPanel growth={emptyGrowth()} index={2} page={page} rules={rules} />);
    expect(basis()).toBeNull();
  });
});

let saved: PetState, metadata: unknown;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", careRules: structuredClone(metadata) as CareRules });
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import", "recap/read"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
async function open() { await act(async () => { render(<App />); }); await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b"); for (let i = 0; i < 4; i++) await key("b"); }
describe("growth basis accepted snapshots and three-key navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers(); localStorage.clear(); api.mockReset(); metadata = rules;
    saved = { schema: 12, revision: 10, species: 2, name: "慢慢长大", createdAt: Date.now() - 2000, hatchedAt: Date.now() - 1000,
      lastTick: Date.now(), sleeping: false, careCount: 0, logs: [], growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 40 } };
    api.mockImplementation(async () => reply());
  });
  it("opens the existing fifth page with B, wraps forwards with B and returns with C, without a write", async () => {
    await open(); expect(basis()).toBeTruthy(); expect(document.querySelector(".growth-page-dots")?.textContent).toBe("5 / 6");
    await key("b"); expect(basis()).toBeNull(); await key("b"); expect(document.querySelector(".growth-page-dots")?.textContent).toBe("1 / 6");
    await key("c"); expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a,.lcd [role=button]")).toBeNull();
  });
  it("updates only accepted rule books, ignoring a stale response", async () => {
    await open(); const stale = reply(); stale.state.revision--; (stale.careRules as typeof rules).growth.basePerHour = 9;
    api.mockResolvedValueOnce(stale); await poll(); expect(basis()?.textContent).toContain("0.5 + 0.75");
    saved.revision++; metadata = { ...rules, growth: { ...growth, basePerHour: .4 } }; await poll();
    expect(basis()?.textContent).toContain("0.4 + 0.75"); expect(writes()).toHaveLength(0);
  });
  it.each([undefined, { ...rules, growth: undefined }, { ...rules, growth: { ...growth, restEnergyPerHabit: 0 } }])("does not retain earlier numeric rules after missing/invalid accepted metadata %#", async invalid => {
    await open(); expect(basis()?.textContent).toContain("0.5 + 0.75"); saved.revision++; metadata = invalid; await poll();
    expect(basis()?.textContent).toContain("成长基准尚未读到"); expect(basis()?.textContent).not.toContain("0.5 + 0.75"); expect(writes()).toHaveLength(0);
  });
  it("switches an open reading to adult habit-only rules when adulthood is accepted", async () => {
    await open(); expect(basis()?.textContent).toContain("0.5 + 0.75");
    saved.growth = emptyGrowth("adult"); saved.growth.points = 72; saved.growth.form = "balanced"; saved.growth.adultAt = Date.now(); saved.revision++;
    await poll(); expect(basis()?.textContent).toContain("成长已完成，不再增加成长点");
    expect(basis()?.textContent).toContain("每实际恢复 28 点体力"); expect(basis()?.textContent).not.toMatch(/0\.5|0\.75|\+0\.25/);
    expect(writes()).toHaveLength(0);
  });
  it("keeps valid need rates when optional growth metadata is malformed", async () => {
    metadata = { ...rules, growth: { ...growth, restEnergyPerHabit: 0 } }; await open();
    expect(basis()?.textContent).toContain("成长基准尚未读到"); await key("c"); await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b"); await key("a");
    expect(document.querySelector(".status-guide")?.textContent).toContain("−2.5 / 小时"); expect(writes()).toHaveLength(0);
  });
  it("clears the reading on failed reads and safely resumes with a legacy server", async () => {
    await open(); api.mockRejectedValueOnce(new Error("offline")); await poll(); expect(basis()).toBeNull();
    metadata = undefined; await key("b");
    expect(document.querySelector(".growth-page-dots")?.textContent).toBe("5 / 6");
    expect(basis()?.textContent).toContain("成长基准尚未读到"); expect(writes()).toHaveLength(0);
  });
});
