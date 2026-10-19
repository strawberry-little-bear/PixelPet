import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), id = "0123456789abcdef0123456789abcdef";
const kinds = ["tetris", "fishing", "walk"] as const;
type Kind = typeof kinds[number];
let saved: PetState, generation: string;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const guide = () => document.querySelector<HTMLElement>(".game-guide")!;
const pause = (kind: Kind) => document.querySelector(kind === "tetris" ? ".tetris-overlay" : kind === "fishing" ? ".fishing-pause" : ".walk-pause");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function open() { for (const k of ["a", "a", "a", "a", "b"]) await key(k); }
async function mount(kind: Kind, paused = true) {
  const at = Date.now() - 60000;
  saved = { schema: 14, revision: 1, species: 2, name: "暂停读规则", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
    game: { id, kind, startedAt: at, round: 0, score: 0, lastBeat: -1,
      ...(kind === "tetris" ? { tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4,5,6,7], lines: 0, pieces: 0, step: 4, paused, lastFallAt: Date.now() } }
      : kind === "fishing" ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused } }
      : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25, step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused } }) } };
  await act(async () => { render(<App />); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(kinds)("%s pause offers a read-only two-page guide and returns without starting or resuming", async kind => {
  await mount(kind); const before = structuredClone(saved);
  expect(pause(kind)?.textContent).toContain("玩法说明"); await open();
  expect(guide().dataset.guide).toBe(kind); expect(guide().textContent).toContain("本局玩法");
  expect(guide().textContent).not.toMatch(/B 开始|跳过说明/);
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("C 返回暂停");
  expect(guide().textContent).toContain("1 / 2"); await key("b"); expect(guide().textContent).toContain("2 / 2");
  await key("a"); expect(guide().textContent).toContain("1 / 2");
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
  await clock(17000); await key("c"); expect(pause(kind)).toBeTruthy(); await clock(17000);
  expect(writes()).toHaveLength(0); before.revision = saved.revision; expect(saved).toEqual(before);
  expect(localStorage.getItem(`pixelpet-guide-v1-${kind}`)).toBeNull();
});
it.each(kinds)("%s local-only pause remains read-only and requires deliberate C after returning", async kind => {
  await mount(kind, false); await open(); expect(guide().dataset.guide).toBe(kind);
  await key("b"); await clock(5000); await key("c"); await clock(5000); expect(writes()).toHaveLength(0);
  expect(pause(kind)).toBeTruthy(); await key("b"); expect(guide().textContent).toContain("1 / 2");
  await key("c"); await key("c");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: kind === "fishing" ? "fish-resume" : `${kind}-resume`, gameId: id, step: 4 });
});
it.each(kinds)("%s guide retains its page across same-session reads, help and background without writes", async kind => {
  await mount(kind); await open(); await key("b");
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); await clock(5000);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh(); await clock(15000);
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(guide().textContent).toContain("2 / 2"); await key("c"); await clock(15000);
  expect(pause(kind)).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s new session closes old instructions and resets its selection", async kind => {
  await mount(kind); await open(); await key("b"); saved.game!.id = "b".repeat(32); await refresh();
  expect(guide()).toBeNull(); expect(pause(kind)).toBeTruthy(); await open(); expect(guide().textContent).toContain("1 / 2");
  await key("c"); await clock(15000); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s terminal same-ID result closes instructions without finishing the game", async kind => {
  await mount(kind); await open();
  if (kind === "tetris") saved.game!.tetris!.end = "won";
  else if (kind === "fishing") saved.game!.fishing!.phase = "done";
  else saved.game!.walking!.beat = 72;
  await refresh(); expect(guide()).toBeNull(); expect(document.querySelector(".content-game")).toBeTruthy();
  await clock(15000); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s replacement save removes the old guide and return intent", async kind => {
  await mount(kind); await open(); generation = "b".repeat(32); saved.revision = 0; delete saved.game;
  await refresh(); expect(guide()).toBeNull(); expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s canceled import preview preserves instruction page and pause return", async kind => {
  await mount(kind); await open(); await key("b");
  const body = JSON.stringify(saved), file = new File([body], "temporary-save.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => body });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
  expect(document.querySelector(".import-preview")).toBeTruthy(); await key("c");
  expect(guide().textContent).toContain("2 / 2"); await key("c"); expect(pause(kind)).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s failed read recovers its read-only page and B cannot start a new game", async kind => {
  await mount(kind); await open(); api.mockRejectedValueOnce(new Error("offline")); await refresh();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); await key("b");
  expect(guide().dataset.guide).toBe(kind); await key("c"); expect(pause(kind)).toBeTruthy(); await clock(15000); expect(writes()).toHaveLength(0);
});

it.each(kinds.flatMap(kind => [true, false].map(offscreen => ({ kind, offscreen }))))(
  "$kind explicit guide navigation anchors only offscreen content ($offscreen)", async ({ kind, offscreen }) => {
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const menu = this.matches(".fishing-pause,.walk-pause,.tetris-overlay"), header = this.matches(".game-guide > header");
      const top = menu || header ? offscreen ? -500 : 40 : 0, height = menu ? 400 : header ? 100 : 0;
      return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
    });
    await mount(kind); expect(scroll).not.toHaveBeenCalled();
    const focus = document.querySelector<HTMLButtonElement>(".button-b")!; focus.focus();
    await open(); expect(scroll).toHaveBeenCalledTimes(offscreen ? 1 : 0); expect(document.activeElement).toBe(focus);
    await key("b"); expect(scroll).toHaveBeenCalledTimes(offscreen ? 2 : 0);
    await key("a"); expect(scroll).toHaveBeenCalledTimes(offscreen ? 3 : 0);
    await clock(17000); await refresh(); expect(scroll).toHaveBeenCalledTimes(offscreen ? 3 : 0);
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" })); await clock(5000);
    expect(scroll).toHaveBeenCalledTimes(offscreen ? 3 : 0);
    await key("c"); expect(pause(kind)).toBeTruthy(); expect(scroll).toHaveBeenCalledTimes(offscreen ? 4 : 0);
    await clock(17000); expect(scroll).toHaveBeenCalledTimes(offscreen ? 4 : 0);
    expect(writes()).toHaveLength(0);
  },
);
