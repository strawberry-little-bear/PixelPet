import type { CareRules, Needs, PetState } from "./types";
import { sleepGrowthGuidance } from "./sleepGuidance";
import { careMenuLabel } from "./careMenu";
import { SleepProgress } from "./SleepProgress";

type CareKind = "feed" | "clean" | "sleep";
const interval = 30 * 60000;
const careNeeds = {
  feed: { key: "hunger", label: "饱食", habitAt: 70, fullAt: 96 },
  clean: { key: "clean", label: "清洁", habitAt: 65, fullAt: 99 },
} as const;
const fullEnergy = 100;

// Response-only capability: old servers retain exact comparisons. Reject a
// malformed/oversized tolerance rather than promising different care rules.
// Normalize only the comparison, never the saved reading or displayed effects.
function careNeed(value: number, boundary: number, rules?: CareRules | null) {
  const tolerance = rules?.needTolerance;
  return typeof tolerance === "number" && Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1e-9 &&
    Math.abs(value - boundary) <= tolerance ? boundary : value;
}

// Share snapshot restrictions between the selected-choice prompt and its full
// explanation. This is guidance only: B still asks the server, whose next tick
// may make care available even when the cached reading is at the limit.
function careRestriction(pet: PetState, kind: string, rules?: CareRules | null): { prompt: string; detail: string } | null {
  if (kind !== "feed" && kind !== "clean" && kind !== "arcade") return null;
  if (pet.sleeping) return {
    prompt: "最近读取：先叫醒它",
    detail: kind === "arcade"
      ? `正在睡觉；先从菜单选「${careMenuLabel("sleep", true)}」，醒来后再一起玩。`
      : `正在睡觉；先选「${careMenuLabel("sleep", true)}」叫醒，再选「${careMenuLabel(kind)}」。`,
  };
  if (kind === "arcade") return null;
  const config = careNeeds[kind];
  return careNeed(pet.needs[config.key], config.fullAt, rules) >= config.fullAt
    ? kind === "feed"
      ? { prompt: "最近读取：暂不能喂食", detail: "肚子已经饱饱的；暂时不能喂食，等需要时再来。" }
      : { prompt: "最近读取：暂不用洗澡", detail: "已经干干净净的；暂时不用洗澡。" }
    : null;
}

export function careMenuConfirmation(pet: PetState, kind: string, rules?: CareRules | null): string {
  return careRestriction(pet, kind, rules)?.prompt ?? "B 确认";
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "未知";
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0 && value > 0) return "<0.01";
  return String(rounded);
}

// Near the cap, explain the actual remaining room instead of making a capped
// action look like a full meal. Side effects are rule baselines, not a forecast
// of the next settled reading: each need stops at 0/100.
// The server still owns the 96-point rejection.
function cappedFeedGuidance(need: number, rules?: CareRules | null): string | null {
  const nominalGain = rules?.actions?.feed?.hunger ?? 20;
  if (nominalGain <= 0 || need + nominalGain <= 100) return null;
  const room = Math.max(0, 100 - need);
  const cleanDelta = rules?.actions?.feed?.clean;
  const sideEffect = typeof cleanDelta === "number" && Number.isFinite(cleanDelta)
    ? cleanDelta < 0 ? `清洁基准下降 ${compactNumber(Math.abs(cleanDelta))} 点，到 0 为止` : cleanDelta > 0 ? `清洁基准增加 ${compactNumber(cleanDelta)} 点，到 100 为止` : "清洁不变"
    : "清洁可能稍微下降，最低到 0";
  return `当前仍可确认，但饱食效果会被 100 封顶；最多补 ${compactNumber(room)} 点到 100；${sideEffect}。饱食达到 96 后不能喂食。`;
}

