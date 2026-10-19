import type { TreasureHunt } from "./types";
export const treasureItems = ["空地", "小松果", "轻羽毛", "光滑石"];
export const treasureMenu = ["继续探索", "查看规则", "放弃确认"];
export const treasureFound = (n: TreasureHunt) => n.opened.filter(i => n.layout[i] > 0).length;
export const treasureDone = (n: TreasureHunt) => n.opened.length === 6 || treasureFound(n) === 3;
export function nextTreasure(n: TreasureHunt, cursor: number) {
  for (let offset = 1; offset <= 9; offset++) {
    const index = (cursor + offset + 9) % 9;
    if (!n.opened.includes(index)) return index;
  }
  return cursor;
}
export function treasureCell(n: TreasureHunt, index: number) {
  const opened = n.opened.includes(index);
  if (!opened && !treasureDone(n)) return { opened, item: 0, nearby: null };
  const item = n.layout[index];
  let nearby: number | null = null;
  if (opened && item === 0) {
    nearby = n.layout.filter((item, at) => item > 0 && Math.abs(Math.floor(at / 3) - Math.floor(index / 3)) <= 1 && Math.abs(at % 3 - index % 3) <= 1).length;
  }
  return { opened, item, nearby };
}
