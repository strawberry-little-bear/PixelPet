import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { QuietMoment } from "./QuietMoment";
import type { Memory, PetState, Result, Shop, ShopItem } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const at = Date.UTC(2026, 9, 24, 2);
const items: ShopItem[] = [
  { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "小叶子" },
  { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "小盆栽" },
  { id: "meadow-wall", name: "小叶墙纸", slot: "wallpaper", price: 18, description: "小花纹" },
  { id: "honey-floor", name: "蜂蜜木地板", slot: "floor", price: 18, description: "小木纹" },
];
const kinds = ["outfit", "decoration", "wallpaper", "floor"] as const;
const catalog = (): Shop => ({ maxCoins: 1000000, dailyCoins: 10, gameDailyLimit: 30, catalog: structuredClone(items) });
const pet = (kind: Memory["kind"] = "outfit", item = "leaf-pin"): PetState => ({
  schema: 19, revision: 1, species: 2, name: "回忆伙伴", createdAt: at - 3600000, hatchedAt: at - 3600000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0,
  logs: [], growth: { ...emptyGrowth("adult"), form: "gentle" },
  economy: { coins: 8, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [...items.map(i => i.id), "berry-scarf"],
    equipped: { accessory: "berry-scarf", room: "", wallpaper: "", floor: "" } },
  album: { since: at - 3600000, legacy: false, entries: [{ kind, item, at: at - 1000, source: "shared" }] },
});
const copy = () => document.querySelector(".quiet-moment-copy > p")?.textContent ?? "";
const memoryKey = (saved: PetState) => `${saved.album!.entries[0].kind}:${saved.album!.entries[0].at}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(kinds)("recalls the saved %s item after it has been changed or put away", kind => {
  const item = items[kinds.indexOf(kind)], saved = pet(kind, item.id), shop = catalog();
  const before = structuredClone({ saved, shop });
  const { container } = render(<QuietMoment pet={saved} shop={shop} choice={2} replied memoryKey={memoryKey(saved)} />);
  expect(copy()).toContain(`「${item.name}」`);
  expect(copy()).not.toMatch(/草莓围巾|berry-scarf|今天|刚才|正在穿/);
  expect(container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
  expect({ saved, shop }).toEqual(before);
});
it.each(["no catalog", "removed item", "wrong slot", "missing id", "empty name", "blank name"])("keeps the generic recollection when the saved name is unavailable: %s", scenario => {
  const saved = pet(), shop = catalog();
  if (scenario === "removed item") shop.catalog = [];
  if (scenario === "wrong slot") shop.catalog[0].slot = "room";
  if (scenario === "missing id") delete saved.album!.entries[0].item;
  if (scenario === "empty name") shop.catalog[0].name = "";
  if (scenario === "blank name") shop.catalog[0].name = "   ";
  render(<QuietMoment pet={saved} shop={scenario === "no catalog" ? null : shop} choice={2} replied memoryKey={memoryKey(saved)} />);
  expect(copy()).toContain("记得你挑小装扮时的心意");
  expect(copy()).not.toMatch(/嫩叶|草莓|leaf-pin|berry-scarf|undefined/);
  expect(document.querySelector(".quiet-memory-source")).not.toBeNull();
});
it("does not turn unrelated item fields or old saved-only memories into a named shared conversation", () => {
  const saved = pet("meal"), shop = catalog();
  const { rerender } = render(<QuietMoment pet={saved} shop={shop} choice={2} replied memoryKey={memoryKey(saved)} />);
  expect(copy()).toContain("一起吃饭"); expect(copy()).not.toContain("嫩叶");
  saved.album!.entries[0] = { kind: "outfit", item: "leaf-pin", source: "saved", at: at - 1000 };
  rerender(<QuietMoment pet={saved} shop={shop} choice={2} replied memoryKey={memoryKey(saved)} />);
  expect(copy()).toContain("你好呀"); expect(document.querySelector(".quiet-memory-source")).toBeNull();
});
it("keeps bedtime company asleep without recalling clothing", () => {
  const saved = { ...pet(), sleeping: true };
  render(<QuietMoment pet={saved} shop={catalog()} choice={2} replied memoryKey={memoryKey(saved)} />);
  expect(copy()).toContain("甜甜地睡着"); expect(copy()).not.toContain("嫩叶");
  expect(document.querySelector(".quiet-memory-source")).toBeNull();
});
it("updates the selected recollection from server catalog names without switching to current equipment", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const saved = pet(), shop = catalog();
  api.mockReset();
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), shop: structuredClone(shop), serverTime: at, message: "" }));
  await act(async () => { render(<App />); });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  await key("a"); for (let n = 0; n < 12; n++) await key("a"); await key("b");
  await key("a"); await key("a"); await key("b");
  expect(copy()).toContain("「嫩叶胸针」");
  shop.catalog[0].name = "服务端的新名字"; saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(copy()).toContain("「服务端的新名字」");
  expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("第一次选好小装扮");
  shop.catalog = []; saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(copy()).toContain("记得你挑小装扮时的心意");
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
