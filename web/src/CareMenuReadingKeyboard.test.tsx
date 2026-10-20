import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const panel = () => screen.getByRole("region", { name: "照顾菜单阅读区" });
const choice = () => document.querySelector(".care-menu [aria-current=true] .menu-number")?.textContent;
async function key(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(e); }); return e;
}
async function open(sleeping = false) {
  saved.sleeping = sleeping;
  if (sleeping) saved.sleepSession = { startedAt: saved.lastTick - 60000, settledHours: 0, energyRecovered: 0, restGain: 0, growthPoints: 0 };
  await act(async () => { render(<App />); }); await key("a");
  if (sleeping) for (let i = 0; i < 3; i++) await key("a");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T07:00:00Z")); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 1, species: 2, name: "先读清再照顾", createdAt: Date.now() - 3600000,
    hatchedAt: Date.now() - 3500000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, growth: emptyGrowth(), careCount: 0, logs: [] };
  api.mockImplementation(async path => { if (path === "action") saved.revision++; return response(); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([false, true])("offers one named native reading stop without taking focus (sleeping=%s)", async sleeping => {
  await open(sleeping); const button = document.querySelector<HTMLElement>(".button-a")!; button.focus();
  const region = panel(); expect(region.tabIndex).toBe(0); expect(document.activeElement).toBe(button);
  expect(region.querySelector(".care-menu [aria-current=true]")).toBeTruthy();
  expect(region.querySelector(".care-preview")).toBeTruthy();
  expect(region.querySelectorAll("[data-care-reading-start]")).toHaveLength(1);
  const hint = document.getElementById(region.getAttribute("aria-describedby")!);
  expect(hint?.textContent).toContain("↑/↓ 或空格");
  expect(region.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it.each([false, true])("native/held/modified reading keys never select or execute care (sleeping=%s)", async sleeping => {
  await open(sleeping); const region = panel(), before = choice(); region.focus();
  for (const k of ["ArrowDown", "ArrowUp", " ", "PageDown", "PageUp", "Home", "End", "Tab", "Enter"]) {
    for (const init of [{}, { repeat: true }, { shiftKey: true }]) {
      expect((await key(k, region, init)).defaultPrevented).toBe(false);
      expect(choice()).toBe(before); expect(document.activeElement).toBe(region);
    }
  }
  expect(writes()).toHaveLength(0); expect(saved.sleeping).toBe(sleeping);
});
it("letters still select/return and an explicit B is still confirmation", async () => {
  await open(); const region = panel(); region.focus();
  await key("a", region); expect(choice()).toBe("02");
  await key("a", region); expect(choice()).toBe("03");
  expect(writes()).toHaveLength(0); await key("b", region);
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: "clean" });
});
it.each(["c", "Escape"])("%s returns home from reading without performing care", async k => {
  await open(true); const region = panel(); region.focus(); await key(k, region);
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it("ordinary sync keeps the reading node, focus and current wake-up option", async () => {
  await open(true); const region = panel(); region.focus();
  saved.revision++; saved.lastTick += 1000;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(17000); });
  expect(panel()).toBe(region); expect(document.activeElement).toBe(region); expect(choice()).toBe("04");
  expect(writes()).toHaveLength(0);
});
it("native activation on a focused physical A is not made into reading", async () => {
  await open(); const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  for (const k of ["Enter", " "]) {
    expect((await key(k, button)).defaultPrevented).toBe(true);
    expect((await key(k, button, { repeat: true })).defaultPrevented).toBe(true);
  }
  expect(choice()).toBe("03"); expect(document.activeElement).toBe(button); expect(writes()).toHaveLength(0);
});
it.each([" ", "Enter"])("%j on a focused physical B still confirms exactly once", async k => {
  await open(); const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
  expect((await key(k, button)).defaultPrevented).toBe(true);
  expect((await key(k, button, { repeat: true })).defaultPrevented).toBe(true);
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: "feed" });
});
