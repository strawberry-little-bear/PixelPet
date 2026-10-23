import { abandonProgress } from "./abandon-progress";
import { DailyRefresh } from "./DailyRefresh";
import { interestLimit, validInterestEntries } from "./companion";
import { GameHabit, GuideReward } from "./GuideReward";
import type { GuideRewardContext } from "./GuideReward";
import { gameStartBlock, gameStartInstruction, games, gameAllowance, guideSeen } from "./games";
import type { GameInfo } from "./games";
import type { Companion, Economy, PetState, Shop } from "./types";
import "./arcade.css";

export function ArcadePanel({ choice, economy, companion, shop, now, sleeping = false, energy }: {
  choice: number; economy?: Economy; companion?: Companion; shop: Shop | null; now: number; sleeping?: boolean; energy?: number;
}) {
  const game = games[choice] ?? games[0];
  const blocked = gameStartBlock(sleeping, energy);
  const familiar = validInterestEntries(companion).find(entry => entry.kind === game.id && entry.points >= 2);
  const allowance = gameAllowance(economy, shop, now);
  return <section className="arcade-panel" aria-label="一起玩耍">
    <header>和小伙伴一起玩 <small>{choice + 1} / {games.length}</small></header>
    {blocked && <p className="game-start-note" role="status" aria-label="开局前的照顾提示">{blocked.note}{!sleeping && "可以先按 B 看规则。"}</p>}
    <div className="arcade-cards">
      {games.map((item, i) => <div key={item.id} className={`arcade-card ${choice === i ? "selected" : ""}`} data-game={item.id} aria-current={choice === i}>
        <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong>
      </div>)}
    </div>
    <div className="arcade-details" aria-live="polite">
      <strong>{game.summary} · {game.duration}</strong>
      <p>{game.controls}</p><p>{game.reward}</p>
      {familiar && <p className="arcade-familiar" aria-label="共同游戏熟悉度">你们已经熟悉这款游戏：{familiar.points} / {interestLimit}。想继续时可以再玩，也可以换一款。</p>}
    </div>
    <p className="arcade-quota">{allowance
      ? `今日游戏额度剩 ${allowance.daily} / ${shop!.gameDailyLimit} 币`
      : "当日额度待同步，暂不估算奖励"}</p>
    {allowance && <DailyRefresh now={now} lastAt={economy?.lastGameAt} />}
    <small>{sleeping ? "它正在睡觉，先按 C 返回并叫醒它；醒来后再一起玩。" : allowance?.walletFull ? "钱包已满，本局不会得币；仍可陪它玩。"
      : allowance?.daily === 0 ? "今日不再得币，仍可陪它玩，没有惩罚。"
        : allowance?.available !== null && allowance?.available !== undefined && allowance.available < allowance.daily ? `钱包还能收 ${allowance.available} 币；所有游戏共用额度。`
          : "所有游戏共用额度；B 进入，不立即开局。"}</small>
  </section>;
}

export function GameGuide({ game, page, review = false, paused = false, sleeping = false, energy, ...rewardContext }: GuideRewardContext & { game: GameInfo; page: number; review?: boolean; paused?: boolean; sleeping?: boolean; energy?: number; }) {
  const seen = guideSeen(game.id);
  const blocked = paused ? null : gameStartBlock(sleeping, energy);
  const notice = blocked && <p className="game-start-note" role="status" aria-label="开局前的照顾提示">{blocked.note}</p>;
  if (seen && !review && !paused) return <section className="game-guide game-quick-start" aria-label={`${game.title}开始准备`} data-guide={game.id}>
    <header>准备再玩 · {game.title}</header>
    {notice}
    <strong>{game.summary} · {game.duration}</strong>
    <p>{game.controls}</p>
    <GuideReward game={game} {...rewardContext} />
    <p>{game.id === "stars" || game.id === "tiles" ? "按 B 才开局，不会自动操作。" : game.id === "fishing" ? "开局后按 B 手动抛竿，不会自动开始等待。" : "开局后保持暂停，按画面提示手动继续。"}</p>
    <small>A 重看规则 · {blocked?.hint ?? gameStartInstruction(game, seen)} · C 返回选游戏</small>
  </section>;
  return <section className="game-guide" aria-label={`${game.title}玩法说明`} data-guide={game.id}>
    <header>{paused ? "本局玩法" : seen ? "再看玩法" : "第一次一起玩"} · {game.title}<small>{page + 1} / 2</small></header>
    {notice}
    <strong>{page === 0 ? game.controls : "暂停、离开与奖励"}</strong>
    <ul className="guide-steps">
      {(page === 0 ? game.lesson : game.leaving).split("。").filter(Boolean).map(step =>
        <li key={step}>{step}。</li>
      )}
    </ul>
    {page === 0 ? <>
      <p className="guide-reward">{game.duration}</p>
      <GameHabit {...rewardContext} />
    </> : <GuideReward game={game} {...rewardContext} />}
    {paused && <p className="guide-paused-note">只读本局规则；返回仍保持暂停，按暂停画面提示手动继续。</p>}
    <small>{paused ? "A / B 翻页 · C 返回暂停" : `A 翻页 · ${blocked?.hint ?? gameStartInstruction(game, seen)} · C 返回选游戏`}</small>
  </section>;
}

export function AbandonGame({ game }: { game: PetState["game"] }) {
  const progress = abandonProgress(game);
  const stars = !!game && !game.kind, fishing = game?.kind === "fishing", walk = game?.kind === "walk";
  return <section className="game-abandon" role="status" aria-label="放弃本局确认">
    <header>要放弃这一局吗？</header>
    {progress && <div className="abandon-progress" aria-label="本局已保存进度"><strong>{progress.title}</strong><p>{progress.text}</p></div>}
    <p>本局进度将丢弃，<br />不发金币、不计陪伴奖励。</p>
    <small>{walk ? "实际遇见的发现仍会保留，未走完不发奖励。" : fishing ? "实际钓到的鱼仍保留在图鉴，未完成不发奖励。" : stars ? "光点仍随时间移动，但不会自动接取。" : "取消确认不会自动启动游戏。"}</small>
    <strong>A / C 留在本局 · B 确认放弃</strong>
  </section>;
}
