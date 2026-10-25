import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const readers = [
  { kind: "journal", label: "成长日记阅读区", index: 5, selector: ".screen-journal" },
  { kind: "album", label: "永久纪念册阅读区", index: 8, selector: ".album-panel" },
  { kind: "fish", label: "池塘鱼图鉴阅读区", index: 10, selector: ".fish-album" },
  { kind: "park", label: "公园沿途发现阅读区", index: 11, selector: ".park-album" },
] as const;
type Reader = typeof readers[number];
let saved: PetState;
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
const panel = () => document.querySelector<HTMLElement>(".memory-reading-region")!;
async function key(key: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); }); return event;
}
async function mount(reader: Reader, paused = false) {
  if (paused && (reader.kind === "fish" || reader.kind === "park")) {
    saved.game = { id: "0123456789abcdef0123456789abcdef", kind: reader.kind === "fish" ? "fishing" : "walk",
      startedAt: saved.hatchedAt, round: 0, score: 0, lastBeat: -1,
      ...(reader.kind === "fish"
        ? { fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 4, waitMs: 32000,
          elapsedMs: 5000, candidate: "reed-minnow", lastPulseAt: Date.now(), paused: true } }
        : { walking: { route: Array<"rock">(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 25,
          step: 4, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: Date.now(), lastInputAt: 0, paused: true } }) };
  }
  await act(async () => { render(<App />); });
  await key("a"); if (!paused) for (let n = 0; n < reader.index; n++) await key("a"); await key("b");
  expect(document.querySelector(reader.selector)).toBeTruthy();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  localStorage.clear(); api.mockReset();
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "回忆伙伴", createdAt: at, hatchedAt: at,
    lastTick: Date.now(), sleeping: false, needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0,
    growth: emptyGrowth(), logs: [{ at: at + 2000, text: "最新日记" }, { at: at + 1000, text: "早些的日记" }],
    album: { since: at, legacy: false, entries: [{ kind: "hatch", at, source: "shared" }] } };
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), message: "", serverTime: Date.now() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(readers)("$kind exposes one named read-only stop, with no new control or focus stealing", async reader => {
  await mount(reader); const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  const region = screen.getByRole("region", { name: reader.label });
  expect(region).toBe(panel()); expect(region.tabIndex).toBe(0); expect(document.activeElement).toBe(button);
  expect(document.querySelectorAll(".memory-reading-region")).toHaveLength(1);
  expect(document.getElementById(region.getAttribute("aria-describedby")!)?.textContent).toContain("↑/↓ 或空格");
  expect(region.querySelector("button,a,input,[role=button]")).toBeNull(); if (reader.kind === "album") expect(region.querySelectorAll("[data-selection-status]")).toHaveLength(1);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(writes()).toHaveLength(0);
});
it.each(readers)("$kind allows native scrolling/repeats/Enter without paging; letters still navigate", async reader => {
  await mount(reader); const region = panel(); region.focus(); const initial = region.textContent;
  for (const read of ["ArrowDown", "ArrowUp", " ", "PageDown", "PageUp", "Home", "End", "Tab", "Enter"]) {
    for (const init of [{}, { repeat: true }, { shiftKey: true }]) {
      expect((await key(read, region, init)).defaultPrevented).toBe(false);
      expect(region.textContent).toBe(initial); expect(document.activeElement).toBe(region);
    }
  }
  expect((await key("a", region)).defaultPrevented).toBe(true); expect(region.textContent).not.toBe(initial);
  expect(document.activeElement).toBe(region); const afterA = region.textContent;
  expect((await key("b", region)).defaultPrevented).toBe(true);
  expect(region.textContent).not.toBe(afterA);
  expect(document.activeElement).toBe(region); await key("Escape", region);
  if (reader.kind === "album") { expect(document.querySelector(".album-directory")).toBeTruthy(); await key("c", region); }
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it.each(readers)("$kind preserves focused reader and selection during ordinary polling", async reader => {
  await mount(reader); const region = panel(); region.focus(); await key("a", region); const content = region.textContent;
  saved.revision++; saved.needs.hunger = 59;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(17000); });
  expect(panel()).toBe(region); expect(document.activeElement).toBe(region); expect(region.textContent).toBe(content);
  expect(writes()).toHaveLength(0);
});
it.each(readers)("$kind preserves physical A activation and does not handle repeated activation", async reader => {
  await mount(reader); const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
  const initial = document.querySelector(reader.selector)!.textContent;
  expect((await key(" ", button)).defaultPrevented).toBe(true);
  const changed = document.querySelector(reader.selector)!.textContent; expect(changed).not.toBe(initial);
  expect((await key(" ", button, { repeat: true })).defaultPrevented).toBe(true);
  expect(document.querySelector(reader.selector)!.textContent).toBe(changed); expect(document.activeElement).toBe(button);
  expect(writes()).toHaveLength(0);
});
it.each(readers.filter(r => r.kind === "fish" || r.kind === "park"))("$kind reader returns to the same paused session without resuming", async reader => {
  await mount(reader, true); const before = structuredClone(saved), region = panel(); region.focus();
  await key(" ", region); await key("Enter", region); await key("b", region);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); await key("c", region);
  expect(document.querySelector(reader.kind === "fish" ? ".fishing-pause" : ".walk-pause")).toBeTruthy();
  expect(panel()).toBeNull(); await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
});
it.each(readers)("$kind empty legacy collections remain readable without fabricating records", async reader => {
  saved.logs = []; delete saved.album; delete saved.pond; delete saved.park;
  const before = structuredClone(saved); await mount(reader); const region = panel(); region.focus();
  await key("Enter", region); await key(" ", region); expect(document.activeElement).toBe(region);
  expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
});
