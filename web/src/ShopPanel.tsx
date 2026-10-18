import { PetScene } from "./PetScene";
import { petGrowth } from "./growth";
import type { PetState, Shop, ShopItem } from "./types";
import "./shop.css";

export const utcDay = (ms: number) => Math.floor(ms / 86400000);
export function dailyClaimed(pet: PetState, now: number) {
  return !!pet.economy?.lastDailyAt && utcDay(pet.economy.lastDailyAt) >= utcDay(now);
}
export function itemEquipped(pet: PetState, item: ShopItem) {
  return pet.economy?.equipped[item.slot] === item.id;
}
export function ShopPanel({ pet, shop, page, confirm, now }: {
  pet: PetState; shop: Shop | null; page: number; confirm: boolean; now: number;
}) {
  const e = pet.economy;
  const item = shop?.catalog[page - 1];
  const growth = petGrowth(pet, now);
  const owned = !!item && !!e?.owned.includes(item.id);
  const worn = !!item && itemEquipped(pet, item);
  const claimed = dailyClaimed(pet, now);
  const preview = { accessory: e?.equipped.accessory || "", room: e?.equipped.room || "", ...(item ? { [item.slot]: item.id } : {}) };
  const remaining = shop ? Math.max(0, shop.gameDailyLimit - (e?.lastGameAt && utcDay(e.lastGameAt) === utcDay(now) ? e.gameCoins : 0)) : 0;
  return <section className="shop-panel" aria-label="小窝商店" data-shop-page={page} data-confirm={confirm}>
    <header><strong>小窝商店</strong><span>◈ {e?.coins ?? 0} 金币</span></header>
    {!e || !shop ? <p>小店还没开门，请更新服务后再来看看。</p> : <>
      <div className="shop-preview" aria-hidden="true">
        <PetScene index={pet.species} stage={growth.stage} form={growth.form} motion={pet.sleeping ? "sleeping" : "idle"} clipId={0} dirty={false} equipped={preview} />
        <small>{item ? owned ? "已拥有 · 可随时更换" : "试穿预览 · 尚未购买" : "装扮不改变成长与成年形态"}</small>
      </div>
      <h3>{item ? item.name : "今天的小问候"}<span>{item ? `${item.price} 金币` : `+${shop.dailyCoins} 金币`}</span></h3>
      <p>{item ? item.description : "每天一次，无连续签到或断签惩罚。\n北京时间 8 点更新（UTC 0 点）。"}</p>
      <div className="shop-decision" role="status">{pet.sleeping ? "让它安心睡吧，起床后再操作。" : confirm && item ? `确认花 ${item.price} 金币购买？` : item ? owned ? worn ? "使用中 · B 收起来" : `B ${item.slot === "room" ? "摆放" : "穿戴"} · 不再扣金币` : e.coins < item.price ? `还差 ${item.price - e.coins} 金币，慢慢来。` : "B 购买 · 下一步确认" : claimed ? "今日已领取 · 明天再来就好" : "B 收下问候"}</div>
      <div className="shop-footer"><span>{confirm ? "A / C 取消 · B 确认" : `${page + 1} / ${shop.catalog.length + 1} · A 逛下一件`}</span><span>{item ? item.slot === "room" ? "小窝装饰" : "宠物装扮" : `今日游戏还可得 ${remaining} 币`}</span></div>
    </>}
  </section>;
}
