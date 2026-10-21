import { games } from "./games";
import type { GameOutcomeRecord } from "./game-outcome";
import type { CareFeedback } from "./types";
import { CareOutcome } from "./CareOutcome";
import "./game-outcome.css";

export function GameOutcome({ outcome, careFeedback = null }: { outcome: GameOutcomeRecord | null; careFeedback?: CareFeedback | null }) {
  if (!outcome) return null;
  const walk = outcome.gameReceipt?.walk;
  return <section className="game-outcome" aria-label="本页最近一次游戏结算">
    <h3>本页最近一次结算 · {games.find(g => g.id === outcome.kind)?.title}</h3>
    <time dateTime={new Date(outcome.at).toISOString()}>{new Date(outcome.at).toLocaleString("zh-CN", {
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })}（本地时间）</time>
    <p className="game-outcome-message">{outcome.message}</p>
    {walk && <div className="walk-reward-breakdown" aria-label="散步奖励拆解">
      <strong>散步奖励拆解</strong>
      <p>路线完成奖励：+{walk.routeCoins} 金币</p>
      <p>灵活表现奖励：+{walk.performanceCoins} 金币（避开 {walk.cleared} / {walk.total} 处障碍）</p>
      <p>本次实际到账：+{walk.awardedCoins} 金币</p>
      <small>实际到账会受小游戏每日额度和钱包上限影响。</small>
    </div>}
    <p>{outcome.shared === true ? "本局共同游戏已记录；不代表本次兴趣或成长增加。"
      : outcome.shared === false ? "本局未新增共同游戏记录；以本次结算说明的条件为准。"
      : "这份回复未提供共同游戏记录，不作推测。"}</p>
    <small>上方是服务端已确认的结算原文，不是当前额度或下一局预测；兴趣记录可从成长手册查看。本页暂存，刷新后不保留。</small>
    <CareOutcome feedback={careFeedback} embedded />
  </section>;
}
