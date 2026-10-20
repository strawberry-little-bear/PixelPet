import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import type { PetState, Shop } from "./types";

const now = Date.UTC(2026, 9, 20, 12);
const rules: Shop = { dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000, catalog: [
  { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一片叶子" },
  { id: "berry-scarf", name: "草莓围巾", slot: "accessory", price: 18, description: "柔软围巾" },
  { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "窗边一点绿" },
  { id: "meadow-wall", name: "小叶墙纸", slot: "wallpaper", price: 18, description: "一面墙" },
  { id: "mint-floor", name: "薄荷方砖", slot: "floor", price: 22, description: "一片地板" },
] };
const pet = (): PetState => ({ schema: 9, revision: 1, species: 2, name: "看清数量", createdAt: now - 3600000,
  hatchedAt: now - 3600000, lastTick: now, sleeping: false,
  needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
  economy: { coins: 100, gameCoins: 0, lastGameAt: 0, lastDailyAt: 0, owned: ["leaf-pin"], equipped: { accessory: "", room: "" } } });
const quantity = (section: string) => document.querySelector(`[data-section="${section}"] .shop-quantity`);
afterEach(cleanup);

describe("shop categories keep quantities distinct from labels", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])("shows truthful currency/item units with selection %i, without mutating saves", page => {
    const p = pet(), before = JSON.stringify({ p, rules });
    render(<ShopPanel pet={p} shop={rules} now={now} page={page} confirm={false} />);
    expect(quantity("daily")?.textContent).toBe("+10 币");
    for (const [id, count] of [["all", 5], ["accessory", 2], ["room", 1], ["wallpaper", 1], ["floor", 1], ["owned", 1]]) {
      expect(quantity(String(id))?.textContent).toBe(`${count} 件`);
    }
    expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(7);
    expect(document.querySelectorAll('.shop-sections [aria-current="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('.shop-sections button,.shop-sections a,.shop-sections [role="button"]')).toHaveLength(0);
    expect(JSON.stringify({ p, rules })).toBe(before);
  });
  it("updates ownership counts only from the new saved state, not from preview or confirmation", () => {
    const p = pet(), view = render(<ShopPanel pet={p} shop={rules} now={now} page={6} confirm={false} />);
    expect(quantity("owned")?.textContent).toBe("1 件");
    view.rerender(<ShopPanel pet={p} shop={rules} now={now} page={0} category="accessory" confirm />);
    expect(p.economy?.owned).toEqual(["leaf-pin"]);
    const bought = structuredClone(p); bought.economy!.owned.push("berry-scarf"); bought.economy!.coins -= 18;
    view.rerender(<ShopPanel pet={bought} shop={rules} now={now} page={6} confirm={false} />);
    expect(quantity("owned")?.textContent).toBe("2 件"); expect(quantity("all")?.textContent).toBe("5 件");
    expect(p.economy!.owned).toHaveLength(1);
  });
  it("keeps zero counts explicit and uses the current server's greeting amount", () => {
    render(<ShopPanel pet={pet()} shop={{ ...rules, catalog: [], dailyCoins: 12 }} now={now} page={0} confirm={false} />);
    expect(quantity("daily")?.textContent).toBe("+12 币");
    for (const id of ["all", "accessory", "room", "wallpaper", "floor", "owned"]) expect(quantity(id)?.textContent).toBe("0 件");
  });
  it("does not require a modern wallet cap to explain existing legacy categories", () => {
    render(<ShopPanel pet={pet()} shop={{ ...rules, maxCoins: undefined }} now={now} page={0} confirm={false} />);
    expect(quantity("daily")?.textContent).toBe("+10 币"); expect(quantity("all")?.textContent).toBe("5 件");
  });
  it.each(["rules", "economy"])("does not make up categories without %s", missing => {
    const p = pet(); if (missing === "economy") p.economy = undefined;
    render(<ShopPanel pet={p} shop={missing === "rules" ? null : rules} now={now} page={0} confirm={false} />);
    expect(document.querySelectorAll('.shop-quantity')).toHaveLength(0);
  });
});
