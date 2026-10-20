import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dailyClaimed, ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import { shopItems, shopSections } from "./shop";
import { PetScene } from "./PetScene";
import { RoomSurfaceArt } from "./EquipmentArt";
import { PetArt } from "./PetArt";
import { AlbumPanel, memoryWords } from "./AlbumPanel";
import type { GrowthStage, PetState, Shop } from "./types";

const now = Date.UTC(2026, 9, 18, 23, 59, 59);
const pet = (): PetState => ({ schema: 4, revision: 1, species: 2, name: "草莓兔", createdAt: now - 2000, hatchedAt: now - 1000, lastTick: now, sleeping: false, needs: { hunger: 80, clean: 80, mood: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"), economy: { coins: 10, lastDailyAt: now, lastGameAt: now, gameCoins: 8, owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "" } } });
const shop: Shop = { maxCoins: 1000000, dailyCoins: 10, gameDailyLimit: 30, catalog: [{ id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一小片春天" }] };
afterEach(cleanup);
describe("shop rules and saved visual equipment", () => {
  it("uses UTC boundaries rather than the browser's local date, with no catchup", () => {
    const p = pet();
    expect(dailyClaimed(p, now)).toBe(true);
    expect(dailyClaimed(p, now + 1000)).toBe(false);
    expect(dailyClaimed(p, now + 10 * 86400000)).toBe(false);
    expect(dailyClaimed(p, now - 86400000)).toBe(true);
  });
  it("shows the true remaining daily game allowance and resets only its display on a new day", () => {
    const p = pet();
    const { rerender } = render(<ShopPanel pet={p} shop={shop} page={0} now={now} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 22 币")).toBeTruthy();
    rerender(<ShopPanel pet={p} shop={shop} page={0} now={now + 1000} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 30 币")).toBeTruthy();
    rerender(<ShopPanel pet={p} shop={shop} page={0} now={now - 86400000} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 0 币")).toBeTruthy();
    expect(p.economy!.coins).toBe(10);
    expect(p.economy!.gameCoins).toBe(8);
  });
  it("limits displayed earnings by wallet capacity and does not invent an old server cap", () => {
    const p = pet(); p.economy!.coins = 999998;
    const { rerender } = render(<ShopPanel pet={p} shop={shop} page={0} now={now} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 2 币")).toBeTruthy();
    p.economy!.coins = 1000000;
    rerender(<ShopPanel pet={p} shop={shop} page={0} now={now} confirm={false} />);
    expect(screen.getByText("钱包已满")).toBeTruthy();
    rerender(<ShopPanel pet={p} shop={{ ...shop, maxCoins: undefined }} page={0} now={now} confirm={false} />);
    expect(screen.getByText("今日游戏额度 22 币")).toBeTruthy();
  });
  it("renders all 10 species and all three stages with a single non-duplicated accessory", () => {
    for (let index = 0; index < 10; index++) for (const stage of ["baby", "growing", "adult"] as GrowthStage[]) {
      for (const accessory of ["leaf-pin", "berry-scarf", "star-badge", "sunflower-pin", "sky-bow"]) {
        const view = render(<PetArt index={index} stage={stage} accessory={accessory} />);
        expect(view.container.querySelectorAll(".pet-sprite")).toHaveLength(1);
        expect(view.container.querySelectorAll(".equipped-accessory")).toHaveLength(1);
        expect(view.container.querySelector(".equipped-accessory")?.getAttribute("data-item")).toBe(accessory);
        view.unmount();
      }
    }
  });
  it("shows the original saved accessory in a memory even after equipment was replaced", () => {
    const p = pet();
    p.economy!.equipped.accessory = "star-badge";
    p.album = { since: p.createdAt, legacy: false, entries: [{ kind: "outfit", at: now, source: "shared", item: "leaf-pin" }] };
    render(<AlbumPanel pet={p} now={now} page={1} />);
    expect(document.querySelector('.album-picture [data-item="leaf-pin"]')).not.toBeNull();
    expect(document.querySelector('.album-picture [data-item="star-badge"]')).toBeNull();
    expect(memoryWords(p.album.entries[0], false)?.title).toBe("第一次选好小装扮");
  });
});


describe("three-key categorized shop previews", () => {
  const rules: Shop = { ...shop, catalog: [...shop.catalog,
    { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "一个摆件" },
    { id: "meadow-wall", name: "小叶墙纸", slot: "wallpaper", price: 18, description: "独立墙纸" },
    { id: "mint-floor", name: "薄荷方砖", slot: "floor", price: 22, description: "独立地板" },
  ] };
  it("filters server catalog without reordering or mutating it", () => {
    const p = pet();
    const before = JSON.stringify({ rules, p });
    expect(shopItems(rules, p, "all")).toEqual(rules.catalog);
    for (const slot of ["accessory", "room", "wallpaper", "floor"] as const) {
      expect(shopItems(rules, p, slot)).toEqual(rules.catalog.filter(i => i.slot === slot));
    }
    expect(shopItems(rules, p, "owned").map(i => i.id)).toEqual(["leaf-pin"]);
    expect(shopItems(null, p, "all")).toEqual([]);
    expect(JSON.stringify({ rules, p })).toBe(before);
  });
  it("offers seven non-clickable categories with real counts", () => {
    render(<ShopPanel pet={pet()} shop={rules} page={4} now={now} confirm={false} />);
    expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(7);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("墙纸");
    expect(document.querySelector('[data-section="all"] small')?.textContent).toBe("4 件");
    expect(document.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    expect(shopSections.map(s => s.id)).toContain("owned");
  });
  it("shows an empty owned filter with no fake purchase or daily action", () => {
    const p = pet(); p.economy!.owned = []; p.economy!.equipped.accessory = "";
    render(<ShopPanel pet={p} shop={rules} category="owned" page={0} now={now} confirm={false} />);
    expect(screen.getByText("这里还空着呢")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("C 返回分类");
    expect(screen.queryByText(/B 购买/)).toBeNull();
  });
  it("previews just the selected slot, preserving furniture, accessory and saved state", () => {
    const p = pet(); p.economy!.equipped = { accessory: "sky-bow", room: "clover-pot", floor: "mint-floor" };
    const before = JSON.stringify(p);
    render(<ShopPanel pet={p} shop={rules} category="wallpaper" page={0} now={now} confirm={false} />);
    for (const id of ["sky-bow", "clover-pot", "mint-floor", "meadow-wall"]) {
      expect(document.querySelectorAll(`.shop-preview [data-item="${id}"]`)).toHaveLength(1);
    }
    expect(screen.getByText("实景预览 · 尚未购买")).toBeTruthy();
    expect(JSON.stringify(p)).toBe(before);
  });
  it("keeps all four cosmetic slots on sleep and bath scenes without moving occlusion", () => {
    for (const motion of ["sleeping", "bathing"] as const) {
      const view = render(<PetScene index={3} stage="adult" form="gentle" motion={motion} clipId={0} dirty={false} equipped={{ accessory: "sky-bow", room: "clover-pot", wallpaper: "starlit-wall", floor: "honey-floor" }} />);
      expect(view.container.querySelectorAll('.scene-environment [data-item]')).toHaveLength(3);
      expect(view.container.querySelectorAll('.pet-actor-window .equipped-accessory')).toHaveLength(1);
      expect(view.container.querySelectorAll('.pet-actor .room-surface')).toHaveLength(0);
      view.unmount();
    }
  });
  it("gives coexisting pattern previews unique IDs and rejects unknown surface art", () => {
    const view = render(<><RoomSurfaceArt id="meadow-wall" /><RoomSurfaceArt id="meadow-wall" /><RoomSurfaceArt id="fake" /></>);
    const patterns = [...view.container.querySelectorAll('pattern')];
    expect(patterns).toHaveLength(2);
    expect(patterns[0].id).not.toBe(patterns[1].id);
  });
  it.each(["wallpaper", "floor"] as const)("preserves the actual first %s pattern in memory", kind => {
    const p = pet();
    const id = kind === "wallpaper" ? "meadow-wall" : "honey-floor";
    p.economy!.equipped[kind] = kind === "wallpaper" ? "starlit-wall" : "mint-floor";
    p.album = { since: p.createdAt, legacy: false, entries: [{ kind, at: now, source: "shared", item: id }] };
    render(<AlbumPanel pet={p} now={now} page={1} />);
    expect(document.querySelector(`.album-picture [data-item="${id}"]`)).not.toBeNull();
    expect(memoryWords(p.album.entries[0], false)?.title).toBeTruthy();
  });
});
