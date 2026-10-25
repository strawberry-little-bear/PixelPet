import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), server = Date.parse("2026-10-21T12:00:00Z");
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: server, message: "",
  shop: { catalog: [], dailyCoins: 10, gameDailyLimit: 30 } });
const starsStatus = () => screen.getByRole("region", { name: "接星星" }).querySelector('[data-selection-status="stars"]')!;
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(server); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 10, species: 2, name: "接星伙伴", createdAt: server - 3600000,
    hatchedAt: server - 3600000, lastTick: server, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(),
    game: { id: "stars-reading", startedAt: server - 1350, round: 2, score: 1, lastBeat: 0 } };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("explains saved rounds and score without making waiting into a failed round", async () => {
  await mount(); expect(screen.getByText("第 3 / 5 轮")).toBeTruthy();
  expect(screen.getByText("已接住 1 颗")).toBeTruthy();
  expect(screen.getByText(/不必等落到底/)).toBeTruthy();
  expect(screen.getByText(/接空也算一轮/)).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(screen.getByText("第 3 / 5 轮")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it("describes the changing star and three-key position without live speech every beat", async () => {
  await mount(); const status = starsStatus();
  expect(status.getAttribute("role")).toBe("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toContain("伙伴在中间；A 移到右边");
  const board = screen.getByRole("img", { name: "星星在中间；伙伴在中间" });
  expect(board.querySelectorAll(".game-lane")).toHaveLength(3);
  expect(board.closest('[aria-live]')).toBeNull();
  for (const [position, next] of [["右边", "左边"], ["左边", "中间"], ["中间", "右边"]]) {
    await key("a"); expect(starsStatus()).toBe(status);
    expect(status.textContent).toContain(`伙伴在${position}；A 移到${next}`);
    expect(screen.getByText(`伙伴：${position}`)).toBeTruthy();
    expect(screen.getByRole("img", { name: `星星在中间；伙伴在${position}` })).toBeTruthy();
  }
  const announced = status.textContent;
  const changes = vi.fn(); const observer = new MutationObserver(changes);
  observer.observe(status, { childList: true, subtree: true, characterData: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(status.textContent).toBe(announced); expect(changes).not.toHaveBeenCalled(); observer.disconnect();
  expect(screen.getByRole("img", { name: "星星在右边；伙伴在中间" })).toBeTruthy();
  expect(writes()).toHaveLength(0);
});
it("preserves saved progress through C confirmation and returns using A without a write", async () => {
  await mount(); await key("a"); await key("c");
  expect(document.querySelector(".game-abandon")).toBeTruthy();
  await key("a"); expect(screen.getByText("第 3 / 5 轮")).toBeTruthy();
  expect(screen.getByText("伙伴：右边")).toBeTruthy(); expect(writes()).toHaveLength(0);
});
it("keeps the server catch reply and sends only the selected lane and original session", async () => {
  await mount(); await key("a");
  api.mockImplementationOnce(async () => {
    saved.game!.round++; saved.game!.lastBeat = 1; saved.revision++;
    return { ...result(), message: "差一点！再试一次。" };
  });
  await key("b"); expect(screen.getByText("第 4 / 5 轮")).toBeTruthy();
  expect(document.querySelector(".game-message")?.textContent).toBe("差一点！再试一次。");
  expect(starsStatus().textContent).toContain("第 4 / 5 轮，已接住 1 颗");
  expect(starsStatus().textContent).toContain("伙伴在右边；A 移到左边");
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: "catch", lane: 2, gameId: "stars-reading" });
});

it("announces confirmed progress without replaying speech on ordinary state reads", async () => {
  await mount(); const status = starsStatus(), initial = status.textContent;
  let resolveCatch!: (value: Result) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { resolveCatch = resolve; }));
  await key("b"); expect(status.textContent).toBe(initial);
  saved.game!.round++; saved.game!.score++; saved.game!.lastBeat = 1; saved.revision++;
  await act(async () => { resolveCatch(result()); });
  expect(status.textContent).toContain("第 4 / 5 轮，已接住 2 颗");
  const changes = vi.fn(), observer = new MutationObserver(changes);
  observer.observe(status, { childList: true, subtree: true, characterData: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(starsStatus()).toBe(status); expect(changes).not.toHaveBeenCalled(); observer.disconnect();
  expect(writes()).toHaveLength(1);
  await key("c"); expect(document.querySelector('[data-selection-status="stars"]')).toBeNull();
  await key("a"); expect(starsStatus().textContent).toContain("第 4 / 5 轮，已接住 2 颗");
  expect(writes()).toHaveLength(1);
});
