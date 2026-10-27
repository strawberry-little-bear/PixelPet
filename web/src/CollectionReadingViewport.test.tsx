import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
type Kind = "fish" | "park";
let saved: PetState, generation: string | undefined;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(kind: Kind, paused = false, schema = 15) {
  const at = Date.now() - 3600000;
  saved = { schema, revision: 1, species: 2, name: "图鉴伙伴", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth() };
  if (paused) saved.game = { id: "0123456789abcdef0123456789abcdef", kind: kind === "fish" ? "fishing" : "walk", startedAt: at, round: 0, score: 0, lastBeat: -1,
    ...(kind === "fish" ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } }
      : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25, step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } }) };
  await act(async () => { render(<App />); });
}
async function open(kind: Kind, paused = false) {
  await key("a");
  if (!paused) for (let i = 0; i < (kind === "fish" ? 10 : 11); i++) await key("a");
  await key("b"); expect(document.querySelector(`.${kind}-album`)).toBeTruthy();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T03:00:00+08:00"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const height = this.matches("[data-collection-reading-start],.fishing-pause > strong,.walk-pause > strong") ? 80 : 0, top = -500;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const cases = (["fish", "park"] as const).flatMap(kind => [false, true].map(paused => ({ kind, paused })));
it.each(cases)("$kind paused=$paused explicit entry, all pages and C return preserve focus and the paused session", async ({ kind, paused }) => {
  await mount(kind, paused); const before = structuredClone(saved), preference = JSON.stringify(localStorage);
  expect(window.scrollBy).not.toHaveBeenCalled();
  const focus = document.querySelector<HTMLButtonElement>(".button-b")!; focus.focus();
  await open(kind, paused); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  const count = kind === "fish" ? 7 : 6;
  for (let n = 1; n <= count; n++) {
    expect(document.querySelectorAll(`.${kind}-album [data-collection-reading-start]`)).toHaveLength(1);
    await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(n + 1);
    expect(document.activeElement).toBe(focus);
  }
  if (kind === "fish") expect(document.querySelector(".fish-album-grid > div:first-child")?.getAttribute("aria-current")).toBe("true");
  else expect(document.querySelector(".park-album header")?.textContent).toContain("1 / 6");
  await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(window.scrollBy).toHaveBeenCalledTimes(count + 1);
  await key("c"); expect(document.querySelector(paused ? (kind === "fish" ? ".fishing-pause" : ".walk-pause") : ".home-caption")).toBeTruthy();
  expect(window.scrollBy).toHaveBeenCalledTimes(count + 1 + Number(paused));
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preference);
  before.revision = saved.revision; expect(saved).toEqual(before);
});
it.each(cases)("$kind paused=$paused visible headings are left alone", async ({ kind, paused }) => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => ({ top: 40, bottom: 120, left: 0, right: 200, width: 200, height: 80, x: 0, y: 40, toJSON: () => ({}) }));
  await mount(kind, paused); await open(kind, paused); await key("a"); await key("c"); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each(cases)("$kind paused=$paused hidden intent is not replayed on foreground", async ({ kind, paused }) => {
  await mount(kind, paused); Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await open(kind, paused); expect(window.scrollBy).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).not.toHaveBeenCalled(); await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});
it.each(cases)("$kind paused=$paused restore or failed-read recovery cannot replay old navigation", async ({ kind, paused }) => {
  await mount(kind, paused); await open(kind, paused); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  generation = "b".repeat(32); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await open(kind, paused); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  api.mockRejectedValueOnce(new Error("offline")); await refresh(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(2);
});
it.each(["fish", "park"] as const)("%s session replacement cannot replay its previous navigation", async kind => {
  await mount(kind, true); await open(kind, true); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  saved.game!.id = "1".repeat(32); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  expect(document.querySelector(kind === "fish" ? ".fishing-pause" : ".walk-pause")).toBeTruthy();
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await open(kind, true); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  await key("c"); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  expect(writes()).toHaveLength(0);
});
it.each(["fish", "park"] as const)("legacy %s without generation retains explicit-only reading", async kind => {
  await mount(kind, false, 14); generation = undefined; await refresh(); await open(kind);
  const count = 6; for (let n = 0; n < count; n++) await key("a");
  expect(window.scrollBy).toHaveBeenCalledTimes(count + 1); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(count + 1);
  if (kind === "fish") expect(document.querySelectorAll(".fish-album-grid > div")).toHaveLength(6);
  expect(writes()).toHaveLength(0);
});
