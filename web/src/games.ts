import type { Economy, Shop } from "./types";

// One directory owns both the selector and its three-key guides. Game mechanics
// and server-authoritative scoring stay in their individual implementations.
export const games = [
  {
    id: "stars", title: "接星星", icon: "★", startAction: "play",
    summary: "移动接住 · 五轮", duration: "约 15–30 秒",
    controls: "A 换位置 · B 接住 · C 放弃确认",
    reward: "完成五轮：3–8 金币，不要求全接中。",
    lesson: "看准亮起的星星，A 换到对应位置，再按 B 接住。每个节拍只接一次，共五轮。",
    leaving: "没有限时失败；光点随时间移动，离开后不自动接取。C 只打开确认，不直接丢掉本局。",
  },
  {
    id: "tiles", title: "连连看", icon: "▦", startAction: "play-tiles",
    summary: "相同图案 · 两次转弯", duration: "约 1–3 分钟",
    controls: "A 移动 · B 选牌 · C 撤选 / 放弃确认",
    reward: "配完八对自动结算：6 金币。",
    lesson: "A 移到图案，B 选两张相同的牌；连线最多转两次弯，可绕棋盘边。死局免费重排。",
    leaving: "C 先撤销选牌，没有选牌时再打开放弃确认。没有倒计时，刷新保留棋盘。",
  },
  {
    id: "snake", title: "贪吃蛇", icon: "❧", startAction: "play-snake",
    summary: "左右转弯 · 八颗果子", duration: "约 1–2 分钟",
    controls: "A 左转 · B 右转 · C 暂停",
    reward: "结束并收好成绩，至少吃三颗：3–6 金币。",
    lesson: "相对前进方向左转或右转，每拍一次转向；别撞墙或自己。吃满八颗结束。",
    leaving: "开始、刷新或离开后保持暂停。暂停时 A / C 继续，B 打开放弃确认；结束时 B / C 收好成绩。",
  },
  {
    id: "tetris", title: "俄罗斯方块", icon: "▥", startAction: "play-tetris",
    summary: "三键拼搭 · 八行积木", duration: "约 2–5 分钟",
    controls: "A 左移 · B 右移 · C 暂停菜单",
    reward: "结束并收好成绩，至少消两行：2–6 金币。",
    lesson: "积木自动下落；C 暂停，A 选择继续 / 旋转 / 落底 / 放弃，B 确认。消满八行结束。",
    leaving: "开始、刷新或离开后保持暂停，不补跑重力。放弃需再确认；结束时 B / C 收好成绩。",
  },
] as const;
export type GameInfo = (typeof games)[number];
const guideKey = (id: GameInfo["id"]) => `pixelpet-guide-v1-${id}`;
export function guideSeen(id: GameInfo["id"]): boolean {
  try { return localStorage.getItem(guideKey(id)) === "seen"; } catch { return false; }
}
export function rememberGuide(id: GameInfo["id"]) {
  try { localStorage.setItem(guideKey(id), "seen"); } catch { /* Optional UI preference, never a save requirement. */ }
}

// Match rewardGame's UTC rollover and backwards-clock guard. Missing rules or
// an old server's missing wallet cap are unknown, never a made-up allowance.
export function gameAllowance(economy: Economy | undefined, shop: Shop | null, now: number) {
  if (!economy || !shop) return null;
  const day = Math.floor(now / 86400000), last = Math.floor(economy.lastGameAt / 86400000);
  const daily = economy.lastGameAt > 0 && day < last ? 0
    : Math.max(0, shop.gameDailyLimit - (economy.lastGameAt === 0 || day > last ? 0 : economy.gameCoins));
  const wallet = shop.maxCoins === undefined ? null : Math.max(0, shop.maxCoins - economy.coins);
  return { daily, available: wallet === null ? null : Math.min(daily, wallet), walletFull: wallet === 0 };
}
