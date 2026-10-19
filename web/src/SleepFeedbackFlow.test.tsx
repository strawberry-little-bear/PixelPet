import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { CareRules, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, rules: CareRules | undefined;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", careRules: structuredClone(rules) });
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
const feedback = () => document.querySelector('.growth-feedback[data-feedback="resting"]')?.textContent!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function sleep() { await key("a"); for (let i = 0; i < 3; i++) await key("a"); await key("b"); }
async function mount() { await act(async () => { render(<App />); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); const now = Date.now();
  saved = { schema: 12, revision: 10, species: 2, name: "睡眠反馈", createdAt: now - 10000, hatchedAt: now - 9000,
    lastTick: now, sleeping: false, needs: { hunger: 60, mood: 80, clean: 70, energy: 40 }, careCount: 0, growth: emptyGrowth(), logs: [] };
  rules = { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 }, sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
    growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 } };
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "sleep") {
      saved.sleeping = !saved.sleeping; saved.revision++;
      return { ...result(), careFeedback: { kind: "sleep", reason: saved.sleeping ? "resting" : "awake", points: 0, habitGain: 0 } };
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("uses the confirmed response's coefficients, not the earlier menu or client defaults", async () => {
  await mount(); await key("a"); for (let i = 0; i < 3; i++) await key("a");
  expect(screen.getByLabelText("所选菜单说明").textContent).toContain("每恢复 28");
  rules!.growth!.restEnergyPerHabit = 20; rules!.growth!.restPointsPerHabit = .2;
  const growth = structuredClone(saved.growth), needs = structuredClone(saved.needs);
  await key("b"); expect(feedback()).toContain("每恢复 20"); expect(feedback()).toContain("成长 +0.2");
  expect(feedback()).not.toMatch(/28|0\.25/); expect(saved.growth).toEqual(growth); expect(saved.needs).toEqual(needs);
  expect(writes()).toHaveLength(1); expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
});
it("updates accepted metadata but rejects an older snapshot and its coefficients together", async () => {
  await mount(); await sleep(); const stale = result();
  rules!.growth!.restEnergyPerHabit = 20; rules!.growth!.restPointsPerHabit = .2; saved.revision++; await sync();
  expect(feedback()).toContain("每恢复 20");
  api.mockResolvedValueOnce(stale); await sync(); expect(feedback()).toContain("每恢复 20"); expect(feedback()).not.toMatch(/28|0\.25/);
  expect(writes()).toHaveLength(1);
});
it.each(["action", "poll"] as const)("does not retain numeric guidance when %s omits metadata", async when => {
  await mount(); if (when === "poll") { await sleep(); expect(feedback()).toContain("每恢复 28"); }
  rules = undefined;
  if (when === "action") await sleep(); else { saved.revision++; await sync(); }
  expect(feedback()).toContain("成长基准尚未读到"); expect(feedback()).not.toMatch(/28|0\.25/); expect(writes()).toHaveLength(1);
});
it("does not infer sleep growth from an age-derived legacy adult", async () => {
  saved.hatchedAt = Date.now() - 100 * 3600000; delete saved.growth;
  await mount(); await sleep(); expect(feedback()).toContain("成长记录尚未读到"); expect(feedback()).not.toMatch(/28|0\.25|成年|成长 \+/);
  expect(writes()).toHaveLength(1);
});
it("keeps adulthood and the saved appearance fixed after sleeping and polling", async () => {
  saved.growth = { ...emptyGrowth("adult"), points: 72, form: "gentle" }; await mount(); await sleep(); await sync();
  expect(feedback()).toContain("每恢复 28"); expect(feedback()).toContain("成年形态不变"); expect(feedback()).not.toContain("成长 +");
  expect(saved.growth).toMatchObject({ points: 72, form: "gentle" }); expect(writes()).toHaveLength(1);
});
it("clears failed-read feedback and B only reconciles, without replaying bedtime or its result", async () => {
  await mount(); await sleep(); api.mockRejectedValueOnce(new RequestFailure("断线", "unavailable")); await sync();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); expect(feedback()).toBeUndefined();
  await key("b"); expect(document.querySelector(".save-recovery")).toBeNull(); expect(feedback()).toBeUndefined();
  expect(saved.sleeping).toBe(true); expect(writes()).toHaveLength(1);
});
it("retains the shared explanation while covered, then expires it without a new write", async () => {
  await mount(); await sleep();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); await vi.advanceTimersByTimeAsync(9000); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^关闭$/ })); });
  expect(feedback()).toContain("每恢复 28");
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(feedback()).toBeUndefined(); expect(writes()).toHaveLength(1);
});
