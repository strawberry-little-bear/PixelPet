import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { emptyGrowth } from "./growth";
import { games } from "./games";
import type { PetState, Result } from "./types";

// The real API parser receives damaged HTTP-200 JSON, not a mocked API error.
let saved: PetState;
let broken: "" | "visit" | "state" | "action";
let damage: (r: Result) => unknown;
const calls: string[] = [];
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const writes = () => calls.filter(p => p === "action" || p === "import" || p === "reset" || p === "recap/read");
const recovery = () => document.querySelector(".save-recovery");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function handbook() {
  await key("a"); for (let i = 0; i < 6; i++) await key("a"); await key("b");
  for (let i = 0; i < 3; i++) await key("b");
  expect(screen.getByLabelText("共同游戏与兴趣")).toBeTruthy();
}
const corruptions = [
  ["missing interests", (r: Result) => ({ ...r, state: { ...r.state, companion: { since: Date.now() } } })],
  ["unsafe dot count", (r: Result) => ({ ...r, state: { ...r.state, companion: { ...r.state.companion, interests: [{ kind: "tiles", points: 6, lastAt: 0 }] } } })],
  ["undisplayable recent date", (r: Result) => ({ ...r, state: { ...r.state, companion: { ...r.state.companion, recent: { id: "old-game", kind: "tiles", at: 8640000000000001 } } } })],
] as const;
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); calls.length = 0; broken = "";
  const now = Date.now();
  saved = { schema: 12, revision: 1, species: 2, name: "一起玩", createdAt: now - 10000, hatchedAt: now - 9000, lastTick: now,
    sleeping: false, needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [],
    companion: { since: now - 9000, interests: games.map(g => ({ kind: g.id, points: 0, lastAt: 0 })), recent: { kind: "tiles", id: "old-game", at: now - 1000 } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.replace("/api/", ""); calls.push(path);
    if (path === "action") { saved.needs.hunger += 20; saved.careCount++; saved.revision++; }
    const r = reply(); return new Response(JSON.stringify(path === broken ? damage(r) : r));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(corruptions)("initial %s is recoverable, not a crash or a corrupt-save claim", async (_, corrupt) => {
  broken = "visit"; damage = corrupt; await mount();
  expect(recovery()?.textContent).toContain("还没有读到存档");
  expect(recovery()?.textContent).not.toContain("存档待修复");
  await key("a"); await key("c"); expect(writes()).toHaveLength(0);
  broken = ""; await key("b"); await handbook();
  expect(screen.getByLabelText("最近一次共同游戏").textContent).toContain("已完成并收好");
  expect(writes()).toHaveLength(0);
});
it.each(corruptions)("a polled %s cannot crash an open shared-game page", async (_, corrupt) => {
  await mount(); await handbook(); broken = "visit"; damage = corrupt;
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(recovery()?.textContent).toContain("小窝暂时未连接");
  expect(screen.getByRole("alert").textContent).not.toContain("可能已经保存");
  broken = ""; await key("b");
  expect(screen.getByLabelText("最近一次共同游戏").textContent).toContain("已完成并收好");
  expect(writes()).toHaveLength(0);
});
it.each(corruptions)("a committed meal with %s is reconciled without replay or invented history", async (_, corrupt) => {
  await mount(); broken = "action"; damage = corrupt; await key("a"); await key("b");
  expect(recovery()).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("可能已经保存");
  await key("a"); await key("c"); expect(writes()).toEqual(["action"]);
  broken = "state"; await key("b"); expect(recovery()).toBeTruthy(); expect(calls.at(-1)).toBe("state");
  broken = ""; await key("b"); expect(recovery()).toBeNull(); expect(calls.at(-1)).toBe("state");
  expect(saved.careCount).toBe(1); expect(saved.needs.hunger).toBe(70);
  expect(document.querySelector(".care-outcome,.growth-feedback.has-feedback")).toBeNull();
  await handbook(); expect(screen.getByLabelText("最近一次共同游戏").textContent).toContain("已完成并收好");
  expect(document.querySelectorAll('[data-points="0"]')).toHaveLength(games.length);
  expect(writes()).toEqual(["action"]);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
});
it.each([false, true])("missing legacy shared history remains readable (explicit null=%s)", async explicitNull => {
  delete saved.companion;
  if (explicitNull) { broken = "visit"; damage = r => ({ ...r, state: { ...r.state, companion: null } }); }
  await mount(); await handbook();
  expect(screen.getByLabelText("共同游戏与兴趣").textContent).toContain("更新服务后");
  expect(screen.queryByLabelText("最近一次共同游戏")).toBeNull(); expect(writes()).toHaveLength(0);
});
