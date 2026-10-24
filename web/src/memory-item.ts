import type { Memory, Shop, ShopItem } from "./types";

export const memoryItemSlots: Partial<Record<Memory["kind"], ShopItem["slot"]>> = {
  outfit: "accessory", decoration: "room", wallpaper: "wallpaper", floor: "floor",
};

// The ID belongs to the saved event; today's equipment is not its history.
// Names come from the accepted server catalog, not a local or historical guess.
export function recordedMemoryItem(memory: Memory | undefined, shop?: Shop | null): ShopItem | undefined {
  const slot = memory && memoryItemSlots[memory.kind];
  return slot ? shop?.catalog?.find(item => item.id === memory?.item && item.slot === slot) : undefined;
}
