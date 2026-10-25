import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const cases = [
  { kind: "fish", schema: 14, count: 6 },
  { kind: "fish", schema: 18, count: 7 },
  { kind: "fish", schema: 23, count: 8 },
  { kind: "park", schema: 23, count: 6 },
].flatMap(test => [false, true].map(paused => ({ ...test, paused })));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(kind: string, schema: number, paused: boolean) {
  const at = Date.now() - 3600000;
  saved = { schema, revision: 1, species: 2, name: "图鉴伙伴", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth() };
  if (paused) saved.game = { id: "0123456789abcdef0123456789abcdef", kind: kind === "fish" ? "fishing" : "walk", startedAt: at, round: 0, score: 0, lastBeat: -1,
    ...(kind === "fish" ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } }
      : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25, step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } }) };
  await act(async () => { render(<App />); });
  await key("a");
  if (!paused) for (let i = 0; i < (kind === "fish" ? 10 : 11); i++) await key("a");
  await key("b");
}
const index = (kind: string) => kind === "fish"
  ? Array.from(document.querySelectorAll(".fish-album-grid > div")).findIndex(el => el.getAttribute("aria-current") === "true")
  : Number(document.querySelector(".park-album header span")!.textContent!.match(/ · (\d+) \/ 6/)![1]) - 1;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T03:00:00+08:00")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  api.mockReset(); api.mockImplementation(async () => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", saveGeneration: "a".repeat(32) }) as Result);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(cases)("$kind schema=$schema paused=$paused: A reverses and B advances with wrap, without writes", async ({ kind, schema, count, paused }) => {
  await mount(kind, schema, paused); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
  expect(index(kind)).toBe(0);
  const status = document.querySelector(`[data-selection-status="${kind}-album"]`)!;
  const checkStatus = (page: number) => {
    expect(document.querySelector(`[data-selection-status="${kind}-album"]`)).toBe(status);
    expect(status.textContent).toContain(`第 ${page + 1} / ${count} 页`);
    expect(status.textContent).toContain(`C 返回${paused ? "暂停菜单" : "小窝"}`);
  };
  checkStatus(0);
  expect(document.querySelector(`.${kind}-album`)?.textContent).toContain("A 上一页 · B 下一页");
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("A 上一页  B 下一页");
  await key("a"); expect(index(kind)).toBe(count - 1); checkStatus(count - 1);
  await key("b"); expect(index(kind)).toBe(0); checkStatus(0);
  for (let i = 1; i <= count; i++) { await key("b"); expect(index(kind)).toBe(i % count); checkStatus(i % count); }
  for (let i = 1; i <= count; i++) { await key("a"); expect(index(kind)).toBe((count - i) % count); checkStatus((count - i) % count); }
  await key("c");
  expect(document.querySelector(`[data-selection-status="${kind}-album"]`)).toBeNull();
  expect(document.querySelector(paused ? (kind === "fish" ? ".fishing-pause" : ".walk-pause") : ".home-caption")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  expect(saved).toEqual(before); expect(JSON.stringify(localStorage)).toBe(preferences);
  expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelectorAll(".lcd button,.lcd a,.lcd input")).toHaveLength(0);
});
it.each(cases)("$kind schema=$schema paused=$paused: reverse navigation survives sync and physical A click only turns once", async ({ kind, schema, count, paused }) => {
  await mount(kind, schema, paused);
  await key("a"); expect(index(kind)).toBe(count - 1);
  await refresh(); expect(index(kind)).toBe(count - 1);
  const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  await act(async () => { fireEvent.click(button); }); expect(index(kind)).toBe(count - 2);
  expect(document.activeElement).toBe(button);
  await key("b"); expect(index(kind)).toBe(count - 1);
  expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
});
