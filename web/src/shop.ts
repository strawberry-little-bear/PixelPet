import type { PetState, Shop } from "./types";

// One catalog source for both the display and the three-key controller. Filters
// do not reorder or mutate server rules and never write to the player's save.
export const shopSections = [
  { id: "daily", title: "今日问候", description: "每天一次，不用连续来。" },
  { id: "all", title: "全部物品", description: "先试一试，再决定要不要带回家。" },
  { id: "accessory", title: "宠物装扮", description: "不改成长，不遮住自己的模样。" },
  { id: "room", title: "小窝摆件", description: "一个摆件槽，与墙纸、地板独立。" },
  { id: "wallpaper", title: "墙纸", description: "换一面喜欢的墙，不挤掉摆件。" },
  { id: "floor", title: "地板", description: "与摆件、墙纸一起布置小窝。" },
  { id: "owned", title: "已拥有", description: "随时换上或收起，不再扣金币。" },
] as const;
export type ShopCategory = Exclude<(typeof shopSections)[number]["id"], "daily">;
export function shopItems(shop: Shop | null, pet: PetState, category: ShopCategory) {
  return (shop?.catalog ?? []).filter(item => category === "all" ||
    (category === "owned" ? pet.economy?.owned?.includes(item.id) : item.slot === category));
}
export const shopSlotNames = { accessory: "宠物装扮", room: "小窝摆件", wallpaper: "墙纸", floor: "地板" };
export const utcDay = (ms: number) => Math.floor(ms / 86400000);
export function dailyClaimed(pet: PetState, now: number) {
  return !!pet.economy?.lastDailyAt && utcDay(pet.economy.lastDailyAt) >= utcDay(now);
}
