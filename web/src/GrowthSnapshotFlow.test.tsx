import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { CareRules, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, metadata: CareRules | undefined;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", careRules: structuredClone(metadata) });
const text = () => screen.getByLabelText("此刻状态与成长").textContent!;
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function open() { await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b"); }
async function mount() { await act(async () => { render(<App />); }); await open(); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); const now = Date.now();
  saved = { schema: 12, revision: 10, species: 2, name: "此刻成长", createdAt: now - 10000, hatchedAt: now - 9000, lastTick: now,
    sleeping: false, needs: { hunger: 20, mood: 40, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth(), logs: [] };
  metadata = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
    growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 } };
  api.mockImplementation(async () => reply());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("opens on the existing first page, cycles six pages and exits with no gameplay writes", async () => {
  await mount(); expect(text()).toContain("50.0%"); expect(document.querySelector(".growth-page-dots")?.textContent).toBe("1 / 6");
  await key("a"); expect(screen.queryByLabelText("此刻状态与成长")).toBeNull();
  for (let i = 0; i < 5; i++) await key("b"); expect(text()).toContain("0.88 点/小时");
  await key("c"); expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});
it("updates from accepted needs and basis, never from local elapsed time", async () => {
  await mount(); const before = text(); await act(async () => { vi.advanceTimersByTime(10000); }); expect(text()).toBe(before);
  saved.revision++; saved.needs.hunger = 60; metadata!.growth!.basePerHour = .2; metadata!.growth!.comfortPerHour = .4;
  await poll(); expect(text()).toContain("60.0%"); expect(text()).toContain("0.44 点/小时"); expect(writes()).toHaveLength(0);
});
it("ignores a stale response's needs and growth metadata together", async () => {
  await mount(); const stale = reply(); stale.state.revision--; stale.state.needs.hunger = 100; stale.careRules!.growth!.basePerHour = 20;
  api.mockResolvedValueOnce(stale); await poll(); expect(text()).toContain("50.0%"); expect(text()).toContain("0.88 点/小时"); expect(writes()).toHaveLength(0);
});
it("does not retain a prior numeric reference after metadata disappears", async () => {
  await mount(); saved.revision++; saved.needs.energy = 100; metadata = undefined;
  await poll(); expect(text()).toContain("55.0%"); expect(text()).toContain("成长基准尚未读到"); expect(text()).not.toContain("点/小时"); expect(writes()).toHaveLength(0);
});
it("does not use the age-based legacy stage fallback to invent a growth reference", async () => {
  delete saved.growth; await mount(); expect(text()).toContain("50.0%"); expect(text()).toContain("成长记录尚未读到"); expect(text()).not.toContain("点/小时");
});
it("keeps an adult's comfort meaningful without claiming further growth", async () => {
  saved.growth = { ...emptyGrowth("adult"), points: 72, form: "gentle" }; await mount();
  expect(text()).toContain("成年不再增加成长点"); expect(text()).not.toContain("点/小时"); expect(saved.growth.form).toBe("gentle"); expect(writes()).toHaveLength(0);
});
it("reflects a confirmed care response's needs without awarding anything for reading", async () => {
  await mount(); expect(text()).toContain("50.0%"); await key("c");
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "feed") {
      saved.needs = { hunger: 40, mood: 43, clean: 57, energy: 80 }; saved.revision++; saved.careCount++;
    }
    return reply();
  });
  await key("a"); await key("b");
  await act(async () => { vi.advanceTimersByTime(10000); }); await open();
  expect(text()).toContain("55.0%"); expect(text()).toContain("0.91 点/小时");
  expect(writes()).toHaveLength(1); expect(saved.careCount).toBe(1);
});
it("hides obsolete readings during a connection failure and B only rechecks", async () => {
  await mount(); api.mockRejectedValueOnce(new Error("offline")); await poll();
  expect(screen.queryByLabelText("此刻状态与成长")).toBeNull(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  saved.revision++; saved.needs.hunger = 60; await key("b");
  expect(text()).toContain("60.0%"); expect(text()).toContain("0.95 点/小时"); expect(writes()).toHaveLength(0);
});
