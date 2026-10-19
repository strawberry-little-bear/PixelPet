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
const guide = () => screen.getByLabelText("照顾与成长入门").textContent!;
async function open() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); }); }
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
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

it("uses current accepted rules and ignores an older snapshot with a different limit", async () => {
  await mount(); const stale = result(); await open(); expect(guide()).toContain("单次最多 12 小时");
  rules!.maxOfflineHours = 6; saved.revision++; await sync(); expect(guide()).toContain("单次最多 6 小时");
  api.mockResolvedValueOnce(stale); await sync(); expect(guide()).toContain("单次最多 6 小时"); expect(guide()).not.toContain("12 小时"); expect(writes()).toHaveLength(0);
});
it.each([undefined, { maxOfflineHours: 0 }] as const)("drops old numeric limits when accepted metadata disappears or becomes invalid: %j", async value => {
  await mount(); await open(); expect(guide()).toContain("单次最多 12 小时");
  rules = value as CareRules | undefined; saved.revision++; await sync();
  expect(guide()).toContain("单次结算上限尚未读到"); expect(guide()).not.toMatch(/12|单次最多/); expect(writes()).toHaveLength(0);
});
it("reconciles after a failed read without writing or keeping the old cap", async () => {
  await mount(); api.mockRejectedValueOnce(new RequestFailure("断线", "unavailable")); await sync();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); rules = undefined; saved.revision++;
  await key("b"); await open(); expect(guide()).toContain("单次结算上限尚未读到"); expect(writes()).toHaveLength(0);
});
it.each(["egg", "legacy", "adult"])("offers general guidance without inventing current progress for %s", async profile => {
  if (profile === "egg") { saved.hatchedAt = 0; delete saved.growth; }
  if (profile === "legacy") { saved.hatchedAt = Date.now() - 100 * 3600000; delete saved.growth; }
  if (profile === "adult") saved.growth = { ...emptyGrowth("adult"), points: 72, form: "gentle" };
  await mount(); const before = structuredClone(saved); await open();
  expect(guide()).toContain("幼年 → 成长期 → 成年"); expect(guide()).not.toMatch(/当前.*成年|还需.*小时/);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,.help-care button,.help-care a")).toBeNull();
  await key("a"); await key("b"); await key("c"); expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); }); expect(screen.queryByRole("dialog")).toBeNull();
});
