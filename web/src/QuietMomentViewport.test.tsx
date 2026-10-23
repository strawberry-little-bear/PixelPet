import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function enter() { await key("a"); for (let n = 0; n < 12; n++) await key("a"); await key("b"); }
function targetRect(top: number) {
  return { top, bottom: top + 140, left: 20, right: 220, width: 200, height: 140, x: 20, y: top, toJSON: () => ({}) };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "阅读伙伴", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 60, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
    album: { since: at, legacy: false, entries: [{ kind: "meal", at: at + 1000, source: "shared" }] } };
  generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return this.matches(".quiet-moment-copy") ? targetRect(-500) : { ...targetRect(0), width: 0, height: 0 };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([false, true])("locates entry, A selection and B response without moving focus or writing (sleeping=%s)", async sleeping => {
  saved.sleeping = sleeping;
  const before = structuredClone(saved);
  await mount(); const button = document.querySelector<HTMLButtonElement>(".button-b")!; button.focus();
  await enter(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  expect(document.querySelector(".quiet-moment-copy")?.textContent).toContain(sleeping ? "晚安" : "一份暖暖的小饭团");
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(5);
  expect(document.activeElement).toBe(button);
  await key("c"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(5);
  before.revision = saved.revision; expect(saved).toEqual(before);
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
it("does not move an already visible response", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => targetRect(40));
  await mount(); await enter(); await key("a"); await key("b"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("ordinary reads, sleep/wake and timers preserve the reader's location", async () => {
  await mount(); await enter(); await key("a"); await key("a"); await key("b");
  expect(window.scrollBy).toHaveBeenCalledTimes(4);
  for (const sleeping of [false, true, true, false]) { saved.sleeping = sleeping; await refresh(); }
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  expect(window.scrollBy).toHaveBeenCalledTimes(4);
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(5);
});
it("closing help or recovering a failed read does not replay a previous reply location", async () => {
  await mount(); await enter(); await key("b");
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
});
it("consumes a hidden navigation rather than jumping on foregrounding", async () => {
  await mount(); await enter();
  Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
});
it("does not carry a location into a replacement save", async () => {
  await mount(); await enter(); await key("b");
  generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await enter(); expect(window.scrollBy).toHaveBeenCalledTimes(3);
});
it("supports old saves without growth, memories or a server generation", async () => {
  saved.schema = 1; delete saved.growth; delete saved.album;
  api.mockImplementation(async () => ({ ...response(), saveGeneration: undefined }));
  await mount(); await enter(); await key("a"); await key("a"); await key("b");
  expect(window.scrollBy).toHaveBeenCalledTimes(4);
  expect(document.querySelector(".quiet-moment-copy")?.textContent).toContain("你好呀");
  const reading = screen.getByRole("region", { name: "无目的互动阅读区" }); reading.focus();
  await act(async () => { fireEvent.keyDown(reading, { key: "Enter" }); });
  expect(window.scrollBy).toHaveBeenCalledTimes(4); expect(document.activeElement).toBe(reading);
});

it("keeps the reading hint stable until a physical tap activates, then focuses and acts once", async () => {
  await mount(); await enter();
  const reading = screen.getByRole("region", { name: "无目的互动阅读区" }); reading.focus();
  const button = document.querySelector<HTMLButtonElement>(".button-a")!;
  const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  fireEvent(button, down);
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(reading);
  expect(document.querySelector(".quiet-moment-copy > strong")?.textContent).toBe("摸摸它");
  expect(window.scrollBy).toHaveBeenCalledTimes(1);
  const focus = vi.spyOn(button, "focus");
  fireEvent.click(button);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(document.activeElement).toBe(button);
  expect(document.querySelector(".quiet-moment-copy > strong")?.textContent).toBe("陪它发呆");
  expect(window.scrollBy).toHaveBeenCalledTimes(2);
  const ordinaryDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  fireEvent(button, ordinaryDown); expect(ordinaryDown.defaultPrevented).toBe(false);
  reading.focus();
  const secondaryDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 2 });
  fireEvent(button, secondaryDown); expect(secondaryDown.defaultPrevented).toBe(false);
  fireEvent.pointerCancel(button);
  expect(document.activeElement).toBe(reading);
  expect(window.scrollBy).toHaveBeenCalledTimes(2);
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
