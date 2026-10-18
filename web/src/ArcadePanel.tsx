import { games, gameAllowance, guideSeen } from "./games";
import type { GameInfo } from "./games";
import type { Economy, Shop } from "./types";
import "./arcade.css";

export function ArcadePanel({ choice, economy, shop, now }: {
  choice: number; economy?: Economy; shop: Shop | null; now: number;
}) {
  const game = games[choice] ?? games[0];
  const allowance = gameAllowance(economy, shop, now);
  return <section className="arcade-panel" aria-label="一起玩耍">
    <header>和小伙伴一起玩 <small>{choice + 1} / {games.length}</small></header>
    <div className="arcade-cards">
      {games.map((item, i) => <div key={item.id} className={`arcade-card ${choice === i ? "selected" : ""}`} data-game={item.id} aria-current={choice === i}>
        <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong>
      </div>)}
    </div>
    <div className="arcade-details" aria-live="polite">
      <strong>{game.summary} · {game.duration}</strong>
      <p>{game.controls}</p><p>{game.reward}</p>
    </div>
    <p className="arcade-quota">{allowance
      ? `今日游戏额度剩 ${allowance.daily} / ${shop!.gameDailyLimit} 币 · UTC 日更新`
      : "当日额度待同步，暂不估算奖励"}</p>
    <small>{allowance?.walletFull ? "钱包已满，本局不会得币；仍可陪它玩。"
      : allowance?.daily === 0 ? "今日不再得币，仍可陪它玩，没有惩罚。"
        : allowance?.available !== null && allowance?.available !== undefined && allowance.available < allowance.daily ? `钱包还能收 ${allowance.available} 币；所有游戏共用额度。`
          : "所有游戏共用额度；B 看说明，不立即开局。"}</small>
  </section>;
}

export function GameGuide({ game, page }: { game: GameInfo; page: number; }) {
  const seen = guideSeen(game.id);
  return <section className="game-guide" aria-label={`${game.title}玩法说明`} data-guide={game.id}>
    <header>{seen ? "再看玩法" : "第一次一起玩"} · {game.title}<small>{page + 1} / 2</small></header>
    <strong>{page === 0 ? game.controls : "暂停、离开与奖励"}</strong>
    <p>{page === 0 ? game.lesson : game.leaving}</p>
    <p className="guide-reward">{page === 0 ? game.duration : game.reward}</p>
    <small>A 翻页 · B {seen ? "开始" : "跳过说明，开始"} · C 返回选游戏</small>
  </section>;
}

export function AbandonGame({ stars, fishing = false, walk = false }: { stars: boolean; fishing?: boolean; walk?:boolean; }) {
  return <section className="game-abandon" role="status" aria-label="放弃本局确认">
    <header>要放弃这一局吗？</header>
    <p>本局进度将丢弃，<br />不发金币、不计陪伴奖励。</p>
    <small>{walk ? "实际遇见的发现仍会保留，未走完不发奖励。" : fishing ? "实际钓到的鱼仍保留在图鉴，未完成不发奖励。" : stars ? "光点仍随时间移动，但不会自动接取。" : "取消确认不会自动启动游戏。"}</small>
    <strong>A / C 留在本局 · B 确认放弃</strong>
  </section>;
}
