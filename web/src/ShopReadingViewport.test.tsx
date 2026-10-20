import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { shopSections } from "./shop";
import type { GrowthStage, PetState, Result, Shop } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, shop: Shop, generation: string | undefined, top: number, targets: string[];
const response = (): Result => ({ state: structuredClone(saved), shop: structuredClone(shop), message: "", serverTime: Date.now(), saveGeneration: generation });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function directory() { await key("a"); for (let i = 0; i < 9; i++) await key("a"); await key("b"); }
async function items() { await directory(); await key("a"); await key("b"); }
async function mount(stage: GrowthStage = "baby", sleeping = false) {
  const at = Date.now() - 3600000;
  saved = { schema: 17, revision: 1, species: 2, name: "看清再购买", createdAt: at, hatchedAt: at, lastTick: Date.now(), sleeping,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 40 }, careCount: 0, logs: [], growth: emptyGrowth(stage),
    economy: { coins: 100, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } } };
  saved.growth!.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 1;
  if (stage === "adult") saved.growth!.form = "gentle";
  await act(async () => { render(<App />); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T08:00:00+08:00")); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  generation = "a".repeat(32); top = -500; targets = [];
  shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [
    { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "小小的叶子" },
    { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "绿色的小窝" },
  ] };
  api.mockReset(); api.mockImplementation(async () => response());
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const target = this.matches('.shop-sections [aria-current="true"]') ? "section" : this.matches(".shop-panel h3") ? "item" :
      this.matches(".shop-decision") ? "decision" : this.matches(".shop-panel > header") ? "header" : "";
    if (target) targets.push(target);
    const height = target ? 80 : 0;
    return { top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each((["baby", "growing", "adult"] as const).flatMap(stage => [false, true].map(sleeping => ({ stage, sleeping }))))
  ("$stage sleeping=$sleeping locates directory, all categories, items, wrap and return without writes", async ({ stage, sleeping }) => {
    await mount(stage, sleeping); const before = structuredClone(saved), preferences = JSON.stringify(localStorage);
    const focus = document.querySelector<HTMLButtonElement>(".button-c")!; focus.focus();
    await directory(); let calls = 1;
    expect(window.scrollBy).toHaveBeenCalledTimes(calls); expect(targets.at(-1)).toBe("section");
    for (const section of shopSections.slice(1)) {
      await key("a"); calls++; expect(document.querySelector('.shop-sections [aria-current="true"]')?.getAttribute("data-section")).toBe(section.id);
      expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("b"); calls++; expect(targets.at(-1)).toBe("item"); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("a"); calls++; expect(window.scrollBy).toHaveBeenCalledTimes(calls); expect(targets.at(-1)).toBe("item");
      await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      await key("c"); calls++; expect(targets.at(-1)).toBe("section"); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
      expect(document.activeElement).toBe(focus);
    }
    await key("a"); calls++; expect(window.scrollBy).toHaveBeenCalledTimes(calls);
    expect(document.querySelector('.shop-sections [aria-current="true"]')?.getAttribute("data-section")).toBe("daily");
    await key("c"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(calls);
    before.revision = saved.revision; expect(saved).toEqual(before); expect(writes()).toHaveLength(0); expect(JSON.stringify(localStorage)).toBe(preferences);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  });
it.each(["a", "c"])("locates the quote then returns to the same item when %s cancels", async cancel => {
  await mount(); await items(); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  await key("b"); expect(targets.at(-1)).toBe("decision"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  expect(document.querySelector(".shop-decision")?.textContent).toContain("确认花 12 金币购买「嫩叶胸针」");
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  await key(cancel); expect(targets.at(-1)).toBe("item"); expect(window.scrollBy).toHaveBeenCalledTimes(5);
  expect(document.querySelector(".shop-panel h3")?.textContent).toContain("嫩叶胸针");
  expect(document.querySelector(".shop-panel")?.getAttribute("data-confirm")).toBe("false"); expect(writes()).toHaveLength(0);
});
it.each(["poor", "sleeping", "daily", "wallet"])("explicit B reveals %s decision without buying or claiming", async kind => {
  await mount("baby", kind === "sleeping"); if (kind === "poor") { saved.economy!.coins = 0; await refresh(); }
  if (kind === "daily") { saved.economy!.lastDailyAt = Date.now(); await refresh(); await directory(); }
  else if (kind === "wallet") { shop.maxCoins = 100; saved.economy!.coins = 99; await refresh(); await directory(); }
  else await items();
  const count = vi.mocked(window.scrollBy).mock.calls.length;
  await key("b"); expect(targets.at(-1)).toBe("decision"); expect(window.scrollBy).toHaveBeenCalledTimes(count + 1);
  expect(writes()).toHaveLength(0);
});
it("does not relocate visible targets; the next explicit input can locate below the viewport", async () => {
  await mount(); top = 20; await items(); await key("b"); expect(window.scrollBy).not.toHaveBeenCalled();
  top = 1000; await key("c"); expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 988, behavior: "instant" });
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
});
it("keeps stable item IDs and quotes on reads/reorders without moving or repeating a confirmed purchase", async () => {
  await mount(); await items(); await key("b"); const count = vi.mocked(window.scrollBy).mock.calls.length;
  shop.catalog.reverse(); await refresh(); expect(document.querySelector(".shop-panel h3")?.textContent).toContain("嫩叶胸针");
  expect(window.scrollBy).toHaveBeenCalledTimes(count); expect(writes()).toHaveLength(0);
  api.mockImplementation(async (path, body) => {
    if (path === "action") { expect(body).toEqual(expect.objectContaining({ kind: "buy", item: "leaf-pin" })); saved.economy!.coins -= 12; saved.economy!.owned.push("leaf-pin"); saved.revision++; }
    return response();
  });
  await key("b"); expect(writes()).toHaveLength(1); expect(saved.economy!.coins).toBe(88);
  await refresh(); expect(writes()).toHaveLength(1); expect(window.scrollBy).toHaveBeenCalledTimes(count);
});
it.each(["price", "removed", "empty", "sleeping"])("ordinary %s changes cancel/reconcile intent but never scroll", async kind => {
  await mount(); await items(); await key("b"); const count = vi.mocked(window.scrollBy).mock.calls.length;
  if (kind === "price") shop.catalog[0].price++;
  if (kind === "removed") shop.catalog.shift();
  if (kind === "empty") shop.catalog = [];
  if (kind === "sleeping") saved.sleeping = true;
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(count); expect(writes()).toHaveLength(0);
  expect(document.querySelector(".shop-panel")?.getAttribute("data-confirm")).toBe("false");
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(count + 1); expect(targets.at(-1)).toBe("item");
});
it("polling, help close and foregrounding do not replay a location", async () => {
  await mount(); await items(); const count = vi.mocked(window.scrollBy).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await refresh(); await act(async () => { await vi.advanceTimersByTimeAsync(17000); });
  Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh();
  expect(window.scrollBy).toHaveBeenCalledTimes(count); expect(writes()).toHaveLength(0);
});
it("consumes hidden navigation instead of replaying it on return", async () => {
  await mount(); await directory(); Object.defineProperty(document, "hidden", { configurable: true, value: true }); await refresh();
  await key("a"); await key("b"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false }); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it.each(["directory", "item", "quote"])("save replacement never replays a stale %s destination", async where => {
  await mount(); await directory(); if (where !== "directory") { await key("a"); await key("b"); } if (where === "quote") await key("b");
  const count = vi.mocked(window.scrollBy).mock.calls.length; generation = "b".repeat(32); saved.revision = 0; await refresh();
  expect(document.querySelector(".home-caption")).toBeTruthy(); expect(window.scrollBy).toHaveBeenCalledTimes(count);
  await directory(); expect(window.scrollBy).toHaveBeenCalledTimes(count + 1); expect(writes()).toHaveLength(0);
});
it("offline recovery does not replay navigation; old service identity still supports explicit browsing", async () => {
  await mount(); delete saved.growth; saved.schema = 1; generation = undefined; await refresh();
  await items(); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  api.mockRejectedValueOnce(new Error("offline")); await refresh(); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(3);
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(4); expect(writes()).toHaveLength(0);
});
it("old service without an economy locates its explanation header and remains read-only", async () => {
  await mount(); delete saved.economy; delete saved.growth; generation = undefined; await refresh();
  await directory(); expect(targets.at(-1)).toBe("header"); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".shop-panel")?.textContent).toContain("小店还没开门");
  await key("a"); expect(window.scrollBy).toHaveBeenCalledTimes(2); await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(2);
  expect(writes()).toHaveLength(0);
});
it("explicit equipment toggles locate their feedback while later reads never replay the toggle", async () => {
  await mount(); saved.economy!.owned = ["leaf-pin"]; await refresh(); await items();
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      expect(body).toEqual(expect.objectContaining({ kind: "equip", item: "leaf-pin" }));
      saved.economy!.equipped.accessory = saved.economy!.equipped.accessory ? "" : "leaf-pin"; saved.revision++;
    }
    return response();
  });
  await key("b"); expect(targets.at(-1)).toBe("decision"); expect(window.scrollBy).toHaveBeenCalledTimes(4);
  expect(document.querySelector(".shop-decision")?.textContent).toContain("使用中");
  await refresh(); expect(window.scrollBy).toHaveBeenCalledTimes(4); expect(writes()).toHaveLength(1);
  await key("b"); expect(targets.at(-1)).toBe("decision"); expect(window.scrollBy).toHaveBeenCalledTimes(5);
  expect(saved.economy!.coins).toBe(100); expect(writes()).toHaveLength(2);
});
