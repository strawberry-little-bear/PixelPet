import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, Shop } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const server = Date.parse("2026-10-20T12:00:00Z"), hour = 3600000, day = 24 * hour;
const rules: Shop = { catalog: [], dailyCoins: 10, gameDailyLimit: 30 };
let saved: PetState, servedAt: number;
const result = (): Result => ({ state: structuredClone(saved), serverTime: servedAt, message: "", shop: rules });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function openMenu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
async function refresh() { await act(async () => { window.dispatchEvent(new Event("focus")); }); }
const statusAge = () => document.querySelector(".status-name small")?.textContent?.replace(/\s/g, "");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(server); localStorage.clear(); api.mockReset(); servedAt = server;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 10, species: 2, name: "时间伙伴", createdAt: server - 31 * hour,
    hatchedAt: server - 30 * hour, lastTick: server, sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(),
    economy: { coins: 10, lastDailyAt: server, lastGameAt: server, gameCoins: 30, owned: [], equipped: { accessory: "", room: "" } } };
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "daily") { saved.economy!.lastDailyAt = servedAt; saved.revision++; }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

for (const skew of [-(7 * day + 1234), 0, 7 * day + 1234]) {
  it(`uses accepted server time for acquaintance days before any interval (browser skew ${skew})`, async () => {
    vi.setSystemTime(server + skew); await mount(); await openMenu(4);
    expect(statusAge()).toContain("相识第2天");
    expect(document.querySelector('[aria-label="状态记录时间"] time')?.getAttribute("datetime")).toBe(new Date(saved.lastTick).toISOString());
    expect(Date.now()).toBe(server + skew); expect(writes()).toHaveLength(0);
  });
  it(`uses accepted time for legacy stage estimates immediately (browser skew ${skew})`, async () => {
    saved.schema = 1; delete saved.growth;
    vi.setSystemTime(server + skew); await mount(); await openMenu(6);
    expect(document.querySelector(".growth-panel-title strong")?.textContent).toBe("成长期");
    expect(document.querySelector(".growth-score b")?.textContent).toContain("6.0");
    expect(saved.growth).toBeUndefined(); expect(writes()).toHaveLength(0);
  });
  it(`locates the star immediately using accepted time (browser skew ${skew})`, async () => {
    saved.game = { id: "stars-clock", startedAt: server - 1350, round: 0, score: 0, lastBeat: -1 };
    vi.setSystemTime(server + skew); await mount();
    const lanes = [...document.querySelectorAll(".game-lane")];
    expect(lanes).toHaveLength(3);
    expect(lanes.findIndex(lane => lane.querySelector(".falling-star.visible"))).toBe(1);
    expect(writes()).toHaveLength(0); expect(saved.game.round).toBe(0);
  });
}
it.each([true, false])("shows the authoritative greeting day and preserves explicit B action (claimed=%s)", async claimed => {
  saved.economy!.lastDailyAt = claimed ? server : server - day;
  vi.setSystemTime(server + (claimed ? 7 * day : -7 * day));
  await mount(); await openMenu(9);
  expect(document.querySelector(".shop-decision")?.textContent).toBe(claimed ? "今日已领取 · 不必连续来" : "B 收下 10 金币");
  expect(writes()).toHaveLength(0);
  await key("b");
  expect(writes()).toHaveLength(claimed ? 0 : 1);
  if (!claimed) expect(writes()[0][1]).toMatchObject({ kind: "daily" });
});
it.each([-1, 1])("updates visible time in the same render as a new accepted read (%s day)", async direction => {
  await mount(); await openMenu(4); expect(statusAge()).toContain("相识第2天");
  servedAt += direction * day; saved.lastTick = servedAt; saved.revision++;
  await refresh();
  expect(statusAge()).toContain(`相识第${direction === 1 ? 3 : 1}天`);
  expect(document.querySelector('[aria-label="状态记录时间"] time')?.getAttribute("datetime")).toBe(new Date(servedAt).toISOString());
  expect(Date.now()).toBe(server); expect(writes()).toHaveLength(0);
});
it("ignores stale revision time for both the immediate display and following ticks", async () => {
  await mount(); await openMenu(4);
  servedAt += day; saved.lastTick = servedAt; saved.revision++;
  await refresh(); expect(statusAge()).toContain("相识第3天");
  servedAt -= 2 * day; saved.lastTick = servedAt; saved.revision--;
  await refresh(); expect(statusAge()).toContain("相识第3天");
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(statusAge()).toContain("相识第3天"); expect(writes()).toHaveLength(0);
});
it("continues ticking from the accepted server offset without changing saved needs or growth", async () => {
  vi.setSystemTime(server + 7 * day); saved.game = { startedAt: server - 1350, round: 0, score: 0, lastBeat: -1 };
  const before = structuredClone(saved);
  await mount();
  expect([...document.querySelectorAll(".game-lane")].findIndex(lane => lane.querySelector(".falling-star.visible"))).toBe(1);
  await act(async () => { vi.advanceTimersByTime(900); });
  expect([...document.querySelectorAll(".game-lane")].findIndex(lane => lane.querySelector(".falling-star.visible"))).toBe(2);
  expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
});
it("updates the live star clock with an accepted action reply, without waiting for its 100ms interval", async () => {
  saved.game = { id: "stars-action-clock", startedAt: server - 1350, round: 0, score: 0, lastBeat: -1 };
  await mount();
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "catch") {
      servedAt += 900; saved.lastTick = servedAt; saved.revision++;
      saved.game!.round++; saved.game!.lastBeat = 2;
    }
    return result();
  });
  await key("b");
  expect([...document.querySelectorAll(".game-lane")].findIndex(lane => lane.querySelector(".falling-star.visible"))).toBe(2);
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: "catch", gameId: "stars-action-clock" });
  expect(Date.now()).toBe(server);
});
