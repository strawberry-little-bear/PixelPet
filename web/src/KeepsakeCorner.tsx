import { SelectionStatus } from "./SelectionStatus";
import { GameKeepsakeArt } from "./GameKeepsakeArt";
import { gameKeepsakes, type GameKeepsakeItem } from "./game-keepsakes";
import type { PetState } from "./types";
import "./keepsake-corner.css";

// A remembered game count is not ownership. Use the actual shared item record.
export function ownedKeepsakes(pet: PetState) {
  if ((pet.schema ?? 0) < 21) return [];
  return gameKeepsakes.flatMap(item => {
    const memory = (pet.album?.entries ?? []).find(m => m.kind === "keepsake" && m.item === item.item && m.source === "shared" &&
      Number.isSafeInteger(m.at) && m.at >= pet.hatchedAt && m.at <= pet.lastTick);
    return memory ? [{ ...item, at: memory.at }] : [];
  });
}
export function keepsakeOptions(pet: PetState): (GameKeepsakeItem | "")[] {
  return ["", ...ownedKeepsakes(pet).map(item => item.item)];
}
export function displayedKeepsake(pet: PetState) {
  return (pet.schema ?? 0) >= 22 ? ownedKeepsakes(pet).find(item => item.item === pet.album?.displayItem) : undefined;
}
export function HomeKeepsake({ pet }: { pet: PetState }) {
  const item = displayedKeepsake(pet);
  return item ? <aside className="home-keepsake" aria-label="小窝纪念角">
    <GameKeepsakeArt item={item.item} /><span><small>小窝纪念角</small><strong>{item.title}</strong></span>
  </aside> : null;
}
export function KeepsakeCorner({ pet, choice }: { pet: PetState; choice: string }) {
  const owned = ownedKeepsakes(pet), options = keepsakeOptions(pet);
  const selected = owned.find(item => item.item === choice);
  const current = displayedKeepsake(pet);
  const position = Math.max(0, options.indexOf(selected?.item ?? ""));
  const action = (current?.item ?? "") === (selected?.item ?? "")
    ? "已经是这个布置，A 可以继续挑选。" : selected ? "B 摆在小窝，替换当前摆放。" : "B 收起当前摆放，回忆仍然保留。";
  return <section className="keepsake-corner" aria-label="小窝纪念角" data-corner-choice={selected?.item ?? ""}>
    <SelectionStatus scope="keepsake-corner">第 {position + 1} / {options.length} 项，{selected?.title ?? "暂时留空"}。现在摆着：{current?.title ?? "暂时留空"}。{action}C 返回分类。</SelectionStatus>
    <header><strong>小窝纪念角</strong><span>{position + 1} / {options.length}</span></header>
    <p className="corner-current">现在摆着：{current?.title ?? "暂时留空"}</p>
    <div className="corner-preview" aria-hidden="true">{selected ? <GameKeepsakeArt item={selected.item} /> : "◇"}</div>
    <h3>{selected?.title ?? "暂时留空"}</h3>
    <p>{selected?.story ?? "收回摆放的纪念物，给小窝留一点空白。已经收好的回忆仍在纪念册里。"}</p>
    {selected && <p className="corner-date">收好于 <time dateTime={new Date(selected.at).toISOString()}>{new Date(selected.at).toLocaleDateString("zh-CN")}</time></p>}
    <p className="corner-action">{action}</p>
    <small>{owned.length ? "只摆放已经收好的物件，可以随时换。不会增加金币或成长，也不需要集齐。" : "现在还没有收好的游戏纪念物。以后一起玩时，遇到喜欢的小物件再来摆放，不用急。"}</small>
  </section>;
}
