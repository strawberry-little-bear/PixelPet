import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
import { validCoreResponse } from "./response";

const at = Date.parse("2026-10-20T08:00:00Z");
const economy = { coins: 40, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0,
  owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "", wallpaper: "", floor: "" } };
const item = { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一片小叶子" };
const shop = { dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000, catalog: [item] };
function reply() {
  return { state: { schema: 17, revision: 2, species: 2, name: "草莓兔", sleeping: false,
    createdAt: at - 2000, hatchedAt: at - 1000, lastTick: at, careCount: 0,
    needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, logs: [], economy: structuredClone(economy) },
    shop: structuredClone(shop), serverTime: at, message: "" };
}
const invalid: [string, (r: ReturnType<typeof reply>) => void][] = [];
for (const value of [[], "wallet", 1, true]) invalid.push([`economy ${JSON.stringify(value)}`, r => { Object.assign(r.state, { economy: value }); }]);
for (const key of ["coins", "gameCoins", "lastDailyAt", "lastGameAt"] as const) {
  for (const value of [undefined, null, {}, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    invalid.push([`economy.${key} ${String(value)}`, r => { Object.assign(r.state.economy, { [key]: value }); }]);
  }
}
for (const value of [{}, "leaf-pin", [null], [{}], [1]]) invalid.push([`owned ${JSON.stringify(value)}`, r => { Object.assign(r.state.economy, { owned: value }); }]);
for (const value of [undefined, null, [], "equipment"]) invalid.push([`equipped ${String(value)}`, r => { Object.assign(r.state.economy, { equipped: value }); }]);
for (const key of ["accessory", "room", "wallpaper", "floor"] as const) {
  for (const value of [null, {}, 1]) invalid.push([`equipped.${key} ${JSON.stringify(value)}`, r => { Object.assign(r.state.economy.equipped, { [key]: value }); }]);
}
for (const value of [[], "shop", true]) invalid.push([`shop ${JSON.stringify(value)}`, r => { Object.assign(r, { shop: value }); }]);
for (const key of ["dailyCoins", "gameDailyLimit", "maxCoins"] as const) {
  for (const value of [null, {}, -1, 1.5, Infinity]) invalid.push([`shop.${key} ${String(value)}`, r => { Object.assign(r.shop, { [key]: value }); }]);
}
for (const value of [{}, "catalog", [null], [{}]]) invalid.push([`catalog ${JSON.stringify(value)}`, r => { Object.assign(r.shop, { catalog: value }); }]);
for (const [key, values] of Object.entries({ id: [null, {}], name: [null, {}], slot: [null, "unknown"],
  price: [null, {}, -1, 1.5, Infinity], description: [null, {}] })) {
  for (const value of values) invalid.push([`catalog.${key} ${String(value)}`, r => { Object.assign(r.shop.catalog[0], { [key]: value }); }]);
}
afterEach(() => vi.unstubAllGlobals());
it.each(invalid)("rejects unsafe %s before read or uncertain-write acceptance", async (_, damage) => {
  const r = reply(); damage(r);
  // JSON turns Infinity into null, which must also be unsafe; the parser test
  // intentionally exercises the actual wire representation as well.
  expect(validCoreResponse(r)).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(r))));
  await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
  await expect(request("action", { kind: "buy", item: "leaf-pin" })).rejects.toMatchObject({ outcome: "unknown" });
});
it.each([undefined, null, []])("accepts empty Go ownership %j without modifying the reply", owned => {
  const r = reply(); Object.assign(r.state.economy, { owned }); const before = structuredClone(r);
  expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
it.each([undefined, null])("preserves missing legacy economy/shop %j", value => {
  const r = reply(); Object.assign(r.state, { economy: value }); Object.assign(r, { shop: value });
  expect(validCoreResponse(r)).toBe(true);
});
it("preserves old equipment/rules without wall, floor or wallet cap", () => {
  const r = reply(); delete (r.state.economy.equipped as Partial<typeof economy.equipped>).wallpaper;
  delete (r.state.economy.equipped as Partial<typeof economy.equipped>).floor;
  delete (r.shop as Partial<typeof shop>).maxCoins;
  expect(validCoreResponse(r)).toBe(true);
});
it.each([undefined, null, []])("accepts an empty shop catalog %j", catalog => {
  const r = reply(); Object.assign(r.shop, { catalog }); expect(validCoreResponse(r)).toBe(true);
});
it("does not hardcode known catalog IDs, prices, caps or server chronology", () => {
  const r = reply(); r.shop.catalog[0].id = "future-pin"; r.shop.catalog[0].price = 1234;
  r.state.economy.owned = ["future-pin"]; r.state.economy.equipped.accessory = "future-pin";
  r.shop.maxCoins = 2000000; r.shop.gameDailyLimit = 60; r.state.economy.gameCoins = 40;
  r.state.economy.lastGameAt = at + 86400000;
  const before = structuredClone(r); expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
