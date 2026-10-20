import type { CareFeedback, Needs } from "./types";
import "./care-outcome.css";
import { SleepSummary } from "./SleepSummary";
import { CareReadingRegion } from "./CareReadingRegion";
import { careHabitUnits } from "./careHabitUnits";
import { formNames } from "./growth";

const needLabels = [["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"]] as const;

// Optional response metadata must never turn an older acknowledgement or a bad
// numeric payload into a fabricated receipt (or a failed successful action).
function validNeeds(value: unknown): value is Needs {
  if (!value || typeof value !== "object") return false;
  return needLabels.every(([key]) => {
    const n = (value as Needs)[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
  });
}
function validEffect(effect: CareFeedback["effect"]): effect is NonNullable<CareFeedback["effect"]> {
  return !!effect && Number.isSafeInteger(effect.at) && effect.at > 0 && effect.at <= 8.64e15 &&
    validNeeds(effect.before) && validNeeds(effect.after);
}
const change = (n: number) => n === 0 ? "不变" : `${n > 0 ? "+" : "−"}${Math.abs(n) < .005 ? "<0.01" : Math.abs(n).toFixed(2)}`;

// This is the acknowledged action's snapshot, not a recalculation from the
// current pet or a live cooldown. A later poll must not rewrite its explanation.
function learningSummary(f: CareFeedback): { habit: string; reason: string } | null {
  const habitGain = careHabitUnits(f.habitGain);
  if (!Number.isFinite(f.points) || f.points < 0 || f.points > 72 ||
      habitGain === null) return null;
  if (f.kind === "sleep") {
    return ["resting", "awake"].includes(f.reason) && !f.habit && f.points === 0 && habitGain === 0
      ? { habit: "休息习惯：本次切换不计入", reason: "本次切换不计休息习惯；睡着期间按实际恢复体力记录。" } : null;
  }
  const habit = f.kind === "feed" ? "nutrition" : f.kind === "clean" ? "clean" :
    ["catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"].includes(f.kind) ? "play" : null;
  if (!habit || f.habit !== habit) return null;
  const label = { nutrition: "喂食习惯", clean: "清洁习惯", play: "陪玩习惯" }[habit];
  if (f.reason === "credited" && habitGain === 1)
    return { habit: `${label}：+1`, reason: "本次习惯已计入；成长点按实际增加量显示。" };
  if (habitGain !== 0 || f.points !== 0) return null;
  if (f.reason === "not-needed" && (f.kind === "feed" || f.kind === "clean"))
    return { habit: `${label}：+0`, reason: `记录时${f.kind === "feed" ? "饱食" : "清洁"}已满足，本次不计习惯。` };
  return f.reason === "cooldown"
    ? { habit: `${label}：+0`, reason: "记录时同类习惯仍在间隔内；本次不计入，不代表状态没有改善。" } : null;
}

// Never infer a historical transition from the current pet, points, or a local
// clock. Old receipts simply omit it; malformed optional data stays quiet.
function milestoneText(f: CareFeedback): string | null {
  const m = f.milestone;
  if (!m || f.reason !== "credited" || !(f.points > 0) || careHabitUnits(f.habitGain) !== 1 || m.at !== f.effect?.at) return null;
  if (m.stage === "growing" && (m.form === undefined || m.form === "")) return "这次照顾推动进入成长期";
  if (m.stage === "adult" && m.form && ["balanced", "lively", "gentle", "easygoing"].includes(m.form))
    return `这次照顾推动进入成年期 · ${formNames[m.form]}已定型`;
  return null;
}

export function CareOutcome({ feedback, readable = false }: { feedback: CareFeedback | null; readable?: boolean }) {
  if (!feedback || !validEffect(feedback.effect)) return null;
  const { before, after, at } = feedback.effect;
  const learning = learningSummary(feedback);
  const milestone = learning ? milestoneText(feedback) : null;
  const action = feedback.kind === "feed" ? "喂食" : feedback.kind === "clean" ? "洗澡" :
    feedback.kind === "sleep" ? feedback.reason === "awake" ? "起床" : "入睡" : "陪玩";
  const outcome = <section className="care-outcome" aria-label="上次操作的即时变化">
    <h3>本页上次已确认 · {action}</h3>
    <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString("zh-CN", {
      year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false,
    })}（本地时间）</time>
    <dl>
      {needLabels.map(([key, label]) => <div key={key} data-need={key}>
        <dt>{label}</dt>
        <dd><span>{before[key].toFixed(2)} → {after[key].toFixed(2)}</span><strong>{change(after[key] - before[key])}</strong></dd>
      </div>)}
    </dl>
    {learning && <div className="care-learning" role="group" aria-label="本次成长与习惯">
      <strong>本次成长：+{feedback.points > 0 && feedback.points < .005 ? "<0.01" : feedback.points.toFixed(2)} 点</strong>
      <span>{learning.habit}</span>
      <p>{learning.reason}</p>
      <small>习惯可继续记录；成年形态不会因之后照顾重选。</small>
    </div>}
    {milestone && <div className="care-learning care-milestone" role="group" aria-label="本次照顾的成长阶段">
      <strong>{milestone}</strong>
      <small>这是本次已确认的阶段变化，不含操作前的自然成长；之后读取不会改写这条回执。</small>
    </div>}
    {feedback.kind === "sleep" && <p>入睡和起床不立即恢复体力；睡着期间才逐步恢复，到满为止。</p>}
    <small>以上仅含操作即时变化，不含此前时间结算；不是当前读数。本页暂存，刷新后不保留。</small>
    <SleepSummary feedback={feedback} />
  </section>;
  // Home has no surrounding reading region. Status already has its own stop,
  // so opt in only at home and never expose an empty stop for invalid metadata.
  return readable ? <CareReadingRegion className="care-outcome-reading" label="照顾结果阅读区"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    {outcome}
  </CareReadingRegion> : outcome;
}
