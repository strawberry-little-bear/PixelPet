import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const id = "0123456789abcdef0123456789abcdef";
const kinds = ["fishing", "walk"] as const;
let saved: PetState, generation: string;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const panel = () => document.querySelector<HTMLElement>('.album-panel')!;
const pause = (kind: typeof kinds[number]) => document.querySelector(kind === "walk" ? ".walk-pause" : ".fishing-pause");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(kind: typeof kinds[number]) {
  const at = Date.now() - 60000;
  saved = { schema: 13, revision: 1, species: 2, name: "手记伙伴", createdAt: at, hatchedAt: at, lastTick: Date.now(),
    sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
    album: { since: at, legacy: false, entries: [{ kind: "hatch", at, source: "shared" },
      { kind: "scenery-fishing-clear", at: at + 1000, source: "shared" }, { kind: "scenery-walk-rain", at: at + 2000, source: "shared" }] },
    game: { id, kind, startedAt: at + 3000, round: 0, score: 0, lastBeat: -1,
      ...(kind === "fishing" ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000, elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } }
        : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25, step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } }) } };
  await act(async () => { render(<App />); });
}
async function open() { for (const k of ["a", "a", "a", "b"]) await key(k); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  generation = "a".repeat(32); api.mockReset(); api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(kinds)("opens saved scenery from %s pause using only three keys, and C returns paused", async kind => {
  await mount(kind); const before = structuredClone(saved);
  expect(pause(kind)?.textContent).toContain("风景手记");
  await open(); expect(panel().dataset.albumCategory).toBe("scenery");
  expect(document.querySelector('.lcd-bottom')?.textContent).toContain("C 返回暂停");
  await key("b"); expect(panel().dataset.albumKind).toBe("scenery-fishing-clear");
  await key("a"); expect(panel().dataset.albumKind).toBeUndefined();
  await key("a"); expect(panel().dataset.albumKind).toBe("scenery-walk-rain");
  await key("b"); expect(panel().dataset.albumKind).toBeUndefined();
  await key("a"); expect(panel().dataset.albumKind).toBe("scenery-walk-rain");
  await clock(17000); await refresh(); expect(panel().dataset.albumKind).toBe("scenery-walk-rain");
  expect(panel().querySelector("button,a,input")).toBeNull();
  await key("c"); expect(pause(kind)).toBeTruthy(); expect(panel()).toBeNull();
  await clock(17000); expect(writes()).toHaveLength(0);
  // Only refresh changes the fixture revision; browsing does not touch gameplay.
  before.revision = saved.revision; expect(saved).toEqual(before);
  await key("b"); expect(panel().dataset.albumCategory).toBe("scenery");
  expect(panel().dataset.albumKind).toBeUndefined();
});
it.each(kinds)("%s reading survives help and background without granting foreground play", async kind => {
  await mount(kind); await open(); await key("b");
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); await clock(5000);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh(); await clock(15000);
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(panel().dataset.albumKind).toBe("scenery-fishing-clear"); await key("c"); await clock(15000);
  expect(pause(kind)).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s shortcut preserves empty/old-server explanations without creating history", async kind => {
  await mount(kind); saved.schema = 12; saved.album!.entries = []; await refresh(); await open();
  expect(panel().textContent).toContain("还没有留下风景手记"); expect(panel().textContent).toContain("请更新服务");
  await key("a"); await key("b"); expect(panel().querySelector("time")).toBeNull();
  await key("c"); expect(pause(kind)).toBeTruthy(); expect(saved.album!.entries).toEqual([]); expect(writes()).toHaveLength(0);
});
it.each(kinds)("%s shortcut retains identity-based reconciliation when the selected memory disappears", async kind => {
  await mount(kind); await open(); await key("b"); saved.album!.entries.splice(1, 1); await refresh();
  expect(panel().dataset.albumKind).toBeUndefined(); expect(panel().textContent).toContain("同步时未找到");
  await key("c"); expect(pause(kind)).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("a new %s session invalidates the old reading and return intent", async kind => {
  await mount(kind); await open(); await key("b"); saved.game!.id = "b".repeat(32); await refresh();
  expect(panel()).toBeNull(); expect(pause(kind)).toBeTruthy(); await clock(16000); expect(writes()).toHaveLength(0);
  await open(); expect(panel().dataset.albumKind).toBeUndefined();
});
it.each(kinds)("same-pet import while reading %s clears the old return intent", async kind => {
  await mount(kind); await open(); generation = "b".repeat(32); saved.revision = 0; delete saved.game; await refresh();
  expect(document.querySelector(".content-home")).toBeTruthy();
  for (const k of ["a", ...Array(8).fill("a"), "b", ...Array(6).fill("a"), "b"]) await key(k);
  expect(panel().dataset.albumCategory).toBe("scenery"); await key("c");
  expect(document.querySelector('.album-directory')).toBeTruthy(); await key("c");
  expect(document.querySelector('.content-home')).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("canceling a backup preview preserves the %s return-to-pause route", async kind => {
  await mount(kind); await open(); await key("b");
  const body = JSON.stringify(saved), file = new File([body], "test-only.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => body });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
  expect(document.querySelector('.import-preview')).toBeTruthy(); await key("c");
  expect(panel().dataset.albumKind).toBe("scenery-fishing-clear");
  expect(document.querySelector('.lcd-bottom')?.textContent).toContain("C 返回暂停");
  await key("c"); expect(pause(kind)).toBeTruthy(); await clock(17000); expect(writes()).toHaveLength(0);
});
it.each(kinds)("reloading during %s reading returns to the saved game paused, without replaying a discovery", async kind => {
  await mount(kind); await open(); await key("b"); const entries = structuredClone(saved.album!.entries);
  cleanup(); await act(async () => { render(<App />); }); await clock(17000);
  expect(panel()).toBeNull(); expect(pause(kind)).toBeTruthy(); expect(saved.album!.entries).toEqual(entries);
  expect(writes()).toHaveLength(0); await open(); expect(panel().dataset.albumKind).toBeUndefined();
});
it.each(kinds)("returning from %s reading still requires an explicit resume command", async kind => {
  await mount(kind); await open(); await key("c"); await clock(17000); expect(writes()).toHaveLength(0);
  await key("c"); expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: kind === "fishing" ? "fish-resume" : "walk-resume", gameId: id, step: 4 });
});
it.each(kinds)("external completion during %s reading routes to the result without auto-collecting", async kind => {
  await mount(kind); await open();
  if (kind === "fishing") saved.game!.fishing!.phase = "done";
  else saved.game!.walking!.beat = 72;
  await refresh(); expect(panel()).toBeNull(); expect(document.querySelector('.content-game')).toBeTruthy();
  await clock(17000); expect(writes()).toHaveLength(0); expect(saved.careCount).toBe(0);
});
it.each(kinds)("%s shortcut can explain a server without album data and return safely", async kind => {
  await mount(kind); saved.schema = 12; delete saved.album; await refresh(); await open();
  expect(panel().textContent).toContain("请更新服务"); await key("c");
  expect(pause(kind)).toBeTruthy(); expect(saved.album).toBeUndefined(); expect(writes()).toHaveLength(0);
});
it.each(kinds)("reads a saved %s encounter from pause without starting or rewarding play", async kind => {
  await mount(kind); saved.schema = 14;
  const entry = kind === "fishing"
    ? { kind: "encounter-fishing-stars" as const, outingId: "00002400000000000000000000000001" }
    : { kind: "encounter-walk-kite" as const, outingId: "00001800000000000000000000000001" };
  saved.album!.entries.push({ ...entry, at: Date.now() - 1000, source: "shared" });
  await refresh(); const before = structuredClone(saved);
  await open(); for (let i = 0; i < 3; i++) await key("b");
  expect(panel().dataset.albumKind).toBe(entry.kind); expect(panel().textContent).toContain("偶遇");
  await refresh(); expect(panel().dataset.albumKind).toBe(entry.kind);
  await key("c"); expect(pause(kind)).toBeTruthy(); await clock(17000);
  before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});

it.each(kinds)("refreshing saved %s summary is silent and browsing remains read-only", async kind => {
  await mount(kind); saved.schema=14;
  saved.game!.id=kind==="fishing"?"00002400000000000000000000000001":"00001800000000000000000000000001";
  saved.album!.entries.push({kind:kind==="fishing"?"encounter-fishing-stars":"encounter-walk-kite",outingId:saved.game!.id,at:Date.now()-1000,source:"shared"});
  await refresh(); expect(document.querySelector('.outing-encounter')?.textContent).toContain("本局偶遇");expect(document.querySelector('.toast')?.textContent??"").not.toContain("已收进风景手记");await clock(4200);
  await open();expect(document.querySelector('.outing-encounter')).toBeNull();await key("c");expect(document.querySelector('.outing-encounter')).toBeTruthy();
  cleanup();await act(async()=>{render(<App/>)});await clock(17000);
  expect(document.querySelector('.outing-encounter')).toBeTruthy();expect(document.querySelector('.toast')).toBeNull();expect(writes()).toHaveLength(0);expect(pause(kind)).toBeTruthy();
});
