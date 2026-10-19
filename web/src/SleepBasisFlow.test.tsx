import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { CareRules, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, rules: CareRules | undefined;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", careRules: structuredClone(rules) });
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
const preview = () => screen.getByLabelText("所选菜单说明").textContent!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount() { await act(async () => { render(<App />); }); await key("a"); for (let i = 0; i < 3; i++) await key("a"); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); const now = Date.now();
  saved = { schema: 12, revision: 10, species: 2, name: "睡眠基准", createdAt: now - 10000, hatchedAt: now - 9000, lastTick: now,
    sleeping: false, needs: { hunger: 60, mood: 80, clean: 70, energy: 40 }, careCount: 0, growth: emptyGrowth(), logs: [] };
  rules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
    growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 } };
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "sleep") { saved.sleeping = !saved.sleeping; saved.revision++; }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("selects and cancels with no write, and B alone confirms sleep once without instant growth", async () => {
  await mount(); expect(preview()).toContain("每恢复 28 体力"); expect(writes()).toHaveLength(0);
  await key("c"); expect(writes()).toHaveLength(0);
  await key("a"); for (let i = 0; i < 3; i++) await key("a");
  const growth = structuredClone(saved.growth), energy = saved.needs.energy;
  await key("b"); expect(saved.sleeping).toBe(true); expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: "sleep" }); expect(saved.growth).toEqual(growth); expect(saved.needs.energy).toBe(energy);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
});
it("updates accepted metadata and does not restore older numeric guidance", async () => {
  await mount(); const stale = result();
  rules!.growth!.restEnergyPerHabit = 20; rules!.growth!.restPointsPerHabit = .2; saved.revision++; await sync();
  expect(preview()).toContain("每恢复 20 体力"); expect(preview()).toContain("成长 +0.2；");
  api.mockResolvedValueOnce(stale); await sync(); expect(preview()).toContain("每恢复 20 体力"); expect(preview()).not.toContain("0.25");
  expect(writes()).toHaveLength(0);
});
it.each(["rules", "growth", "invalid"])("clears previous numbers when %s metadata is absent or invalid", async kind => {
  await mount(); expect(preview()).toContain("每恢复 28 体力");
  if (kind === "rules") rules = undefined;
  else if (kind === "growth") delete rules!.growth;
  else rules!.growth!.restEnergyPerHabit = 0;
  saved.revision++; await sync(); expect(preview()).toContain("成长基准尚未读到"); expect(preview()).not.toMatch(/28|0\.25|成长 \+/);
  expect(writes()).toHaveLength(0);
});
it("an accepted adult snapshot removes the growth reward but preserves habit and form explanations", async () => {
  await mount(); saved.growth = emptyGrowth("adult"); saved.growth.points = 72; saved.growth.form = "gentle"; saved.revision++; await sync();
  expect(preview()).toContain("每恢复 28 体力，休息习惯 +1"); expect(preview()).toContain("成年形态不变"); expect(preview()).not.toContain("成长 +");
  expect(saved.growth.form).toBe("gentle"); expect(writes()).toHaveLength(0);
});
it("an external sleep changes to wake guidance without automatically waking or awarding growth", async () => {
  await mount(); saved.sleeping = true; saved.revision++; await sync();
  expect(preview()).toContain("按 B 轻轻叫醒"); expect(preview()).not.toMatch(/28|0\.25|成长 \+/); expect(writes()).toHaveLength(0);
});
it("a failed read hides cached preview, then B reconciles by reading without sleeping", async () => {
  await mount(); api.mockRejectedValueOnce(new RequestFailure("断线", "unavailable")); await sync();
  expect(screen.queryByLabelText("所选菜单说明")).toBeNull();
  await key("b"); expect(preview()).toContain("每恢复 28 体力"); expect(writes()).toHaveLength(0); expect(saved.sleeping).toBe(false);
});
