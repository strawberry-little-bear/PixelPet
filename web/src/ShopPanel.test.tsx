import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dailyClaimed, ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import { isSeasonalItem, shopItems, shopSections } from "./shop";
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
  it.each(["accessory", "room", "wallpaper", "floor"] as const)("explains the affordable %s purchase before committing, without mutating the preview", slot => {
    const p = pet(); p.economy!.owned = []; p.economy!.coins = 30;
    const catalog = { ...shop, catalog: [{ ...shop.catalog[0], slot }] };
    const before = JSON.stringify(p);
    const props = { pet: p, shop: catalog, category: "all" as const, page: 0, now };
    const { rerender } = render(<ShopPanel {...props} confirm={false} />);
    expect(screen.queryByText(/购买后剩/)).toBeNull();
    rerender(<ShopPanel {...props} confirm />);
    expect(screen.getByRole("status").textContent).toContain("按当前余额，购买后剩 18 金币。");
    expect(screen.getByRole("status").textContent).toContain("仅购买，不会自动使用；购买成功后，再按 B 使用。");
    expect(screen.getByText("仅预览 · 未购买")).toBeTruthy();
    expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(JSON.stringify(p)).toBe(before);
    p.economy!.coins = 12;
    rerender(<ShopPanel {...props} confirm />);
    expect(screen.getByRole("status").textContent).toContain("购买后剩 0 金币");
    rerender(<ShopPanel {...props} confirm={false} />);
    expect(screen.queryByText(/购买后剩/)).toBeNull();
  });
  it.each(["sleeping", "owned", "insufficient"])("does not promise a purchase for an unavailable %s confirmation", reason => {
    const p = pet(); p.economy!.owned = []; p.economy!.coins = 30;
    if (reason === "sleeping") p.sleeping = true;
    if (reason === "owned") p.economy!.owned = ["leaf-pin"];
    if (reason === "insufficient") p.economy!.coins = 11;
    render(<ShopPanel pet={p} shop={shop} category="all" page={0} now={now} confirm />);
    expect(screen.queryByText(/购买后剩/)).toBeNull();
    expect(screen.queryByText(/仅购买，不会自动使用/)).toBeNull();
  });
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
    { id: "autumn-wall", name: "秋叶墙纸", slot: "wallpaper", price: 26, description: "秋天的墙" },
    { id: "winter-floor", name: "雪夜地毯", slot: "floor", price: 28, description: "冬天的地面" },
    { id: "spring-vase", name: "春枝花瓶", slot: "room", price: 18, description: "全年可选的春花" },
    { id: "summer-shell", name: "海边贝壳", slot: "room", price: 20, description: "全年可选的贝壳" },
  ] };
  it("filters server catalog without reordering or mutating it", () => {
    const p = pet();
    const before = JSON.stringify({ rules, p });
    expect(shopItems(rules, p, "all")).toEqual(rules.catalog);
    for (const slot of ["accessory", "room", "wallpaper", "floor"] as const) {
      expect(shopItems(rules, p, slot)).toEqual(rules.catalog.filter(i => i.slot === slot));
    }
    expect(shopItems(rules, p, "seasonal").map(i => i.id)).toEqual(["autumn-wall", "winter-floor", "spring-vase", "summer-shell"]);
    expect(shopItems(rules, p, "owned").map(i => i.id)).toEqual(["leaf-pin"]);
    expect(isSeasonalItem("autumn-wall")).toBe(true);
    expect(isSeasonalItem("mint-floor")).toBe(false);
    expect(shopItems(null, p, "all")).toEqual([]);
    expect(JSON.stringify({ rules, p })).toBe(before);
  });
  it("offers eight non-clickable categories with real counts", () => {
    render(<ShopPanel pet={pet()} shop={rules} page={5} now={now} confirm={false} />);
    expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(8);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("墙纸");
    expect(document.querySelector('[data-section="all"] small')?.textContent).toBe("8 件");
    expect(document.querySelector('[data-section="seasonal"] small')?.textContent).toBe("4 件");
    expect(document.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    expect(shopSections.map(s => s.id)).toContain("owned");
  });
  it("labels seasonal items without turning the theme into a new action", () => {
    render(<ShopPanel pet={pet()} shop={rules} category="seasonal" page={0} now={now} confirm={false} />);
    expect(screen.getByText("季节主题 · 只影响小窝视觉")).toBeTruthy();
    expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
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
    expect(screen.getByText("仅预览 · 未购买")).toBeTruthy();
    expect(JSON.stringify(p)).toBe(before);
  });
  it.each(rules.catalog)("distinguishes preview, purchase and saved use for $slot", item => {
    const p = pet(); p.economy!.owned = []; p.economy!.equipped = { accessory: "", room: "" };
    const props = { shop: rules, category: "all" as const, page: rules.catalog.indexOf(item), now, confirm: false };
    const { rerender } = render(<ShopPanel {...props} pet={p} />);
    const caption = () => document.querySelector(".shop-preview small")!;
    expect(caption().textContent).toBe("仅预览 · 未购买");
    expect(caption().closest('[aria-hidden="true"]')).toBeNull();
    rerender(<ShopPanel {...props} pet={p} confirm />);
    expect(caption().textContent).toBe("仅预览 · 未购买");
    p.economy!.owned.push(item.id);
    rerender(<ShopPanel {...props} pet={p} />);
    expect(caption().textContent).toBe("仅预览 · 未使用");
    p.economy!.equipped[item.slot] = item.id;
    rerender(<ShopPanel {...props} pet={p} />);
    expect(caption().textContent).toBe("使用中 · 已保存");
    expect(screen.getByRole("status").querySelector(".shop-action")?.textContent).toBe("使用中 · B 收起来");
    p.economy!.equipped[item.slot] = "";
    const before = JSON.stringify(p);
    rerender(<ShopPanel {...props} pet={p} />);
    expect(caption().textContent).toBe("仅预览 · 未使用");
    // Removing an item keeps its free preview, not its saved use.
    expect(document.querySelector(`.shop-preview [data-item="${item.id}"]`)).not.toBeNull();
    expect(JSON.stringify(p)).toBe(before);
  });
  it("shows saved equipment in the directory and an empty owned filter without calling it a trial", () => {
    const p = pet();
    const { rerender } = render(<ShopPanel pet={p} shop={rules} page={0} now={now} confirm={false} />);
    expect(screen.getByText("当前小窝 · 装扮不影响成长")).toBeTruthy();
    expect(document.querySelector('.shop-preview [data-item="leaf-pin"]')).not.toBeNull();
    p.economy!.owned = []; p.economy!.equipped.accessory = "";
    rerender(<ShopPanel pet={p} shop={rules} category="owned" page={0} now={now} confirm={false} />);
    expect(screen.getByText("当前小窝 · 装扮不影响成长")).toBeTruthy();
    expect(document.querySelector('.shop-preview [data-item="leaf-pin"]')).toBeNull();
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
    const view = render(<><RoomSurfaceArt id="meadow-wall" /><RoomSurfaceArt id="autumn-wall" /><RoomSurfaceArt id="winter-floor" /><RoomSurfaceArt id="meadow-wall" /><RoomSurfaceArt id="fake" /></>);
    const patterns = [...view.container.querySelectorAll('pattern')];
    expect(patterns).toHaveLength(4);
    expect(patterns[0].id).not.toBe(patterns[1].id);
    expect(view.container.querySelector('.surface-autumn-wall.surface-wallpaper')).not.toBeNull();
    expect(view.container.querySelector('.surface-winter-floor.surface-floor')).not.toBeNull();
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
