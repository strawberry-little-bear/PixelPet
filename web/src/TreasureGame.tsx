import { PetArt } from "./PetArt";
import { petGrowth } from "./growth";
import type { PetState } from "./types";
import { treasureCell, treasureDone, treasureFound, treasureItems, treasureMenu } from "./treasure";
import "./treasure.css";

export function TreasureGame({ pet, active, cursor, choice }: { pet: PetState; active: boolean; cursor: number; choice: number }) {
  const n = pet.game?.treasure;
  if (!n) return null;
  const done = treasureDone(n), paused = !done && (n.paused || !active);
  const label = (index: number) => {
    const view = treasureCell(n, index);
    return `${index + 1}号格 · ${!view.opened && !done ? "未探索" : view.item ? `${treasureItems[view.item]}${view.opened ? "，已找到" : "，留在林间，未找到"}` : view.opened ? `空地，周围 ${view.nearby} 件` : "未探索空地"}`;
  };
  return <section className="treasure-game" aria-label="森林寻宝" data-paused={paused} data-done={done}>
    <header data-treasure-reading-start><strong>森林寻宝</strong><span>探索 {n.opened.length} / 6 · 找到 {treasureFound(n)} / 3</span></header>
    <div className="treasure-companion"><PetArt index={pet.species} stage={petGrowth(pet, pet.lastTick).stage} expression="content" accessory={pet.economy?.equipped.accessory}/><p>{done ? "不必找齐，每次陪伴都值得收好。" : "没有倒计时，一起慢慢找。"}</p></div>
    {paused && <div className="treasure-pause"><strong>慢慢找，不计时</strong><ul>{treasureMenu.map((name, i) => <li key={name} aria-current={choice === i}>{choice === i ? "▸" : "　"} {name}</li>)}</ul><small>A 选择 · B 确认 · C 继续</small></div>}
    {n.opened.length > 0 && <p className="treasure-result" aria-live="polite">上次探索：{label(n.opened[n.opened.length - 1])}</p>}
    <div className="treasure-grid" role="grid" aria-label="林地九格，只用 A / B / C 操作">
      {[0, 1, 2].map(row => <div key={row} role="row">{[0, 1, 2].map(col => {
        const index = row * 3 + col, view = treasureCell(n, index);
        return <div key={index} role="gridcell" aria-label={label(index)} aria-selected={!done && cursor === index} data-opened={view.opened} data-revealed={done && !view.opened}>
          <small>{index + 1}</small><strong aria-hidden="true">{!view.opened && !done ? "?" : view.item ? ["", "♧", "❧", "◆"][view.item] : view.opened ? view.nearby : "·"}</strong>
          <span>{!view.opened && !done ? "未探索" : view.item ? treasureItems[view.item] : "空地"}</span>
          {done && view.item > 0 && !view.opened && <small>留在林间</small>}
        </div>;
      })}</div>)}
    </div>
    <p className="treasure-status" aria-live="polite">{done ? `探索结束 · 实际找到 ${treasureFound(n)} 件，B / C 收好。` : paused ? "刷新、离开或查看规则后，手动继续。" : `${label(cursor)} · B 探索`}</p>
    <small>空格数字＝周围八格的小物总数。六次或找齐结束；收好后 3–6 币共用每日额度。{done && "揭示不算找到。"}</small>
  </section>;
}
