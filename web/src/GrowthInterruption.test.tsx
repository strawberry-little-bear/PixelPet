import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { clipDurations } from "./motion";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
let generation: string;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: generation, serverTime: Date.now(), message: "" });
const celebrating = () => document.querySelector('.content-home .motion-celebrating');
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function grow(stage: "growing" | "adult") {
  saved.revision++;
  saved.growth = { ...emptyGrowth(stage), points: stage === "adult" ? 72 : 24, form: stage === "adult" ? "lively" : "" };
  await sync();
}
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import", "recap/read"].includes(path));
function panel(kind: "help" | "tools" | "reset", open: boolean) {
  if (!open && kind !== "tools") fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
  else {
    fireEvent.click(screen.getByRole("button", { name: kind === "help" ? "玩法说明" : /存档盒/ }));
    if (kind === "reset") fireEvent.click(screen.getByRole("button", { name: /^重新开始$/ }));
  }
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = "a".repeat(32);
  saved = { schema: 11, revision: 10, species: 2, name: "成长不要错过", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("interrupted growth celebrations", () => {
  for (const stage of ["growing", "adult"] as const) {
    it(`${stage} restarts in full after backgrounding, without changing the save`, async () => {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
      await mount(); await grow(stage); expect(celebrating()).toBeTruthy(); await tick(800);
      const snapshot = structuredClone(saved);
      hidden.mockReturnValue(true); await sync(); await tick(5000);
      expect(celebrating()).toBeNull();
      hidden.mockReturnValue(false); await sync(); expect(celebrating()).toBeTruthy();
      expect(document.querySelector('.toast')?.textContent).toContain(stage === "adult" ? "活力型" : "进入成长期");
      await tick(clipDurations.evolve - 1); expect(celebrating()).toBeTruthy();
      await tick(1); expect(celebrating()).toBeNull(); await sync(); expect(celebrating()).toBeNull();
      expect(saved).toEqual(snapshot); expect(writes()).toHaveLength(0);
    });
    it.each(["help", "tools", "reset"] as const)(`${stage} restarts after closing %s, and C can still skip`, async kind => {
      await mount(); await grow(stage); await tick(800); panel(kind, true); await tick(5000);
      expect(celebrating()).toBeNull(); panel(kind, false); expect(celebrating()).toBeTruthy();
      await key("c"); expect(celebrating()).toBeNull(); await sync(); await tick(5000);
      expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
      await key("a"); expect(document.querySelector('.content-menu')).toBeTruthy();
    });
  }
  it("successive interruptions do not let an earlier timer finish the new clip", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await mount(); await grow("growing"); await tick(2000);
    hidden.mockReturnValue(true); await sync(); await tick(100);
    hidden.mockReturnValue(false); await sync(); await tick(500); expect(celebrating()).toBeTruthy();
    panel("help", true); await tick(4000); panel("help", false);
    await tick(clipDurations.evolve - 1); expect(celebrating()).toBeTruthy();
    await tick(1); expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("replaces an interrupted growing celebration with the latest accepted adult stage", async () => {
    await mount(); await grow("growing"); panel("help", true); await grow("adult"); await tick(5000);
    panel("help", false); expect(celebrating()).toBeTruthy();
    expect(document.querySelector('.toast')?.textContent).toContain("活力型");
    expect(document.querySelector('.pet-scene')?.getAttribute('data-stage')).toBe("adult");
    await key("c"); await sync(); expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("waits until an externally sleeping pet wakes before replaying", async () => {
    await mount(); await grow("growing"); saved.sleeping = true; saved.revision++; await sync(); await tick(5000);
    expect(celebrating()).toBeNull(); saved.sleeping = false; saved.revision++; await sync(); expect(celebrating()).toBeTruthy();
    await tick(clipDurations.evolve); expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it.each(["replacement", "game", "offline"] as const)("%s discards the old interrupted celebration", async change => {
    await mount(); await grow("growing"); panel("help", true);
    if (change === "replacement") { generation = "b".repeat(32); saved.growth = emptyGrowth("baby"); saved.revision = 1; }
    if (change === "game") { saved.revision++; saved.game = { id: "1".repeat(32), startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 }; }
    if (change === "offline") api.mockRejectedValueOnce(new Error("offline"));
    await sync(); await tick(5000);
    if (screen.queryByRole("button", { name: /^关闭$/ })) panel("help", false);
    await sync(); expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it("a skipped or initially loaded stage is not replayed after backgrounding", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    saved.growth = emptyGrowth("growing"); await mount(); expect(celebrating()).toBeNull();
    await grow("adult"); await key("c"); hidden.mockReturnValue(true); await sync(); await tick(5000);
    hidden.mockReturnValue(false); await sync(); expect(celebrating()).toBeNull(); expect(writes()).toHaveLength(0);
  });
});
