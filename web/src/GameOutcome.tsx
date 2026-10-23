import { games } from "./games";
import type { GameOutcomeRecord } from "./game-outcome";
import type { CareFeedback } from "./types";
import { CareOutcome } from "./CareOutcome";
import "./game-outcome.css";

export function GameOutcome({ outcome, careFeedback = null }: { outcome: GameOutcomeRecord | null; careFeedback?: CareFeedback | null }) {
  if (!outcome) return null;
  const walk = outcome.gameReceipt?.walk, interest = outcome.gameReceipt?.interest;
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
    {interest && <div className="game-interest-result" aria-label="本局游戏熟悉度">
      <strong>{interest.reason === "credited" ? "又熟悉了一点！" : interest.reason === "cooldown" ? "这一局也收进共同经历了" : "已经很熟悉这款游戏了"}</strong>
      <p>{interest.reason === "credited" ? "本局熟悉度 +1，一起玩过的经验又多了一点。"
        : interest.reason === "cooldown" ? "本局结算时，这款游戏的熟悉度仍在 30 分钟间隔内，没有增加；想玩仍可继续。"
        : "熟悉度已满，本局仍记录共同经历，可以继续一起玩。"}</p>
      <small>熟悉度按每款游戏分别记录；陪玩习惯与成长以本局照顾变化为准。</small>
    </div>}
    <p>{outcome.shared === true ? interest ? "本局共同游戏已记录。" : "本局共同游戏已记录；不代表本次兴趣或成长增加。"
      : outcome.shared === false ? "本局未新增共同游戏记录；以本次结算说明的条件为准。"
      : "这份回复未提供共同游戏记录，不作推测。"}</p>
    <small>上方是服务端已确认的结算原文，不是当前额度或下一局预测；兴趣记录可从成长手册查看。本页暂存，刷新后不保留。</small>
    <CareOutcome feedback={careFeedback} embedded />
  </section>;
}
