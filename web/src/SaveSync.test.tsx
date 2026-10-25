import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap | undefined;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", returnRecap: structuredClone(recap), recapPending: false });
const writes = () => api.mock.calls.filter(([p]) => ["action", "reset", "import"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
function egg() { saved = { ...saved, revision: saved.revision + 1, createdAt: Date.now(), hatchedAt: 0, species: 0, growth: emptyGrowth("egg"), game: undefined }; recap = undefined; }
function hatch() { saved = { ...saved, revision: saved.revision + 1, hatchedAt: Date.now(), species: 7, growth: emptyGrowth("baby") }; }
function controls() { expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button")).toBeNull(); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); recap = undefined;
  saved = { schema: 11, revision: 10, species: 2, name: "同步伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("authoritative save synchronization across tabs", () => {
  it.each([false, true])("external hatch exits the old egg screen (confirmation=%s)", async confirmation => {
    egg(); await mount(); if (confirmation) await key("b");
    hatch(); await poll();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".cat-baby")).toBeTruthy();
    await key("b"); expect(document.querySelector(".content-menu")).toBeTruthy();
    expect(writes()).toHaveLength(0); controls();
  });

  it.each(["home", "menu", "growth", "arcade", "game"])("external reset exits the old %s screen", async page => {
    if (page === "game") saved.game = { kind: "tiles", id: "old-board", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1, tiles: { board: [1, 1], pick: -1, pairs: 0, shuffles: 0 } };
    await mount();
    if (page === "menu") await key("a");
    if (page === "growth") await menu(6);
    if (page === "arcade") await menu(1);
    expect(document.querySelector(`.content-${page}`)).toBeTruthy();
    egg(); await poll();
    expect(document.querySelector(".content-choose")).toBeTruthy();
    await key("b"); expect(document.querySelector(".content-hatch")).toBeTruthy();
    expect(writes()).toHaveLength(0); controls();
  });

  it.each(["createdAt", "hatchedAt", "species"] as const)("a changed immutable %s invalidates old navigation without an evolution celebration", async field => {
    await mount(); await menu(6);
    if (field === "species") saved.species = 7; else saved[field]--;
    saved.revision++; saved.growth = { ...emptyGrowth("adult"), points: 72, form: "gentle" };
    await poll();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
    await key("a"); expect(document.querySelector(".content-menu")).toBeTruthy();
    expect(writes()).toHaveLength(0); controls();
  });

  it.each(["help", "tools", "reset", "preview"])("external replacement clears the old %s intent", async panel => {
    await mount();
    if (panel === "help") fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    if (panel === "tools" || panel === "reset") {
      fireEvent.click(screen.getByRole("button", { name: /存档盒/ }));
      if (panel === "reset") fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
    }
    if (panel === "preview") {
      const body = JSON.stringify(saved), file = new File([body], "old.json");
      Object.defineProperty(file, "text", { value: async () => body });
      await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
      expect(document.querySelector(".import-preview")).toBeTruthy();
    }
    egg(); await poll();
    expect(document.querySelector(".content-choose")).toBeTruthy();
    expect(document.querySelector("[role=dialog], .tools-menu, .import-preview")).toBeNull();
    await key("b"); expect(document.querySelector(".content-hatch")).toBeTruthy();
    expect(writes()).toHaveLength(0); controls();
  });

  it("fresh reads clear a removed recap even when an import keeps the same pet identity", async () => {
    const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
    recap = { id: "old-recap", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
    await mount(); await menu(7); expect(document.querySelector(".return-panel")).toBeTruthy();
    recap = undefined; saved.revision++; await poll();
    expect(document.querySelector(".return-panel")).toBeNull();
    expect(document.querySelector(".content-home")).toBeTruthy();
    await menu(7); expect(document.querySelector(".reading-notice")!.textContent).toContain("还没有回访小结");
    expect(writes()).toHaveLength(0);
  });

  it("ordinary polls preserve both egg choices and handbook reading", async () => {
    egg(); await mount(); await key("a"); await key("b");
    expect(document.querySelector(".content-hatch")).toBeTruthy();
    const eggText = document.querySelector(".content-hatch")?.textContent;
    saved.revision++; await poll();
    expect(document.querySelector(".content-hatch")?.textContent).toBe(eggText);
    hatch(); await poll(); await menu(6); await key("a");
    expect(document.querySelector(".content-growth")).toBeTruthy();
    const text = document.querySelector(".content-growth")?.textContent;
    saved.revision++; saved.needs.hunger--; await poll();
    expect(document.querySelector(".content-growth")?.textContent).toBe(text);
    expect(writes()).toHaveLength(0);
  });

  it("a lower-revision reply cannot discard current navigation or pet", async () => {
    await mount(); await menu(6); const old = result(); egg(); const stale = result(); stale.state.revision = old.state.revision - 1;
    api.mockResolvedValueOnce(stale); await poll();
    expect(document.querySelector(".content-growth")).toBeTruthy();
    expect(document.querySelector(".content-choose")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("discarded file reads cannot revive an old import after a replacement", async () => {
    await mount(); const body = JSON.stringify(saved), file = new File([body], "slow.json");
    let finish!: (body: string) => void;
    Object.defineProperty(file, "text", { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
    expect(document.querySelector(".import-preview")).toBeTruthy();
    egg(); await poll(); await act(async () => { finish(body); });
    expect(document.querySelector(".content-choose")).toBeTruthy();
    expect(document.querySelector(".import-preview")).toBeNull();
    await key("b"); expect(document.querySelector(".content-hatch")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("a replacement with a persisted snake board requires an explicit resume", async () => {
    await mount(); await menu(6); saved.createdAt--; saved.hatchedAt--; saved.revision++;
    saved.game = { kind: "snake", id: "other-tab-board", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1,
      snake: { body: [{ x: 3, y: 3 }, { x: 2, y: 3 }], food: { x: 7, y: 7 }, direction: 1, eaten: 0, step: 0, lastMoveAt: Date.now(), paused: false } };
    await poll(); expect(document.querySelector(".content-game")).toBeTruthy();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("继续");
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(writes()).toHaveLength(0); controls();
  });

  it("ordinary growth on the same pet still celebrates the real stage transition", async () => {
    await mount(); saved.revision++; saved.growth = { ...emptyGrowth("growing"), points: 36 };
    await poll();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("celebrating");
    expect(writes()).toHaveLength(0);
  });

  it("a lower-revision read cannot clear a current recap or reset confirmation", async () => {
    const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
    recap = { id: "current-recap", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /存档盒/ }));
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
    const stale = result(); stale.state.revision--; delete stale.returnRecap;
    api.mockResolvedValueOnce(stale); await poll();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    await menu(7); expect(document.querySelector(".return-panel")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

});
