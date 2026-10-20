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
const kinds = ["growth", "status"] as const;
const root = (kind: typeof kinds[number]) => document.querySelector<HTMLElement>(kind === "growth" ? ".growth-panel" : ".screen-status")!;
const current = (kind: typeof kinds[number]) => root(kind).getAttribute(`data-${kind}-page`);
async function key(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
async function open(kind: typeof kinds[number]) {
  await act(async () => { render(<App />); });
  await key("a"); for (let i = 0; i < (kind === "growth" ? 6 : 4); i++) await key("a");
  await key("b");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T06:00:00Z"));
  Object.defineProperty(document, "hidden", {configurable: true, value: false});
  localStorage.clear(); api.mockReset();
  saved = {schema:17, revision:1, species:2, name:"慢慢读懂成长", createdAt:Date.now()-3600000,
    hatchedAt:Date.now()-3600000, lastTick:Date.now(), sleeping:false,
    needs:{hunger:70,mood:80,clean:70,energy:80}, growth:emptyGrowth(), careCount:0, logs:[]};
  api.mockImplementation(async () => response());
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.useRealTimers();});

it.each(kinds)("%s exposes one named, read-only tab stop on every page, without taking focus", async kind => {
  await open(kind); const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  const pages = kind === "growth" ? 6 : 2;
  for (let n = 0; n < pages; n++) {
    const panel = root(kind), name = kind === "growth" ? "成长手册阅读区" : "状态说明阅读区";
    expect(screen.getByRole("region", {name})).toBe(panel);
    expect(panel.tabIndex).toBe(0); expect(document.activeElement).toBe(button);
    const hint = document.getElementById(panel.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("↑/↓ 或空格");
    expect(hint?.textContent).toContain("A/B/C");
    expect(panel.querySelectorAll("[data-care-reading-start]")).toHaveLength(1);
    expect(panel.querySelector("button,a,input,[role=button],[aria-live]")).toBeNull();
    expect(current(kind)).toBe(String(n)); await key("a");
  }
  expect(current(kind)).toBe("0"); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s lets native scrolling, held keys and Tab through only in its focused reading region", async kind => {
  await open(kind); const panel = root(kind); panel.focus();
  for (const read of ["ArrowDown", "ArrowUp", " ", "PageDown", "PageUp", "Home", "End", "Tab"]) {
    for (const init of [{}, {repeat:true}, {shiftKey:true}]) {
      expect((await key(read, panel, init)).defaultPrevented).toBe(false);
      expect(current(kind)).toBe("0"); expect(document.activeElement).toBe(panel);
    }
  }
  // Native defaults themselves are checked in Chrome, not simulated by jsdom.
  expect(writes()).toHaveLength(0);
  expect((await key("ArrowDown")).defaultPrevented).toBe(true);
  expect(current(kind)).toBe("1");
});
it.each(kinds)("%s retains letter controls and Escape while reading, without adding an action", async kind => {
  await open(kind); const panel = root(kind); panel.focus();
  expect((await key("a", panel)).defaultPrevented).toBe(true); expect(current(kind)).toBe("1");
  expect(document.activeElement).toBe(panel);
  expect((await key("b", panel)).defaultPrevented).toBe(true);
  if (kind === "growth") {
    expect(current(kind)).toBe("2"); expect(document.activeElement).toBe(panel);
    await key("Escape", panel);
  }
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s preserves reading focus and page across ordinary syncs", async kind => {
  await open(kind); const panel = root(kind); panel.focus(); await key("a", panel);
  saved.revision++; saved.needs.hunger=69;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(17000); });
  expect(root(kind)).toBe(panel); expect(document.activeElement).toBe(panel); expect(current(kind)).toBe("1");
  expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s does not turn Space on a focused physical A into scrolling", async kind => {
  await open(kind); const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  expect((await key(" ", button)).defaultPrevented).toBe(true); expect(current(kind)).toBe("1");
  expect(document.activeElement).toBe(button);
  expect((await key(" ", button, {repeat:true})).defaultPrevented).toBe(true); expect(current(kind)).toBe("1");
  expect(writes()).toHaveLength(0);
});
