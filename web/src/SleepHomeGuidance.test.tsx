import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const guidance = () => screen.queryByLabelText("休息中的照顾提示");
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const now = Date.now();
  saved = { schema: 17, revision: 10, species: 2, name: "睡眠伙伴", createdAt: now - 7200000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: true, careCount: 0, logs: [],
    needs: { hunger: 80, clean: 80, energy: 40, mood: 80 }, growth: emptyGrowth() };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const stage of ["baby", "growing", "adult"] as const) {
  it.each([
    [{}, "不必急着叫醒"],
    [{ energy: 100 }, "体力已满"],
    [{ energy: 99.999 }, "不必急着叫醒"],
    [{ hunger: 10 }, "醒来后优先吃点东西"],
    [{ hunger: 20, clean: 10 }, "醒来后优先洗澡"],
    [{ hunger: 10, clean: 10 }, "醒来后优先吃点东西"],
  ] as const)(`${stage} shows saved sleep advice on home for %j`, async (needs, text) => {
    saved.growth = emptyGrowth(stage); Object.assign(saved.needs, needs);
    const before = structuredClone(saved); await mount();
    expect(guidance()?.textContent).toContain(text);
    expect(guidance()?.textContent).toContain("最近读取");
    expect(guidance()?.querySelector("button,a,input,[tabindex],[aria-live]")).toBeNull();
    expect(guidance()?.getAttribute("role")).toBeNull();
    expect(document.querySelector('.pet-scene[data-motion="sleeping"]')).toBeTruthy();
    expect(document.querySelector('.pet-scene')?.getAttribute("data-need")).toBe("none");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  });
}
it("updates with the accepted reading, never with a local clock or an older reply", async () => {
  saved.needs.energy = 99.999; await mount();
  const before = guidance()?.textContent;
  await act(async () => { vi.setSystemTime(Date.now() + 3600000); vi.advanceTimersByTime(1000); });
  expect(guidance()?.textContent).toBe(before);
  const stale = result(); stale.state.revision--; stale.state.needs.energy = 100;
  api.mockResolvedValueOnce(stale); await poll(); expect(guidance()?.textContent).toBe(before);
  saved.revision++; saved.needs.energy = 100; await poll();
  expect(guidance()?.textContent).toContain("体力已满");
  saved.revision++; saved.needs.clean = 5; await poll();
  expect(guidance()?.textContent).toContain("醒来后优先洗澡");
  expect(writes()).toHaveLength(0);
});
it("wake remains explicit; a rejected wake preserves guidance and confirmed wake removes it", async () => {
  saved.needs.hunger = 10; await mount();
  await key("a"); for (let i = 0; i < 3; i++) await key("a");
  expect(guidance()).toBeNull();
  api.mockRejectedValueOnce(new RequestFailure("暂时不能起床", "rejected"));
  await key("b"); await key("c");
  expect(guidance()?.textContent).toContain("醒来后优先吃点东西");
  await key("a"); for (let i = 0; i < 3; i++) await key("a");
  api.mockImplementation(async path => { if (path === "action") { saved.sleeping = false; saved.revision++; } return result(); });
  await key("b"); await key("c");
  expect(guidance()).toBeNull(); expect(saved.sleeping).toBe(false);
  expect(writes()).toHaveLength(2);
});
it("home advice stays visible while the confirmed bedtime feedback is showing", async () => {
  saved.sleeping = false; saved.needs.hunger = 10; await mount();
  expect(guidance()).toBeNull();
  await key("a"); for (let i = 0; i < 3; i++) await key("a");
  api.mockImplementation(async path => {
    if (path === "action") { saved.sleeping = true; saved.revision++; return { ...result(), careFeedback: { kind: "sleep", reason: "resting", points: 0, habitGain: 0 } }; }
    return result();
  });
  await key("b");
  expect(document.querySelector('.growth-feedback')?.getAttribute("data-feedback")).toBe("resting");
  expect(guidance()?.textContent).toContain("醒来后优先吃点东西"); expect(writes()).toHaveLength(1);
});
it("legacy sleep reads work without growth, and recovery hides actionable advice", async () => {
  delete saved.growth; saved.needs.clean = 10; await mount();
  expect(guidance()?.textContent).toContain("醒来后优先洗澡");
  api.mockRejectedValueOnce(new RequestFailure("离线", "unavailable")); await poll();
  expect(guidance()).toBeNull(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); expect(guidance()?.textContent).toContain("醒来后优先洗澡");
  expect(writes()).toHaveLength(0);
});

it("an accepted external wake removes guidance, and a later sleep restores current advice without replay", async () => {
  saved.needs.hunger = 10; await mount();
  const button = document.querySelector<HTMLButtonElement>(".button-c")!;
  button.focus();
  saved.sleeping = false; saved.revision++; await poll();
  expect(guidance()).toBeNull(); expect(document.activeElement).toBe(button);
  saved.sleeping = true; saved.needs.hunger = 80; saved.needs.clean = 10; saved.revision++; await poll();
  expect(guidance()?.textContent).toContain("醒来后优先洗澡");
  expect(document.activeElement).toBe(button); expect(writes()).toHaveLength(0);
});
