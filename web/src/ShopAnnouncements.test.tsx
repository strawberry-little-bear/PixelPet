import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import type { PetState, Shop } from "./types";

const now = Date.UTC(2026, 9, 25, 3);
const pet = (): PetState => ({ schema: 22, revision: 1, species: 2, name: "慢慢挑",
  createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now, sleeping: false,
  needs: { hunger: 80, clean: 80, mood: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"),
  economy: { coins: 50, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } } });
const shop: Shop = { maxCoins: 1000000, dailyCoins: 10, gameDailyLimit: 30, catalog: [
  { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一片小叶子" },
  { id: "blue-bow", name: "蓝色蝴蝶结", slot: "accessory", price: 12, description: "小小的蝴蝶结" },
] };
const status = () => document.querySelector<HTMLElement>(".shop-decision")!;
afterEach(cleanup);

it("announces the selected item even when its price and available action are unchanged", () => {
  const saved = pet(), original = structuredClone(saved);
  const props = { pet: saved, shop, page: 0, category: "accessory" as const, confirm: false, now };
  const view = render(<ShopPanel {...props} />), node = status();
  expect(node.textContent).toContain("宠物装扮，第 1 / 2 件，嫩叶胸针");
  expect(node.textContent).toContain("12 金币"); expect(node.textContent).toContain("B 购买");
  view.rerender(<ShopPanel {...props} page={1} />);
  expect(status()).toBe(node); expect(node.textContent).toContain("第 2 / 2 件，蓝色蝴蝶结");
  expect(node.textContent).not.toContain("嫩叶胸针");
  expect(node.getAttribute("aria-live")).toBe("polite"); expect(node.getAttribute("aria-atomic")).toBe("true");
  expect(document.querySelectorAll(".shop-panel [role=status]")).toHaveLength(1);
  expect(document.querySelectorAll(".shop-panel button,.shop-panel input,.shop-panel a,[role=button]")).toHaveLength(0);
  expect(saved).toEqual(original);
});
it("announces directory position, category and controls on the same live region", () => {
  const props = { pet: pet(), shop, page: 0, confirm: false, now };
  const view = render(<ShopPanel {...props} />), node = status();
  expect(node.textContent).toContain("第 1 / 8 项，今日问候"); expect(node.textContent).toContain("B 收下 10 金币");
  view.rerender(<ShopPanel {...props} page={1} />);
  expect(status()).toBe(node); expect(node.textContent).toContain("第 2 / 8 项，全部物品");
  expect(node.textContent).toContain("A 换分类"); expect(node.textContent).toContain("C 回小窝");
  view.rerender(<ShopPanel {...props} page={7} />);
  expect(status()).toBe(node); expect(node.textContent).toContain("第 8 / 8 项，已拥有");
});
it("does not mutate or replace the announcement during an ordinary needs and balance read", async () => {
  const saved = pet(), props = { pet: saved, shop, page: 0, category: "all" as const, confirm: false, now };
  const view = render(<ShopPanel {...props} />), node = status(), text = node.textContent;
  expect(text).toContain("嫩叶胸针");
  const changes: MutationRecord[] = [], observer = new MutationObserver(records => changes.push(...records));
  observer.observe(node, { subtree: true, childList: true, characterData: true });
  await act(async () => view.rerender(<ShopPanel {...props} now={now + 15000}
    pet={{ ...saved, revision: 2, lastTick: now + 15000, needs: { ...saved.needs, hunger: 79 }, economy: { ...saved.economy!, coins: 49 } }}
    shop={structuredClone(shop)} />));
  observer.disconnect(); expect(status()).toBe(node); expect(node.textContent).toBe(text); expect(changes).toEqual([]);
});
it("keeps the item identity when confirming, owning, wearing and sleeping change the available action", () => {
  const saved = pet(), props = { pet: saved, shop, page: 0, category: "all" as const, confirm: false, now };
  const view = render(<ShopPanel {...props} />), node = status();
  view.rerender(<ShopPanel {...props} confirm />); expect(node.textContent).toContain("确认花 12 金币");
  expect(node.querySelector(".sr-only")?.textContent).toContain("A / C ");
  expect(node.querySelector(".sr-only")?.textContent).not.toContain("A \u4e0b\u4e00\u4ef6");
  saved.economy!.owned.push("leaf-pin"); view.rerender(<ShopPanel {...props} />);
  expect(node.textContent).toContain("已拥有"); expect(node.textContent).toContain("B 使用");
  saved.economy!.equipped.accessory = "leaf-pin"; view.rerender(<ShopPanel {...props} />);
  expect(node.textContent).toContain("使用中 · B 收起来");
  saved.sleeping = true; view.rerender(<ShopPanel {...props} />);
  expect(status()).toBe(node); expect(node.textContent).toContain("嫩叶胸针");
  expect(node.textContent).toContain("安心睡"); expect(node.textContent).not.toContain("B 收起来");
});
it("announces an empty category without inventing a selected item, and omits selection when the shop is unavailable", () => {
  const props = { pet: pet(), shop, page: 0, category: "owned" as const, confirm: false, now };
  const view = render(<ShopPanel {...props} />);
  expect(status().textContent).toContain("已拥有，暂无物品");
  expect(status().textContent).toContain("C 返回分类"); expect(status().textContent).not.toMatch(/第 1 \/ 0|嫩叶胸针/);
  view.rerender(<ShopPanel {...props} shop={null} />);
  expect(document.querySelector(".shop-decision")).toBeNull();
});
