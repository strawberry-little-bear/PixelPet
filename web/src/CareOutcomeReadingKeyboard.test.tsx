import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { CareOutcome } from "./CareOutcome";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { CareFeedback, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.parse("2026-10-20T08:00:00Z");
let saved: PetState, feedback: CareFeedback;
const response = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const reading = () => screen.getByRole("region", { name: "照顾结果阅读区" });
async function key(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); }); return event;
}
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
async function care(kind: "feed" | "clean" | "wake" = "feed") {
  if (kind === "wake") saved.sleeping = true;
  feedback = { kind: kind === "wake" ? "sleep" : kind, reason: kind === "wake" ? "awake" : "credited",
    points: kind === "wake" ? 0 : .25, habitGain: kind === "wake" ? 0 : 1,
    ...(kind !== "wake" ? { habit: kind === "feed" ? "nutrition" as const : "clean" as const } : {}),
    effect: { at, before: structuredClone(saved.needs), after: { ...saved.needs, ...(kind === "feed" ? { hunger: 80 } : kind === "clean" ? { clean: 95 } : {}) } },
    ...(kind === "wake" ? { sleepSummary: { startedAt: at - 3600000, wokeAt: at,
      settledHours: 1, energyRecovered: 20, restGain: 1, growthPoints: .1 } } : {}),
  };
  await act(async () => { render(<App />); });
  document.querySelector<HTMLButtonElement>(".button-c")!.focus();
  await menu(kind === "feed" ? 0 : kind === "clean" ? 2 : 3); await key("c");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 1, species: 2, name: "照顾后慢慢读", createdAt: at - 2 * 3600000,
    hatchedAt: at - 2 * 3600000 + 1000, lastTick: at, sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, growth: emptyGrowth(), careCount: 0, logs: [] };
  api.mockImplementation(async path => {
    if (path === "action") {
      saved.revision++; if (feedback.kind === "sleep") saved.sleeping = false; else saved.careCount++;
      saved.needs = structuredClone(feedback.effect!.after);
      return { ...response(), careFeedback: structuredClone(feedback) };
    }
    return response();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["feed", "clean", "wake"] as const)("offers a native result-reading stop only after acknowledged %s, without moving focus", async kind => {
  await care(kind); const button = document.querySelector<HTMLButtonElement>(".button-c")!;
  const region = reading(); expect(region.tabIndex).toBe(0); expect(document.activeElement).toBe(button);
  expect(region.querySelector(".care-outcome")).toBeTruthy();
  expect(document.getElementById(region.getAttribute("aria-describedby")!)?.textContent).toContain("Enter 不操作");
  expect(region.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(writes()).toHaveLength(1);
  if (kind === "wake") expect(region.querySelector(".sleep-summary")).toBeTruthy();
});
it.each(["feed", "clean", "wake"] as const)("native reading and held keys preserve the %s receipt without opening care or writing", async kind => {
  await care(kind); const region = reading(), text = region.querySelector(".care-outcome")!.textContent; region.focus();
  for (const k of ["ArrowDown", "ArrowUp", " ", "PageDown", "PageUp", "Home", "End", "Tab", "Enter"]) {
    for (const init of [{}, { repeat: true }, { shiftKey: true }]) {
      expect((await key(k, region, init)).defaultPrevented).toBe(false);
      expect(document.querySelector(".home-caption")).toBeTruthy(); expect(document.activeElement).toBe(region);
    }
  }
  expect(region.querySelector(".care-outcome")!.textContent).toBe(text); expect(writes()).toHaveLength(1);
});
it("toast expiry and ordinary current-state reads keep the reading node, focus and historical receipt", async () => {
  await care(); const region = reading(), text = region.textContent; region.focus();
  saved.needs.hunger = 30; saved.lastTick += 17000; saved.revision++;
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); window.dispatchEvent(new Event("focus")); });
  expect(reading()).toBe(region); expect(document.activeElement).toBe(region); expect(region.textContent).toBe(text);
  expect(document.querySelector("[data-feedback=idle]")).toBeTruthy(); expect(writes()).toHaveLength(1);
});
it("explicit A/B/C keep home and menu behavior; only an explicit menu B performs new care", async () => {
  await care(); const region = reading(); region.focus();
  await key("a", region); expect(document.querySelector(".care-menu")).toBeTruthy();
  await key("c"); expect(reading()).toBeTruthy(); reading().focus();
  await key("b", reading()); expect(document.querySelector(".care-menu")).toBeTruthy(); expect(writes()).toHaveLength(1);
  await key("b"); expect(writes()).toHaveLength(2);
});
it("status keeps its existing single reading stop and an unchanged receipt body", async () => {
  await care("wake"); const text = reading().querySelector(".care-outcome")!.textContent;
  await menu(4); expect(screen.queryByRole("region", { name: "照顾结果阅读区" })).toBeNull();
  const status = screen.getByRole("region", { name: "状态说明阅读区" });
  expect(status.querySelectorAll("[tabindex='0']")).toHaveLength(0);
  expect(status.querySelector(".care-outcome")!.textContent).toBe(text); expect(writes()).toHaveLength(1);
});
it.each(["Enter", " "])("%j on a physical B remains native activation rather than receipt reading", async k => {
  await care(); const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
  expect((await key(k, button)).defaultPrevented).toBe(true);
  expect((await key(k, button, { repeat: true })).defaultPrevented).toBe(true);
  expect(document.querySelector(".care-menu")).toBeTruthy(); expect(writes()).toHaveLength(1);
});
it("does not create an empty reading stop before care or for an old receipt without an effect", async () => {
  await act(async () => { render(<App />); }); expect(screen.queryByRole("region", { name: "照顾结果阅读区" })).toBeNull();
  cleanup(); render(<CareOutcome feedback={{ kind: "feed", reason: "credited", points: .25, habitGain: 1 }} readable />);
  expect(screen.queryByRole("region", { name: "照顾结果阅读区" })).toBeNull();
});

it.each(["feed", "clean", "wake"] as const)("C dismisses the acknowledged %s receipt from its reading stop without changing the save", async kind => {
  await care(kind);
  const region = reading(), before = structuredClone(saved);
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("C 收起回执");
  region.focus();
  await key("c", region);
  expect(screen.queryByRole("region", { name: "照顾结果阅读区" })).toBeNull();
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(document.querySelector("[data-feedback=idle]")).toBeTruthy();
  expect(document.activeElement).toBe(document.querySelector(".button-c"));
  expect(document.querySelector(".lcd-bottom")?.textContent).not.toContain("收起");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await menu(4);
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(saved).toEqual(before); expect(writes()).toHaveLength(1);
});

it("returning from status keeps the receipt until a separate C on home", async () => {
  await care(); await menu(4); await key("c");
  expect(reading()).toBeTruthy();
  await key("c");
  expect(screen.queryByRole("region", { name: "照顾结果阅读区" })).toBeNull();
  await menu(4); expect(document.querySelector(".care-outcome")).toBeNull();
  expect(writes()).toHaveLength(1);
});

it("C skips the action clip first, then dismisses its receipt, and a later care creates a new one", async () => {
  await care();
  feedback = { ...feedback, kind: "clean", habit: "clean" };
  await menu(2);
  expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("bathing");
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("C 跳过");
  await key("c"); expect(reading()).toBeTruthy();
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("C 收起回执");
  await key("c"); expect(document.querySelector(".care-outcome")).toBeNull();
  feedback = { ...feedback, kind: "feed", habit: "nutrition" };
  await menu(0); await key("c"); expect(reading()).toBeTruthy();
  expect(writes()).toHaveLength(3);
});
