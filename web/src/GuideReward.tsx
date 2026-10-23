import { gameAllowance } from "./games";
import type { GameInfo } from "./games";
import type { Economy, Growth, Shop } from "./types";
import { playHabitGuidance } from "./playHabitGuidance";

export type GuideRewardContext = { economy?: Economy; growth?: Growth; shop: Shop | null; now: number };

// Base rules are not a promise of coins. The accepted server snapshot supplies
// the current constraints; finishing still settles authoritatively on the server.
export function GameAllowance({ economy, shop, now }: GuideRewardContext) {
  const allowance = gameAllowance(economy, shop, now);
  const note = !allowance ? "当前额度待同步；是否得币以结算时为准，仍可陪玩。"
    : allowance.walletFull ? "钱包已满；当前不能得币，仍可陪玩。"
    : allowance.daily === 0 ? "当前游戏额度为 0；当前不能得币，仍可陪玩。"
    : allowance.available === null ? `今日游戏额度剩 ${allowance.daily} 币；钱包上限待同步，实际奖励以结算时为准。`
    : allowance.available < allowance.daily ? `钱包还能收 ${allowance.available} 币（所有游戏共享）；实际奖励以结算时为准。`
    : `今日游戏额度剩 ${allowance.daily} 币（所有游戏共享）；实际奖励以结算时为准。`;
  return <p className="guide-allowance" aria-label="当前游戏奖励额度">{note}</p>;
}

export function GuideReward({ game, growth, ...context }: GuideRewardContext & { game: GameInfo }) {
  return <>
    <p className="guide-reward">基础规则：{game.reward}</p>
    <GameAllowance {...context} />
    <p className="guide-habit" aria-label="当前陪玩习惯">{playHabitGuidance(growth, context.now)}</p>
  </>;
}
