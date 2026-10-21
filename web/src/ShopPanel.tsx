import { DailyRefresh } from "./DailyRefresh";
import { PetScene } from "./PetScene";
import { petGrowth } from "./growth";
import { gameAllowance } from "./games";
import { dailyClaimed, dailyWalletNotice, shopItems, shopSections, shopSlotNames } from "./shop";
import type { ShopCategory } from "./shop";
import type { PetState, Shop, ShopItem } from "./types";
import "./shop.css";

export { dailyClaimed, utcDay } from "./shop";
export function itemEquipped(pet: PetState, item: ShopItem) {
  return pet.economy?.equipped[item.slot] === item.id;
}
export function ShopPanel({ pet, shop, page, category = null, confirm, now, notice = "" }: {
  pet: PetState; shop: Shop | null; page: number; category?: ShopCategory | null; confirm: boolean; now: number; notice?: string;
}) {
  const e = pet.economy;
  const items = category ? shopItems(shop, pet, category) : [];
  const item = items[page];
  const section = category ? shopSections.find(s => s.id === category)! : shopSections[page] || shopSections[0];
  const growth = petGrowth(pet, now);
  const owned = !!item && !!e?.owned?.includes(item.id);
  const worn = !!item && itemEquipped(pet, item);
  const previewCaption = !item ? "当前小窝 · 装扮不影响成长"
    : !owned ? "仅预览 · 未购买" : worn ? "使用中 · 已保存" : "仅预览 · 未使用";
  const preview = { accessory: "", room: "", ...e?.equipped, ...(item ? { [item.slot]: item.id } : {}) };
  const allowance = gameAllowance(e, shop, now);
  return <section className="shop-panel" aria-label="小窝商店" data-shop-page={page} data-shop-category={category || "directory"} data-confirm={confirm}>
    <header><strong>小窝商店</strong><span>◈ {e?.coins ?? 0} 金币</span></header>
    {notice && <p className="shop-sync-note" role="status">{notice}</p>}
    {!e || !shop ? <p>小店还没开门，请更新服务后再来看看。</p> : <>
      {category && <div className="shop-breadcrumb">{section.title} · {items.length} 件 · C 返回分类</div>}
      <div className="shop-preview">
        <div aria-hidden="true">
          <PetScene index={pet.species} stage={growth.stage} form={growth.form} motion="idle" clipId={0} dirty={false} equipped={preview} />
        </div>
        <small>{previewCaption}</small>
      </div>
      {!category ? <>
        <div className="shop-sections" role="list" aria-label="商店分类">{shopSections.map((s, i) => <div key={s.id} role="listitem" aria-current={page === i ? "true" : undefined} data-section={s.id}><span>{page === i ? "▸" : "·"} {s.title}</span><small className="shop-quantity">{s.id === "daily" ? `+${shop.dailyCoins} 币` : `${shopItems(shop, pet, s.id).length} 件`}</small></div>)}</div>
        <p className="shop-section-note">{section.description}</p>
        <div className="shop-decision" role="status">{section.id !== "daily" ? `B 查看${section.title}` : pet.sleeping ? "让它安心睡吧，起床后再操作。" : dailyClaimed(pet, now) ? "今日已领取 · 不必连续来" : dailyWalletNotice(pet, shop) || `B 收下 ${shop.dailyCoins} 金币`}</div>
        {section.id === "daily" && <DailyRefresh now={now} lastAt={e.lastDailyAt} />}
        <div className="shop-footer"><span>A 换分类 · C 回小窝</span><span>{allowance?.walletFull ? "钱包已满" : allowance?.available === null ? `今日游戏额度 ${allowance.daily} 币` : `今日游戏还可得 ${allowance?.available ?? "?"} 币`}</span></div>
      </> : item ? <>
        <h3>{item.name}<span>{owned ? "已拥有" : `${item.price} 金币`}</span></h3>
        <p>{item.description}</p>
        <div className="shop-decision" role="status">{pet.sleeping ? "让它安心睡吧，起床后再操作。" : confirm ? `确认花 ${item.price} 金币购买「${item.name}」？` : owned ? worn ? "使用中 · B 收起来" : "B 使用 · 不再扣金币" : e.coins < item.price ? `还差 ${item.price - e.coins} 金币，慢慢来。` : "B 购买 · 下一步确认"}
          {confirm && !pet.sleeping && !owned && e.coins >= item.price && <>
            <span className="shop-purchase-details">按当前余额，购买后剩 {e.coins - item.price} 金币。</span>
            <span className="shop-purchase-details">仅购买，不会自动使用；购买成功后，再按 B 使用。</span>
          </>}
        </div>
        <div className="shop-footer"><span>{confirm ? "A / C 取消 · B 确认" : `${page + 1} / ${items.length} · A 下一件`}</span><span>{shopSlotNames[item.slot]}</span></div>
      </> : <>
        <h3>这里还空着呢</h3><p>{category === "owned" ? "还没有买过物品。去其他分类试试，喜欢再买，不用着急。" : "这个分类暂时没有物品。"}</p>
        <div className="shop-decision" role="status">C 返回分类 · 预览和浏览都免费</div>
      </>}
    </>}
  </section>;
}
