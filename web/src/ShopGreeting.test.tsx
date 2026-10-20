import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import type { PetState, Result, Shop } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, shop: Shop;
const blocked = "钱包放不下本次 10 金币；本次未领取，腾出空间后可再领。";
const decision = () => document.querySelector(".shop-decision")?.textContent;
const writes = () => api.mock.calls.filter(([path]) => path === "action");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function directory() {
  await act(async () => { render(<App />); });
  await key("a"); for (let i = 0; i < 9; i++) await key("a"); await key("b");
}
async function sync() {
  saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const now = Date.now();
  saved = { schema: 11, revision: 1, species: 2, name: "问候伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
    economy: { coins: 999991, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } } };
  shop = { maxCoins: 1000000, dailyCoins: 10, gameDailyLimit: 30, catalog: [] };
  api.mockImplementation(async (path, body) => {
    if (path === "action" && (body as { kind: string }).kind === "daily") {
      saved.economy!.coins += shop.dailyCoins; saved.economy!.lastDailyAt = Date.now(); saved.revision++;
    }
    return { state: structuredClone(saved), shop: structuredClone(shop), serverTime: Date.now(),
      saveGeneration: "a".repeat(32), message: "" } as Result;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("daily greeting fits the whole server-owned amount before offering a claim", () => {
  it.each([999991, 1000000])("explains insufficient wallet room at %i without changing the save", coins => {
    saved.economy!.coins = coins; const before = JSON.stringify(saved);
    render(<ShopPanel pet={saved} shop={shop} page={0} now={Date.now()} confirm={false} />);
    expect(decision()).toBe(blocked);
    expect(decision()).not.toContain("B 收下"); expect(JSON.stringify(saved)).toBe(before);
    expect(document.querySelectorAll("button,input,a,[role=button]")).toHaveLength(0);
  });
  it.each([999989, 999990])("offers all ten coins when they fit at %i", coins => {
    saved.economy!.coins = coins;
    render(<ShopPanel pet={saved} shop={shop} page={0} now={Date.now()} confirm={false} />);
    expect(decision()).toBe("B 收下 10 金币");
  });
  it("uses server limits and amount, without inventing a cap for old responses", () => {
    saved.economy!.coins = 9; shop.maxCoins = 20; shop.dailyCoins = 12;
    const view = render(<ShopPanel pet={saved} shop={shop} page={0} now={Date.now()} confirm={false} />);
    expect(decision()).toContain("钱包放不下本次 12 金币");
    view.rerender(<ShopPanel pet={saved} shop={{ ...shop, maxCoins: undefined }} page={0} now={Date.now()} confirm={false} />);
    expect(decision()).toBe("B 收下 12 金币");
  });
  it.each(["sleeping", "claimed"])("keeps the %s reason ahead of capacity", reason => {
    if (reason === "sleeping") saved.sleeping = true;
    else saved.economy!.lastDailyAt = Date.now();
    render(<ShopPanel pet={saved} shop={shop} page={0} now={Date.now()} confirm={false} />);
    expect(decision()).toBe(reason === "sleeping" ? "让它安心睡吧，起床后再操作。" : "今日已领取 · 不必连续来");
  });
  it.each([999991, 1000000])("B at %i sends no known-invalid claim, and still allows browsing", async coins => {
    saved.economy!.coins = coins; await directory(); const before = JSON.stringify(saved);
    await key("b"); await key("b"); expect(writes()).toHaveLength(0);
    expect(decision()).toBe(blocked); expect(JSON.stringify(saved)).toBe(before);
    await key("a"); expect(decision()).toBe("B 查看全部物品");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  });
  it("a refreshed balance unblocks only the next explicit B, and exactly fits the wallet", async () => {
    await directory(); await key("b"); expect(writes()).toHaveLength(0);
    saved.economy!.coins = 999990; await sync();
    expect(decision()).toBe("B 收下 10 金币"); expect(writes()).toHaveLength(0);
    await key("b"); expect(writes()).toHaveLength(1); expect(saved.economy!.coins).toBe(1000000);
    expect(decision()).toBe("今日已领取 · 不必连续来");
    await key("b"); expect(writes()).toHaveLength(1);
  });
});
