import type { PetState, Shop } from "./types";

// One catalog source for both the display and the three-key controller. Filters
// do not reorder or mutate server rules and never write to the player's save.
export const shopSections = [
  { id: "daily", title: "今日问候", description: "每天一次，不用连续来。" },
  { id: "all", title: "全部物品", description: "先试一试，再决定要不要带回家。" },
  { id: "seasonal", title: "季节主题", description: "春花、贝壳、秋叶和雪夜，全年可选，喜欢时再布置。" },
  { id: "accessory", title: "宠物装扮", description: "不改成长，不遮住自己的模样。" },
  { id: "room", title: "小窝摆件", description: "一个摆件槽，与墙纸、地板独立。" },
  { id: "wallpaper", title: "墙纸", description: "换一面喜欢的墙，不挤掉摆件。" },
  { id: "floor", title: "地板", description: "与摆件、墙纸一起布置小窝。" },
  { id: "owned", title: "已拥有", description: "随时换上或收起，不再扣金币。" },
] as const;
export type ShopCategory = Exclude<(typeof shopSections)[number]["id"], "daily">;
const seasonalItemIds = new Set(["autumn-wall", "winter-floor", "spring-vase", "summer-shell"]);
export function isSeasonalItem(id: string) {
  return seasonalItemIds.has(id);
}
export function shopItems(shop: Shop | null, pet: PetState, category: ShopCategory) {
  return (shop?.catalog ?? []).filter(item => category === "all" ||
    (category === "owned" ? pet.economy?.owned?.includes(item.id)
      : category === "seasonal" ? isSeasonalItem(item.id)
        : item.slot === category));
}
export const shopSlotNames = { accessory: "宠物装扮", room: "小窝摆件", wallpaper: "墙纸", floor: "地板" };
export const utcDay = (ms: number) => Math.floor(ms / 86400000);
export function dailyClaimed(pet: PetState, now: number) {
  return !!pet.economy?.lastDailyAt && utcDay(pet.economy.lastDailyAt) >= utcDay(now);
}

// Greetings are all-or-nothing, unlike capped game rewards. Missing legacy
// caps must remain unknown; the server still decides every actual claim.
export function dailyWalletNotice(pet: PetState, shop: Shop | null) {
  const economy = pet.economy;
  return economy && shop?.maxCoins !== undefined && economy.coins > shop.maxCoins - shop.dailyCoins
    ? `钱包放不下本次 ${shop.dailyCoins} 金币；本次未领取，腾出空间后可再领。` : "";
}
