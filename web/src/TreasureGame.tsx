import { TreasureCompanion } from "./TreasureCompanion";
import type { TreasureReaction } from "./treasure-reaction";
import type { PetState } from "./types";
import { treasureClue, treasureCell, treasureDone, treasureFound, treasureItems, treasureMenu } from "./treasure";
import "./treasure.css";

export function TreasureGame({ pet, active, cursor, choice, reaction }: { pet: PetState; active: boolean; cursor: number; choice: number; reaction?: TreasureReaction | null }) {
  const n = pet.game?.treasure;
  if (!n) return null;
  const clue = treasureClue(n), found = treasureFound(n);
  const done = treasureDone(n), paused = !done && (n.paused || !active);
  const pauseHint = [
    `B / C 继续后仍选中 ${cursor + 1} 号未探索格；A 换格、B 探索一次，不会自动探索。`,
    "B 重看本局两页规则；C 返回暂停，不消耗探索次数。",
    "B 先打开放弃确认，A / C 可取消；确认放弃才丢弃本局，不发金币或陪伴奖励。",
  ][choice];
  const label = (index: number) => {
    const view = treasureCell(n, index);
    return `${index + 1}号格 · ${!view.opened && !done ? "未探索" : view.item ? `${treasureItems[view.item]}${view.opened ? "，已找到" : "，留在林间，未找到"}` : view.opened ? `空地，周围 ${view.nearby} 件` : "未探索空地"}`;
  };
  const board = <>
    <div className="treasure-grid" role="grid" aria-label="林地九格，只用 A / B / C 操作" aria-describedby={clue ? "treasure-clue" : undefined}>
      {[0, 1, 2].map(row => <div key={row} role="row">{[0, 1, 2].map(col => {
        const index = row * 3 + col, view = treasureCell(n, index);
        const source = clue?.index === index, neighbor = clue?.neighbors.includes(index) ?? false;
        const clueLabel = source ? " · 最近空地线索" : neighbor ? ` · 在${clue!.index + 1}号格线索范围内` : "";
        return <div key={index} role="gridcell" aria-label={label(index) + clueLabel} aria-selected={!done && cursor === index} data-opened={view.opened} data-revealed={done && !view.opened} data-clue-source={source} data-clue-neighbor={neighbor}>
          <small>{index + 1}{source ? " · 线索" : neighbor ? " · 邻" : ""}</small><strong aria-hidden="true">{!view.opened && !done ? "?" : view.item ? ["", "♧", "❧", "◆"][view.item] : view.opened ? view.nearby : "·"}</strong>
          <span>{!view.opened && !done ? "未探索" : view.item ? treasureItems[view.item] : "空地"}</span>
          {done && view.item > 0 && !view.opened && <small>留在林间</small>}
        </div>;
      })}</div>)}
    </div>
    <p className={`treasure-status${!done && !paused ? " treasure-selection" : ""}`} aria-live="polite" aria-atomic="true">{done ? `探索结束 · ${found === 3 ? "三件已找齐" : "六次已用完"} · 实际找到 ${found} 件，A 暂不操作 · B / C 收好本局发现。` : paused ? "刷新、离开或查看规则后，手动继续。" : `当前选中：${label(cursor)} · B 探索`}</p>
  </>;
  return <section className="treasure-game" aria-label="森林寻宝" data-paused={paused} data-done={done}>
    <header data-treasure-reading-start><strong>森林寻宝</strong><span>探索 {n.opened.length} / 6 · 找到 {found} / 3</span></header>
    {paused && <div className="treasure-pause"><strong>慢慢找，不计时</strong><ul>{treasureMenu.map((name, i) => <li key={name} aria-current={choice === i}>{choice === i ? "▸" : "　"} {name}</li>)}</ul><p className="treasure-pause-hint" aria-live="polite" aria-atomic="true">{pauseHint}</p><small>A 选择 · B 确认 · C 继续</small></div>}
    {!paused && !done && board}
    <TreasureCompanion pet={pet} paused={paused} done={done} reaction={reaction}/>
    {n.opened.length > 0 && <p className="treasure-result" aria-live="polite">上次探索：{label(n.opened[n.opened.length - 1])}</p>}
    {clue && <p className="treasure-clue" id="treasure-clue">最近空地线索：{clue.index + 1}号格 · 数字 {clue.nearby}。标「邻」的格子都计入，含斜角及已找到的小物。</p>}
    {(paused || done) && board}
    <small className="treasure-rule">{done
      ? `本局基础 ${3 + found} 币＝3 币探索 + ${found} 币发现；收好时受每日额度和钱包上限限制。揭示不算找到，B / C 收好才计陪伴与金币。`
      : "空格数字＝周围八格的小物总数。六次或找齐结束；收好后 3–6 币共用每日额度。"}</small>
  </section>;
}
