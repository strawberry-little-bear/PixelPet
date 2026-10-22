import type { Economy, PetState, Shop } from "./types";

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
    lesson: "按 C 打开旋转、落底等操作；A 选择继续 / 旋转 / 落底 / 放弃，B 确认。继续后积木自动下落，消除八行结束。",
    leaving: "开始、刷新或离开后保持暂停，不补跑重力。放弃需再确认；结束时 B / C 收好成绩。",
  },
  { id: "fishing", title: "池塘钓鱼", icon: "♓︎", startAction: "play-fishing",
    summary: "三个钓点 · 三次抛竿", duration: "约 2–3 分钟",
    controls: "A 换钓点 · B 抛竿 / 提竿 · C 暂停菜单",
    reward: "钓到至少一条并完成三竿：3–6 金币。",
    lesson: "收竿后 A 换钓点，B 抛竿。等到明确的咬钩提示，再按 B 提竿，有 10 秒反应时间。提前提竿也会用掉这一竿；真实钓到才记入鱼图鉴。",
    leaving: "C 暂停菜单可看鱼图鉴或放弃确认。刷新、离开自动暂停，不离线钓鱼，不消耗机会。暂停后需手动继续。",
  },
 { id:"walk", title:"公园散步", icon:"♧", startAction:"play-walk",
 summary:"林荫小路 · 沿途发现", duration:"约 1–1.5 分钟（不含暂停）",
 controls:"自动前进 · A 跳跃 · B 蹲下 · C 暂停",
 reward:"走完并收好：3–6 金币，不要求避开所有障碍。",
 lesson:"每六步一处障碍，提前提示。A 越石，B 低头过树枝，姿势保持三步。绊到继续走，不扣状态。换成海豚伙伴时走浅水道：A 跃水、B 下潜。",
 leaving:"C 暂停可看沿途发现或放弃确认。刷新、离开后手动继续，不离线赶路。每24步的真实发现会保留；到终点 B / C 收好才计陪伴。",
 },
 { id: "treasure", title: "森林寻宝", icon: "◆", startAction: "play-treasure",
 summary: "九格林地 · 六次探索", duration: "不限时 · 随时暂停",
 controls: "A 选格 · B 探索 · C 暂停",
 reward: "六次探索或找齐三件，收好后：3–6 金币，不要求找齐。",
 lesson: "A 循环选未探索的格子，B 探索。空格数字表示周围八格有几件小物，不只算上下左右。最多探索六格，找齐三件可提前结束。没有倒计时，不必连按。",
 leaving: "开局、刷新或离开后手动继续。C 暂停，可重看规则或确认放弃。结束后 B / C 收好才计陪伴与共享金币；揭示但未探索的小物不计成绩。导入备份沿用原规则，不恢复未收好的游戏。",
 },
] as const;
export type GameInfo = (typeof games)[number];

// Keep the guide language aligned with what B actually does for each game.
// Stars and tiles start immediately; fishing enters its ready state; the
// remaining games deliberately open paused so a refresh cannot auto-run them.
export function gameFinishInstruction(game: GameInfo): string {
  return ["snake", "tetris"].includes(game.id)
    ? "A 暂不操作 · B / C 收好本局成绩"
    : "A 暂不操作 · B / C 收好本局发现";
}

export function gameStartLabel(game: GameInfo): string {
  return game.id === "stars" || game.id === "tiles" ? "开始"
    : game.id === "fishing" ? "进入准备"
      : "进入暂停";
}

export function gameStartInstruction(game: GameInfo, seen: boolean): string {
  const action = gameStartLabel(game);
  return seen ? `B ${action}` : `跳过说明，${action}`;
}
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


// Session navigation is separate from save-generation identity and scoring.
export const gameSessionKey = (game: PetState["game"]) =>
  game ? (game.id ?? `legacy-${game.startedAt}`) : null;

// These five games retain a terminal board until the player explicitly collects
// it. Stars/tiles settle in their final action and remove the session instead.
export function gameAwaitingFinish(game: PetState["game"]): boolean {
  switch (game?.kind) {
    case "snake": return !!game.snake?.end;
    case "tetris": return !!game.tetris?.end;
    case "fishing": return game.fishing?.phase === "done";
    case "treasure": return !!game.treasure && (game.treasure.opened.length >= 6 || game.treasure.opened.filter(i => game.treasure!.layout[i] > 0).length === 3);
    case "walk": return game.walking?.beat === 72;
    default: return false;
  }
}