// Meters use rounded integers, but eligibility still uses the authoritative
// fractional reading. Explain only a boundary that looks equal on the meter.
function roundedReading(pet: PetState, kind: CareKind, rules?: CareRules | null): string | null {
  if (!pet.hatchedAt || pet.game || (pet.sleeping && kind !== "sleep")) return null;
  const config = kind === "sleep" ? null : careNeeds[kind];
  const value = config ? pet.needs[config.key] : pet.needs.energy;
  const label = config ? config.label : "体力";
  const thresholds = config ? [config.habitAt, config.fullAt] : [fullEnergy];
  const threshold = thresholds.find(at => (kind === "sleep" ? value : careNeed(value, at, rules)) !== at && Math.round(value) === at);
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
      ...(pet.sleepSession == null ? [
        `本段没有完整入睡记录，仍照常恢复体力；起床不倒推整段小结。${pet.schema >= 17 ? "下次明确入睡后开始记录。" : "当前服务未提供整段睡眠记录。"}`,
      ] : []),
    ];
    return [
      pet.needs.energy >= fullEnergy
        ? "体力已经满了，也可以安静休息；体力不再恢复时，不增加休息习惯；饱食和清洁仍会下降。"
        : "睡着后体力慢慢恢复，到满为止；饱食和清洁仍会下降。",
      sleepGrowthGuidance(pet.growth, rules),
    ];
  }
  const restriction = careRestriction(pet, kind, rules);
  if (restriction) return [restriction.detail];
  const feeding = kind === "feed";
  const config = careNeeds[kind];
  const need = pet.needs[config.key];

  const effect = feeding ? "补充饱食，让心情变好，也可能稍微弄脏。" : "恢复清洁，也让心情轻松些。";
  const capped = feeding ? cappedFeedGuidance(need, rules) : null;
  // The server checks need before cooldown. Keep that same priority even when
  // both would prevent a habit credit. Missing legacy growth is not evidence
  // of a new reward; let the next authoritative response supply its history.
  if (careNeed(need, config.habitAt, rules) > config.habitAt) return [effect, ...(capped ? [capped] : []), feeding
    ? "饱食已满足（需求已满足）；饱食 ≤70 时喂食才记习惯，本次不记。"
    : "清洁已满足（需求已满足）；清洁 ≤65 时洗澡才记习惯，本次不记。"];
  if (!pet.growth) return [effect, "成长记录尚未读到；是否记习惯，以照顾后的结果为准。"];
  const last = feeding ? pet.growth.care.lastFeed : pet.growth.care.lastClean;
  // A malformed/future history cannot establish eligibility or a duration.
  // Use only the accepted snapshot clock, never Date.now() or a countdown.
  if (!Number.isSafeInteger(pet.lastTick) || pet.lastTick <= 0 ||
    !Number.isSafeInteger(last) || last < 0 || last > pet.lastTick) return [effect,
    "同类习惯间隔待同步；照顾仍能改善状态，是否记入以实际结果为准。"];
  const remaining = last + interval - pet.lastTick;
  if (last > 0 && remaining > 0) return [effect,
    `同类习惯还在 30 分钟间隔内；最近读取时约还需 ${Math.ceil(remaining / 60000)} 分钟。照顾仍能改善状态，是否记习惯以实际结果为准。`];
  return [effect, ...(capped ? [capped] : []), pet.growth.stage === "adult"
    ? "符合记录习惯的条件；成年后只记习惯，形态不变。"
    : "符合记录习惯的条件；习惯 +1、成长 +0.25，临近成年时成长封顶。"];
}

const effectLabels = [["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"]] as const;

// Optional response-only metadata. Invalid/missing action effects must not
// suppress legacy text or the independently validated passive rate guide.
export function careBaseEffect(pet: PetState, kind: string, rules?: CareRules | null): Needs | null {
  if (!pet.hatchedAt || pet.game || pet.sleeping || (kind !== "feed" && kind !== "clean")) return null;
  if (careRestriction(pet, kind, rules)) return null;
  const effect = rules?.actions?.[kind];
  return effect && effectLabels.every(([key]) => typeof effect[key] === "number" && Number.isFinite(effect[key]) && Math.abs(effect[key]) <= 100)
    ? effect : null;
}

export function CarePreview({ pet, kind, hint, rules }: { pet: PetState; kind: string; hint: string; rules?: CareRules | null }) {
  const care = kind === "feed" || kind === "clean" || kind === "sleep";
  const effect = careBaseEffect(pet, kind, rules);
  const restriction = careRestriction(pet, kind, rules);
  const lines = care ? carePreview(pet, kind, rules) : [restriction?.detail ?? hint];
  const reading = care ? roundedReading(pet, kind, rules) : null;
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
      {kind === "sleep" && <SleepProgress pet={pet} />}
      {(care || restriction) && <small>按最近读取的状态预览，实际以照顾结果为准；不必为了成长反复照顾。</small>}
    </div>
  );
}
