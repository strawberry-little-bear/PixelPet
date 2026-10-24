import { Blocks, CircleDot, Leaf, Ribbon, Shell, ShoppingBasket, Sparkles, Trees } from "lucide-react";

// Distinct, monochrome silhouettes retain their meaning on the pocket LCD.
const art = {
  "star-ribbon": Ribbon, "tile-basket": ShoppingBasket, "fruit-leaf": Leaf,
  "block-garden": Blocks, "pond-shell": Shell, "path-button": CircleDot, "forest-token": Trees,
};
export function GameKeepsakeArt({ item }: { item?: string }) {
  const Icon = item && Object.hasOwn(art, item) ? art[item as keyof typeof art] : Sparkles;
  return <Icon size={36} strokeWidth={1.5} aria-hidden="true" data-keepsake-art={item} />;
}
