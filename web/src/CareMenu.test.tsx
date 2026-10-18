import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
const preview = () => document.querySelector(".care-preview")!;
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path));
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 1, species: 2, name: "菜单伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("three-key care explanations", () => {
  it("opens, browses all twelve hints, wraps, and cancels without writes", async () => {
    await mount(); await key("b");
    const kinds = ["feed", "arcade", "clean", "sleep", "status", "journal", "growth", "return", "album", "shop", "fish-album", "park-album"];
    for (const kind of kinds) {
      expect(preview().getAttribute("data-care-preview")).toBe(kind);
      expect(preview().textContent!.length).toBeGreaterThan(10);
      expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
      expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
      await key("a");
    }
    expect(preview().getAttribute("data-care-preview")).toBe("feed");
    await key("c"); expect(document.querySelector(".care-preview")).toBeNull(); expect(writes()).toHaveLength(0);
  });

  it("explanation clicks do nothing and B still submits exactly one original action", async () => {
    await mount(); await key("b");
    await act(async () => { fireEvent.click(preview()); }); expect(writes()).toHaveLength(0);
    await key("b");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toMatchObject({ kind: "feed" });
  });

  it("updates on an authoritative poll, not a locally elapsed cooldown", async () => {
    saved.growth!.care.lastFeed = Date.now() - 29 * 60000; await mount(); await key("b");
    expect(preview().textContent).toContain("间隔内");
    await act(async () => { vi.advanceTimersByTime(61000); });
    expect(preview().textContent).toContain("间隔内");
    saved.lastTick = Date.now(); saved.revision++;
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(preview().textContent).toContain("符合记录"); expect(writes()).toHaveLength(0);
  });

  it("explains waking without waking the pet on selection", async () => {
    saved.sleeping = true; await mount(); await key("b");
    expect(preview().textContent).toContain("先选「起床啦」");
    for (let i = 0; i < 3; i++) await key("a");
    expect(preview().textContent).toContain("按 B 轻轻叫醒");
    expect(document.querySelector(".care-item.selected")?.textContent).toContain("起床啦");
    expect(writes()).toHaveLength(0); expect(saved.sleeping).toBe(true);
    await key("b"); expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: "sleep" });
  });

  it("does not use the preview to forbid a server-accepted action on a newer state", async () => {
    saved.needs.hunger = 100; await mount(); await key("b");
    expect(preview().textContent).toContain("暂时不能喂食");
    expect((screen.getByRole("button", { name: "B 确认" }) as HTMLButtonElement).disabled).toBe(false);
    saved.needs.hunger = 95; saved.revision++;
    await key("b"); expect(writes()).toHaveLength(1);
  });

  it.each([undefined, "clock_ahead", "save_corrupt"] as const)("hides cached advice on failed polling (%s)", async code => {
    await mount(); await key("b");
    api.mockRejectedValue(new RequestFailure("lost", code ? "rejected" : "unavailable", code));
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(document.querySelector(".care-preview")).toBeNull(); expect(writes()).toHaveLength(0);
  });
});
