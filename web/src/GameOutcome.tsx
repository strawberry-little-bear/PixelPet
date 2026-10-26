import { GameKeepsakeArt } from "./GameKeepsakeArt";
import { gameKeepsake } from "./game-keepsakes";
import { games } from "./games";
import { completionLabel } from "./game-history";
import type { GameOutcomeRecord } from "./game-outcome";
import type { CareFeedback } from "./types";
import { CareReadingRegion } from "./CareReadingRegion";
import { CareOutcome } from "./CareOutcome";
import "./game-outcome.css";

function interestCooldownEstimate(interest: NonNullable<GameOutcomeRecord["gameReceipt"]>["interest"], at: number): string {
  const retryAt = interest?.retryAt;
  if (interest?.reason !== "cooldown" || typeof retryAt !== "number" || !Number.isSafeInteger(retryAt) ||
      retryAt <= at || retryAt - at > 24 * 60 * 60 * 1000) return "";
  const minutes = Math.max(1, Math.ceil((retryAt - at) / 60000));
  return `记录时约还需 ${minutes} 分钟；之后是否计入以实际结算结果为准。`;
}

export function GameOutcome({ outcome, careFeedback = null, readable = false, compact = false }: {
  outcome: GameOutcomeRecord | null; careFeedback?: CareFeedback | null; readable?: boolean; compact?: boolean;
}) {
  if (!outcome) return null;
  const walk = outcome.gameReceipt?.walk, interest = outcome.gameReceipt?.interest;
  // Per-game familiarity and the shared play habit have independent boundaries.
  const interestNext = interestCooldownEstimate(interest, outcome.at);
  const keepsake = gameKeepsake(outcome.keepsake);
  const compactMeta = [
    walk && `金币 +${walk.awardedCoins}`,
    interest && (interest.reason === "credited" ? "熟悉度 +1" : interest.reason === "familiar" ? "熟悉度已满，仍收进共同经历" : "共同经历已记录"),
    keepsake && `收好纪念物「${keepsake.title}」`,
    outcome.shared === true ? "本局共同游戏已记录" : outcome.shared === false ? "本局未新增共同游戏记录" : null,
  ].filter(Boolean).join(" · ");
  const receipt = <section className="game-outcome" aria-label="本页最近一次游戏结算">
    <h3>本页最近一次结算 · {games.find(g => g.id === outcome.kind)?.title}</h3>
    <p className="game-outcome-message">{outcome.message}</p>
    {outcome.companionVoice && <p className="game-outcome-companion-voice" aria-label="宠物的游戏回应">{outcome.companionVoice.text}</p>}
    <CareOutcome feedback={careFeedback} embedded compact={compact} />
    {compact && compactMeta && <p className="game-outcome-compact-meta">{compactMeta}</p>}
    <div className="game-outcome-full" aria-hidden={compact || undefined}>
      <time dateTime={new Date(outcome.at).toISOString()}>{new Date(outcome.at).toLocaleString("zh-CN", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })}（本地时间）</time>
      {keepsake && <div className="game-keepsake-result" role="group" aria-label="本次收好的游戏纪念物">
        <GameKeepsakeArt item={keepsake.item} />
        <div>
          <strong>一起收好了「{keepsake.title}」</strong>
          <p>可以到纪念册「一起玩过」翻看，也可到「小窝纪念角」挑选摆放。</p>
          <small>每种只留一件，不必集齐。</small>
        </div>
      </div>}
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
        {interestNext &&
          <small className="game-interest-next">这款游戏的熟悉度：{interestNext}</small>}
        <small>熟悉度按每款游戏分别记录；陪玩习惯与成长以本局照顾变化为准。</small>
      </div>}
      <p>{outcome.shared === true ? interest ? "本局共同游戏已记录。" : "本局共同游戏已记录；不代表本次兴趣或成长增加。"
        : outcome.shared === false ? "本局未新增共同游戏记录；以本次结算说明的条件为准。"
        : "这份回复未提供共同游戏记录，不作推测。"}</p>
      {outcome.completedCount !== undefined && <p className="game-completion-count">这款游戏已记录 {completionLabel(outcome.completedCount)}共同游戏；可从生活回顾查看各款记录。局数从开始记录时累计，不补算旧版游玩。</p>}
      <small>上方是服务端已确认的结算原文，不是当前额度或下一局预测；兴趣记录可从成长手册查看。本页暂存，刷新后不保留。</small>
    </div>
  </section>;
  // Status already supplies a reading stop; only home needs its own.
  return readable ? <CareReadingRegion className="game-outcome-reading" label="游戏结算阅读区"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    {receipt}
  </CareReadingRegion> : receipt;
}
