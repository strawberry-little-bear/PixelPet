import type { PetState } from "./types";

type CareKind = "feed" | "clean" | "sleep";
const interval = 30 * 60000;

// This is a read-only explanation of the last authoritative snapshot, not a
// client-side reward decision. In particular, a local clock/timer must not make
// a cached cooldown expire or disable an action that the server could accept.
export function carePreview(pet: PetState, kind: CareKind): string[] {
  if (!pet.hatchedAt) return ["先迎接小伙伴，再慢慢照顾它。"];
  if (pet.game) return ["先收好或结束本局，再照顾小伙伴。"];
  if (kind === "sleep") {
    if (pet.sleeping) return [
      "按 B 轻轻叫醒，停止睡眠恢复。",
      "只按实际恢复的体力记休息习惯，不因反复睡下或叫醒多记。",
    ];
    return [
      pet.needs.energy >= 100
        ? "体力已经满了，也可以安静休息；体力不再恢复时，不增加休息习惯。"
        : "睡着后体力慢慢恢复，到满为止；饱食和清洁仍会下降。",
      !pet.growth
        ? "成长记录尚未读到；只按实际恢复量记录休息，结果以服务端为准。"
        : pet.growth.stage === "adult"
        ? "每恢复 28 体力，休息习惯 +1；成年形态不变。"
        : "每恢复 28 体力，休息习惯 +1、成长 +0.25；按实际恢复比例记录。",
    ];
  }
  if (pet.sleeping) return ["正在睡觉；先选「起床啦」叫醒，再喂食或洗澡。"];
  const feeding = kind === "feed";
  const need = feeding ? pet.needs.hunger : pet.needs.clean;
  if (need >= (feeding ? 96 : 99)) return [feeding
    ? "肚子已经饱饱的；暂时不能喂食，等需要时再来。"
    : "已经干干净净的；暂时不用洗澡。"];

  const effect = feeding ? "补充饱食，让心情变好，也会稍微弄脏。" : "恢复清洁，也让心情轻松些。";
  // The server checks need before cooldown. Keep that same priority even when
  // both would prevent a habit credit. Missing legacy growth is not evidence
  // of a new reward; let the next authoritative response supply its history.
  if (need > (feeding ? 70 : 65)) return [effect, feeding
    ? "饱食已满足；饱食 ≤70 时喂食才记习惯，本次不记。"
    : "清洁已满足；清洁 ≤65 时洗澡才记习惯，本次不记。"];
  if (!pet.growth) return [effect, "成长记录尚未读到；是否记习惯，以照顾后的结果为准。"];
  const last = feeding ? pet.growth.care.lastFeed : pet.growth.care.lastClean;
  if (last > 0 && pet.lastTick - last < interval) return [effect,
    "同类习惯还在 30 分钟间隔内；照顾仍能改善状态，本次暂不记习惯。"];
  return [effect, pet.growth.stage === "adult"
    ? "符合记录习惯的条件；成年后只记习惯，形态不变。"
    : "符合记录习惯的条件；习惯 +1、成长 +0.25，临近成年时成长封顶。"];
}

export function CarePreview({ pet, kind, hint }: { pet: PetState; kind: string; hint: string }) {
  const care = kind === "feed" || kind === "clean" || kind === "sleep";
  const lines = care ? carePreview(pet, kind) : [hint];
  return (
    <div className="care-preview" role="note" aria-label="所选菜单说明" data-care-preview={kind}>
      <strong>{care ? "照顾前看看" : "菜单说明"}</strong>
      {lines.map(line => <p key={line}>{line}</p>)}
      {care && <small>按最近读取的状态预览，实际以照顾结果为准；不必为了成长反复照顾。</small>}
    </div>
  );
}
