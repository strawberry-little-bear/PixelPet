import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { CompanionPanel } from "./CompanionPanel";
import { games } from "./games";
import { emptyGrowth } from "./growth";
import type { Companion, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.parse("2026-10-19T02:00:00Z");
const finishedAt = at - 3600000;
const fresh = (): Companion => ({ since: at - 86400000, interests: games.map(g => ({ kind: g.id, points: 0, lastAt: 0 })) });
const memory = () => screen.getByLabelText("最近一次共同游戏");
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const writes = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function open() { await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b"); for (let i = 0; i < 3; i++) await key("a"); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 1, species: 2, name: "陪伴伙伴", createdAt: at - 86400000, hatchedAt: at - 86400000,
    lastTick: at, sleeping: false, needs: { hunger: 80, clean: 80, energy: 80, mood: 80 }, careCount: 0,
    growth: emptyGrowth(), companion: fresh(), logs: [] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("saved shared-game memory", () => {
  it.each(games)("reads the stored $title completion, not a new response or interest award", game => {
    const c = fresh(); c.recent = { kind: game.id, id: "saved-session", at: finishedAt };
    c.interests.find(r => r.kind === game.id)!.points = 5;
    const before = structuredClone(c);
    const { container } = render(<CompanionPanel companion={c} />);
    expect(memory().textContent).toContain(game.title);
    expect(memory().querySelector("time")?.getAttribute("datetime")).toBe(new Date(finishedAt).toISOString());
    expect(memory().textContent).toContain(new Date(finishedAt).toLocaleString("zh-CN", {
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }));
    expect(memory().textContent).toContain("只保留最近一次完成；不代表本次兴趣增加");
    expect(memory().textContent).not.toMatch(/刚才|奖励|\+1/);
    expect(container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(c).toEqual(before);
  });
  it("does not reconstruct a missing recent record from familiarity or legacy dates", () => {
    const c = fresh(); c.interests[0] = { ...c.interests[0], points: 3, lastAt: finishedAt };
    render(<CompanionPanel companion={c} />);
    expect(memory().textContent).toContain("还没有保存的共同游戏");
    expect(memory().querySelector("time")).toBeNull();
  });
  it("keeps the legacy-service explanation instead of inventing a saved memory", () => {
    const { container } = render(<CompanionPanel />);
    expect(container.textContent).toContain("更新服务后");
    expect(container.querySelector('[aria-label="最近一次共同游戏"]')).toBeNull();
  });
  it("replaces a previous recent record and clears it when another save has none", () => {
    const c = fresh(); c.recent = { kind: "stars", id: "first", at: finishedAt };
    const { rerender } = render(<CompanionPanel companion={c} />);
    const next = { ...c, recent: { kind: "walk" as const, id: "second", at } };
    rerender(<CompanionPanel companion={next} />);
    expect(memory().textContent).toContain("公园散步"); expect(memory().textContent).not.toContain("接星星");
    rerender(<CompanionPanel companion={fresh()} />);
    expect(memory().textContent).toContain("还没有保存的共同游戏"); expect(memory().querySelector("time")).toBeNull();
  });
});

describe("three-key read-only memory flow", () => {
  it.each(["baby", "growing", "adult"] as const)("%s can revisit an old completion without replaying or writing", async stage => {
    saved.growth = emptyGrowth(stage); if (stage === "adult") saved.growth.form = "gentle";
    saved.companion!.recent = { kind: "fishing", id: "old-fishing", at: finishedAt };
    const before = structuredClone(saved);
    await mount(); await open();
    expect(memory().textContent).toContain("池塘钓鱼"); expect(document.querySelector(".home-game-token")).toBeNull();
    await poll(); expect(memory().querySelector("time")?.getAttribute("datetime")).toBe(new Date(finishedAt).toISOString());
    await key("c"); expect(document.querySelector(".home-game-token")).toBeNull();
    await open(); expect(memory().textContent).toContain("池塘钓鱼");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  });
  it("a newer snapshot updates the memory on the same page; stale state cannot replace it", async () => {
    saved.companion!.recent = { kind: "stars", id: "old-stars", at: finishedAt };
    await mount(); await open(); const stale = result();
    saved.revision++; saved.companion!.recent = { kind: "walk", id: "saved-walk", at };
    await poll(); expect(memory().textContent).toContain("公园散步");
    api.mockResolvedValueOnce(stale); await poll(); expect(memory().textContent).toContain("公园散步");
    expect(document.querySelector('.growth-panel')?.getAttribute('data-growth-page')).toBe("3");
    expect(writes()).toHaveLength(0);
  });
  it("reload reads the saved memory but returning home never starts an echo", async () => {
    saved.companion!.recent = { kind: "tiles", id: "saved-tiles", at: finishedAt };
    await mount(); await open(); expect(memory().textContent).toContain("连连看");
    cleanup(); await mount(); expect(document.querySelector(".home-game-token")).toBeNull();
    await open(); expect(memory().textContent).toContain("连连看"); await key("c");
    expect(document.querySelector(".home-game-token")).toBeNull(); expect(writes()).toHaveLength(0);
  });
});
