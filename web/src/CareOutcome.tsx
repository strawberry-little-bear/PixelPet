import type { CareFeedback, Needs } from "./types";
import "./care-outcome.css";

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

export function CareOutcome({ feedback }: { feedback: CareFeedback | null }) {
  if (!feedback || !validEffect(feedback.effect)) return null;
  const { before, after, at } = feedback.effect;
  const action = feedback.kind === "feed" ? "喂食" : feedback.kind === "clean" ? "洗澡" :
    feedback.kind === "sleep" ? feedback.reason === "awake" ? "起床" : "入睡" : "陪玩";
  return <section className="care-outcome" aria-label="上次操作的即时变化">
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
    {feedback.kind === "sleep" && <p>入睡和起床不立即恢复体力；睡着期间才逐步恢复，到满为止。</p>}
    <small>仅含操作即时变化，不含此前时间结算；不是当前读数。本页暂存，刷新后不保留。</small>
  </section>;
}
