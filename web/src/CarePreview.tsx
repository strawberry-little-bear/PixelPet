import type { CareRules, Needs, PetState } from "./types";
import { sleepGrowthGuidance } from "./sleepGuidance";
import { careMenuLabel } from "./careMenu";

type CareKind = "feed" | "clean" | "sleep";
const interval = 30 * 60000;
const careNeeds = {
  feed: { key: "hunger", label: "饱食", habitAt: 70, fullAt: 96 },
  clean: { key: "clean", label: "清洁", habitAt: 65, fullAt: 99 },
} as const;
const fullEnergy = 100;

// Meters use rounded integers, but eligibility still uses the authoritative
// fractional reading. Explain only a boundary that looks equal on the meter.
function roundedReading(pet: PetState, kind: CareKind): string | null {
  if (!pet.hatchedAt || pet.game || (pet.sleeping && kind !== "sleep")) return null;
  const config = kind === "sleep" ? null : careNeeds[kind];
  const value = config ? pet.needs[config.key] : pet.needs.energy;
  const label = config ? config.label : "体力";
  const thresholds = config ? [config.habitAt, config.fullAt] : [fullEnergy];
  const threshold = thresholds.find(at => value !== at && Math.round(value) === at);
  return threshold === undefined ? null
    : `最近读取：${label}实际${value > threshold ? "高于" : "低于"} ${threshold}，整数显示 ${threshold}。`;
}

// This is a read-only explanation of the last authoritative snapshot, not a
// client-side reward decision. In particular, a local clock/timer must not make
// a cached cooldown expire or disable an action that the server could accept.
export function carePreview(pet: PetState, kind: CareKind, rules?: CareRules | null): string[] {
  if (!pet.hatchedAt) return ["先迎接小伙伴，再慢慢照顾它。"];
  if (pet.game) return ["先收好或结束本局，再照顾小伙伴。"];
  if (kind === "sleep") {
    if (pet.sleeping) return [
      "按 B 轻轻叫醒，停止睡眠恢复。",
      "只按实际恢复的体力记休息习惯，不因反复睡下或叫醒多记。",
    ];
    return [
      pet.needs.energy >= fullEnergy
        ? "体力已经满了，也可以安静休息；体力不再恢复时，不增加休息习惯；饱食和清洁仍会下降。"
        : "睡着后体力慢慢恢复，到满为止；饱食和清洁仍会下降。",
      sleepGrowthGuidance(pet.growth, rules),
    ];
  }
  if (pet.sleeping) return [`正在睡觉；先选「${careMenuLabel("sleep", true)}」叫醒，再选「${careMenuLabel(kind)}」。`];
  const feeding = kind === "feed";
  const config = careNeeds[kind];
  const need = pet.needs[config.key];
  if (need >= config.fullAt) return [feeding
    ? "肚子已经饱饱的；暂时不能喂食，等需要时再来。"
    : "已经干干净净的；暂时不用洗澡。"];

  const effect = feeding ? "补充饱食，让心情变好，也会稍微弄脏。" : "恢复清洁，也让心情轻松些。";
  // The server checks need before cooldown. Keep that same priority even when
  // both would prevent a habit credit. Missing legacy growth is not evidence
  // of a new reward; let the next authoritative response supply its history.
  if (need > config.habitAt) return [effect, feeding
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

const effectLabels = [["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"]] as const;

// Optional response-only metadata. Invalid/missing action effects must not
// suppress legacy text or the independently validated passive rate guide.
export function careBaseEffect(pet: PetState, kind: string, rules?: CareRules | null): Needs | null {
  if (!pet.hatchedAt || pet.game || pet.sleeping || (kind !== "feed" && kind !== "clean")) return null;
  const config = careNeeds[kind];
  if (pet.needs[config.key] >= config.fullAt) return null;
  const effect = rules?.actions?.[kind];
  return effect && effectLabels.every(([key]) => typeof effect[key] === "number" && Number.isFinite(effect[key]) && Math.abs(effect[key]) <= 100)
    ? effect : null;
}

export function CarePreview({ pet, kind, hint, rules }: { pet: PetState; kind: string; hint: string; rules?: CareRules | null }) {
  const care = kind === "feed" || kind === "clean" || kind === "sleep";
  const effect = careBaseEffect(pet, kind, rules);
  const lines = care ? carePreview(pet, kind, rules) : [hint];
  const reading = care ? roundedReading(pet, kind) : null;
  return (
    <div className="care-preview" role="note" aria-label="所选菜单说明" data-care-preview={kind}>
      <strong>{care ? "照顾前看看" : "菜单说明"}</strong>
      {lines.map(line => <p key={line}>{line}</p>)}
      {reading && <p className="care-rounded-reading">{reading}</p>}
      {effect && <section className="care-base-effect" aria-label="本次照顾的基准变化">
        <strong>操作基准 · 不含时间结算</strong>
        <dl>{effectLabels.map(([key, label]) => <div key={key} data-need={key}>
          <dt>{label}</dt><dd>{effect[key] === 0 ? "不变" : `${effect[key] > 0 ? "+" : "−"}${Math.abs(effect[key])}`}</dd>
        </div>)}</dl>
        <small>各项到 0 / 100 为止，实际变化可能更少；不是操作后的预测。成长与习惯另按条件记录。</small>
      </section>}
      {care && <small>按最近读取的状态预览，实际以照顾结果为准；不必为了成长反复照顾。</small>}
    </div>
  );
}
