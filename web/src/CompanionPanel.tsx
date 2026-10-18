import { games } from "./games";
import { interestLimit, interestSummary } from "./companion";
import type { Companion } from "./types";

export function CompanionPanel({ companion: c }: { companion?: Companion }) {
  return (
    <section className="companion-panel" aria-label="共同游戏与兴趣">
      <div className="habit-heading">
        <span>共同游戏 · 兴趣记录</span><strong>不影响形态</strong>
      </div>
      <p className="companion-summary">
        {c ? interestSummary(c) : "更新服务后，从新的真实经历开始记录。"}
      </p>
      <div className="companion-rows">
        {games.map(game => {
          const points = c?.interests.find(r => r.kind === game.id)?.points ?? 0;
          return (
            <div key={game.id} data-interest={game.id} data-points={points}>
              <span>{game.title}</span>
              <span aria-label={`已记住 ${points} 次，上限 ${interestLimit} 次`}>
                {"●".repeat(points)}{"○".repeat(interestLimit - points)}
              </span>
            </div>
          );
        })}
      </div>
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
