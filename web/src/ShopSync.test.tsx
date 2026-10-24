import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result, Shop, ShopItem } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, shop: Shop;
const result = (): Result => ({ state: structuredClone(saved), shop: structuredClone(shop), serverTime: Date.now(), saveGeneration: "a".repeat(32), message: "" });
const title = () => document.querySelector(".shop-panel h3")?.textContent;
const confirmed = () => document.querySelector(".shop-panel")?.getAttribute("data-confirm") === "true";
const mutations = () => api.mock.calls.filter(([p]) => ["action", "import", "reset", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function open(category: "owned" | "all" = "owned") {
  await key("a"); for (let i = 0; i < 9; i++) await key("a"); await key("b");
  for (let i = 0; i < (category === "owned" ? 7 : 1); i++) await key("a"); await key("b");
}
async function sync() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 11, revision: 1, species: 2, name: "商店同步伙伴", createdAt: Date.now() - 3600000,
    hatchedAt: Date.now() - 3500000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [],
    economy: { coins: 100, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: ["clover-pot", "mint-floor"], equipped: { accessory: "", room: "" } } };
  shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [
    { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "胸前的小叶子" },
    { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "小小的绿色" },
    { id: "mint-floor", name: "薄荷方砖", slot: "floor", price: 22, description: "清凉的地板" },
  ] };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const action = body as { kind: string; item: string }, e = saved.economy!;
      const item = shop.catalog.find(item => item.id === action.item)!;
      if (action.kind === "equip") e.equipped[item.slot] = e.equipped[item.slot] === item.id ? "" : item.id;
      if (action.kind === "buy") { e.coins -= item.price; e.owned.push(item.id); }
      saved.revision++;
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("shop selection and purchase intent during authoritative updates", () => {
  it.each([0, 1])("keeps owned item %s selected when another tab buys an earlier catalog item", async index => {
    await mount(); await open(); if (index) await key("a");
    const selected = index ? "mint-floor" : "clover-pot", originalTitle = title();
    saved.economy!.owned.push("leaf-pin"); await sync(); expect(title()).toBe(originalTitle);
    expect(mutations()).toHaveLength(0); await key("b");
    expect(mutations().map(([, body]) => body)).toEqual([expect.objectContaining({ kind: "equip", item: selected })]);
    expect(saved.economy!.coins).toBe(100);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelectorAll(".lcd button,.lcd input,.lcd a")).toHaveLength(0);
  });
  it("browses the updated owned ordering after the stable selection, with wrap and directory return", async () => {
    await mount(); await open(); saved.economy!.owned.push("leaf-pin"); await sync();
    await key("a"); expect(title()).toContain("薄荷方砖"); await key("a"); expect(title()).toContain("嫩叶胸针");
    await key("c"); expect(document.querySelector('[data-shop-category="directory"]')).toBeTruthy();
    await key("b"); expect(title()).toContain("嫩叶胸针"); expect(mutations()).toHaveLength(0);
  });
  it("binds purchase confirmation to the item ID rather than a reordered catalog position", async () => {
    await mount(); await open("all"); await key("b"); expect(confirmed()).toBe(true);
    shop.catalog = [shop.catalog[1], shop.catalog[0], shop.catalog[2]]; await sync();
    expect(title()).toContain("嫩叶胸针"); expect(confirmed()).toBe(true); await key("b");
    expect(mutations().map(([, body]) => body)).toEqual([expect.objectContaining({ kind: "buy", item: "leaf-pin" })]);
    expect(saved.economy!.coins).toBe(88);
  });
  it.each([
    { price: 13 }, { name: "新名称" }, { slot: "room" as const }, { description: "已更新的说明" },
  ])("invalidates a quote when displayed item details change: %j", async change => {
    await mount(); await open("all"); await key("b"); expect(confirmed()).toBe(true);
    shop.catalog[0] = { ...shop.catalog[0], ...change } as ShopItem; await sync();
    expect(confirmed()).toBe(false); expect(document.querySelector('.shop-sync-note')?.textContent).toContain("购买确认已取消");
    expect(mutations()).toHaveLength(0); await key("b"); expect(confirmed()).toBe(true); expect(mutations()).toHaveLength(0);
    await key("b"); expect(mutations()).toHaveLength(1); expect(saved.economy!.coins).toBe(100 - shop.catalog[0].price);
  });
  it.each(["owned", "coins", "sleeping"])("cancels pending purchase on an incompatible %s update without submitting it", async kind => {
    await mount(); await open("all"); await key("b");
    if (kind === "owned") saved.economy!.owned.push("leaf-pin");
    if (kind === "coins") saved.economy!.coins = 0;
    if (kind === "sleeping") saved.sleeping = true;
    await sync(); expect(confirmed()).toBe(false); expect(mutations()).toHaveLength(0);
    expect(document.querySelector('.shop-sync-note')?.textContent).toContain("购买确认已取消");
    if (kind !== "owned") { await key("b"); expect(confirmed()).toBe(false); expect(mutations()).toHaveLength(0); }
    else {
      await key("b"); expect(mutations().map(([, body]) => body)).toEqual([expect.objectContaining({ kind: "equip", item: "leaf-pin" })]);
      expect(saved.economy!.coins).toBe(100);
    }
  });
  it("reanchors a removed selection and an empty/refilled filter without rediscovering an old cursor", async () => {
    await mount(); await open(); shop.catalog = shop.catalog.filter(item => item.id !== "clover-pot"); await sync();
    expect(title()).toContain("薄荷方砖"); expect(document.querySelector('.shop-sync-note')?.textContent).toContain("已不在这个分类");
    saved.economy!.owned = []; await sync(); expect(title()).toContain("这里还空着呢"); await key("b"); expect(mutations()).toHaveLength(0);
    saved.economy!.owned = ["leaf-pin"]; await sync(); expect(title()).toContain("嫩叶胸针");
    await key("b"); expect(mutations().map(([, body]) => body)).toEqual([expect.objectContaining({ kind: "equip", item: "leaf-pin" })]);
  });
  it("keeps a compatible quote across cloned reads and an affordable balance change", async () => {
    await mount(); await open("all"); await key("b");
    expect(document.querySelector(".shop-decision")?.textContent).toContain("购买后剩 88 金币");
    saved.economy!.coins = 50; await sync(); expect(confirmed()).toBe(true);
    expect(document.querySelector(".shop-decision")?.textContent).toContain("购买后剩 38 金币");
    expect(document.querySelector('.shop-sync-note')).toBeNull(); await key("b");
    expect(saved.economy!.coins).toBe(38); expect(mutations()).toHaveLength(1);
  });
  it("does not report its own acknowledged purchase as a canceled confirmation", async () => {
    await mount(); await open("all"); await key("b"); await key("b");
    expect(confirmed()).toBe(false); expect(title()).toContain("已拥有");
    expect(document.querySelector('.shop-sync-note')).toBeNull();
    expect(saved.economy!.coins).toBe(88); expect(mutations()).toHaveLength(1);
  });
  it("marks use as saved only after acknowledgement, and keeps removal separate from its trial preview", async () => {
    await mount(); await open();
    const caption = () => document.querySelector(".shop-preview small")?.textContent;
    expect(caption()).toBe("仅预览 · 未使用");
    let accept!: (reply: Result) => void;
    api.mockImplementationOnce(() => new Promise<Result>(resolve => { accept = resolve; }));
    await key("b");
    expect(caption()).toBe("仅预览 · 未使用");
    expect(document.querySelector<HTMLButtonElement>(".button-b")?.disabled).toBe(true);
    saved.economy!.equipped.room = "clover-pot"; saved.revision++;
    await act(async () => { accept(result()); });
    expect(caption()).toBe("使用中 · 已保存");
    await sync();
    expect(caption()).toBe("使用中 · 已保存");
    expect(mutations()).toHaveLength(1);
    await key("b");
    expect(saved.economy!.equipped.room).toBe("");
    expect(caption()).toBe("仅预览 · 未使用");
    expect(document.querySelector('.shop-preview [data-item="clover-pot"]')).not.toBeNull();
    expect(saved.economy!.coins).toBe(100);
    expect(mutations().map(([, body]) => body)).toEqual([
      expect.objectContaining({ kind: "equip", item: "clover-pot" }),
      expect.objectContaining({ kind: "equip", item: "clover-pot" }),
    ]);
    await key("c");
    expect(document.querySelector('.shop-preview [data-item="clover-pot"]')).toBeNull();
    expect(caption()).toBe("当前小窝 · 装扮不影响成长");
  });
  it("does not redirect confirmation to a replacement item when the quoted item disappears", async () => {
    saved.economy!.owned = [];
    await mount(); await open("all"); await key("b");
    shop.catalog.shift(); await sync();
    expect(title()).toContain("四叶草盆栽"); expect(confirmed()).toBe(false); expect(mutations()).toHaveLength(0);
    await key("b"); expect(confirmed()).toBe(true); expect(mutations()).toHaveLength(0);
    await key("b"); expect(mutations().map(([, body]) => body)).toEqual([expect.objectContaining({ kind: "buy", item: "clover-pot" })]);
  });
  it("accepts the first real owned item after opening an empty filter", async () => {
    saved.economy!.owned = []; await mount(); await open(); expect(title()).toContain("这里还空着呢");
    saved.economy!.owned = ["clover-pot"]; await sync(); expect(title()).toContain("四叶草盆栽");
    await key("b"); expect(mutations()).toHaveLength(1);
  });
});
