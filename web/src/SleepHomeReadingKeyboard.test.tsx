import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const panel = () => screen.getByRole("region", { name: "休息中的照顾提示" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); }); return event;
}
async function mount() { await act(async () => { render(<App />); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T13:00:00Z")); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 10, species: 2, name: "安静读一读", createdAt: Date.now() - 7200000,
    hatchedAt: Date.now() - 3600000, lastTick: Date.now(), sleeping: true, careCount: 0, logs: [],
    needs: { hunger: 10, clean: 80, energy: 100, mood: 80 }, growth: emptyGrowth() };
  api.mockImplementation(async () => reply());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("offers a named native reading stop without adding a game control or taking focus", async () => {
  await mount(); const region = panel();
  expect(region.tabIndex).toBe(0);
  expect(document.activeElement).not.toBe(region);
  expect(document.getElementById(region.getAttribute("aria-describedby")!)?.textContent).toContain("Enter 不操作");
  expect(region.querySelectorAll("[tabindex],button,a,input,[role=button],[aria-live]")).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(writes()).toHaveLength(0);
});
it("native reading keys, held keys and Shift+Space never leave home or perform care", async () => {
  await mount(); const region = panel(); region.focus();
  for (const k of ["ArrowDown", "ArrowUp", " ", "PageDown", "PageUp", "Home", "End", "Enter", "Tab"]) {
    for (const init of [{}, { repeat: true }, { shiftKey: true }]) {
      expect((await key(k, region, init)).defaultPrevented).toBe(false);
      expect(document.querySelector(".content-home")).toBeTruthy(); expect(document.activeElement).toBe(region);
    }
  }
  expect(saved.sleeping).toBe(true); expect(writes()).toHaveLength(0);
});
it.each(["a", "b", "c"])("explicit %s still uses the original home control", async k => {
  await mount(); const region = panel(); region.focus(); await key(k, region);
  expect(document.querySelector(k === "c" ? ".content-home" : ".care-menu")).toBeTruthy();
  expect(writes()).toHaveLength(0); expect(saved.sleeping).toBe(true);
});
it("ordinary sync retains the same reading node and native focus", async () => {
  await mount(); const region = panel(); region.focus(); saved.revision++; saved.needs.hunger = 80;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(panel()).toBe(region); expect(document.activeElement).toBe(region); expect(region.textContent).toContain("体力已满");
  expect(writes()).toHaveLength(0);
});
it.each(["Enter", " "])("native %j on physical B still opens the menu exactly once", async k => {
  await mount(); const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
  expect((await key(k, button)).defaultPrevented).toBe(true);
  expect((await key(k, button, { repeat: true })).defaultPrevented).toBe(true);
  expect(document.querySelector('.care-menu [aria-current="true"] .menu-number')?.textContent).toBe("01"); expect(writes()).toHaveLength(0);
});
