import { games } from "./games";
import { companionCompletionTotal, interestLimit, interestSummary } from "./companion";
import { completionLabel, savedGameHistory } from "./game-history";
import type { Companion, PetState } from "./types";

export function CompanionPanel({ companion: c, pet }: { companion?: Companion; pet?: PetState }) {
  const recent = c?.recent;
  const recentGame = games.find(game => game.id === recent?.kind);
  const completionTotal = companionCompletionTotal(c);
  const history = pet ? savedGameHistory(pet) : null;
  return (
    <section className="companion-panel" aria-label="共同游戏与兴趣">
      <div className="habit-heading">
        <span>共同游戏 · 兴趣记录</span><strong>不影响形态</strong>
      </div>
      <p className="companion-summary">
        {c ? interestSummary(c) : "更新服务后，从新的真实经历开始记录。"}
      </p>
      {completionTotal !== null && <p className="companion-completion-total" aria-label="共同游戏完成总数">共同完成 {completionTotal} 局 · 只统计已经收好的游戏</p>}
      <div className="companion-rows">
        {games.map(game => {
          const points = c?.interests.find(r => r.kind === game.id)?.points ?? 0;
          const completions = history?.completions.find(entry => entry.kind === game.id)?.count ?? null;
          return (
            <div key={game.id} data-interest={game.id} data-points={points}>
              <span>{game.title}</span>
              <span className="companion-row-progress" aria-label={`已记住 ${points} 次，上限 ${interestLimit} 次${completions === null ? "" : `，共同游戏 ${completionLabel(completions)}`}`}>
                {"●".repeat(points)}{"○".repeat(interestLimit - points)}
                {completions !== null && <small data-completion-count={game.id}> · {completionLabel(completions)}</small>}
              </span>
            </div>
          );
        })}
      </div>
      {c && <section className="companion-memory" aria-label="最近一次共同游戏">
        <strong>最近一起玩过</strong>
        {recent && recentGame ? <>
          <p>{recentGame.title} · 已完成并收好</p>
          <time dateTime={new Date(recent.at).toISOString()}>
            {new Date(recent.at).toLocaleString("zh-CN", {
              year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
            })}
          </time>
          <small>只保留最近一次完成；不代表本次兴趣增加。</small>
        </> : <p>还没有保存的共同游戏。玩喜欢的就好，不必补做。</p>}
      </section>}
      <small className="companion-rules">
        只记达成陪伴条件并收好的游戏。<br />
        同一游戏间隔 30 分钟，每种最多记 5 次。<br />
        满额金币也会记住；不加奖励，不强求偏好。
      </small>
      <small className="companion-since">
        {c ? `记录始于 ${new Date(c.since).toLocaleDateString("zh-CN")} · 不补写旧经历`
          : "旧记录和成年形态都保持不变"}
      </small>
    </section>
  );
}
