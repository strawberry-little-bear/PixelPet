import type { PetState, ShopItem } from "./types";

// Catalog IDs, unlike filtered array positions, survive another window adding
// an earlier item to "owned". Missing selections fall back to the first item.
export function selectedShopIndex(items: readonly ShopItem[], id: string | null): number {
  return Math.max(0, items.findIndex(item => item.id === id));
}
export type PurchaseQuote = Readonly<ShopItem>;
// This only validates the last observed preview. The server remains authoritative
// for ownership, funds and price; polling does not turn a quote into a price lock.
export function purchaseMatches(quote: PurchaseQuote | null, item: ShopItem | undefined, pet: PetState): boolean {
  return !!quote && !!item && !!pet.economy && !pet.sleeping && !pet.game &&
    !pet.economy.owned?.includes(item.id) && pet.economy.coins >= item.price &&
    quote.id === item.id && quote.price === item.price && quote.name === item.name &&
    quote.slot === item.slot && quote.description === item.description;
}
