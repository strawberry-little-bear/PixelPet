import type { CareFeedback, SleepSummary as Summary } from "./types";

const positiveDate = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;
const amount = (n: number) => n > 0 && n < .005 ? "<0.01" : n.toFixed(2);
const localTime = (n: number) => new Date(n).toLocaleString("zh-CN", {
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

// A wake receipt is server history, not a difference between later pet totals
// or a front-end bedtime. Invalid/old optional metadata must degrade quietly.
function recordedSleep(f: CareFeedback): Summary | null {
  const s = f.sleepSummary;
  if (f.kind !== "sleep" || f.reason !== "awake" || f.points !== 0 || f.habitGain !== 0 || f.habit ||
    !s || !positiveDate(s.startedAt) || !positiveDate(s.wokeAt) || s.startedAt > s.wokeAt || s.wokeAt !== f.effect?.at) return null;
  if (![s.settledHours, s.energyRecovered, s.restGain, s.growthPoints].every(n =>
    typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  if (s.settledHours > (s.wokeAt - s.startedAt) / 3600000 + 1e-7 || s.energyRecovered > 100 ||
    s.energyRecovered > (f.effect?.before.energy ?? -1) + 1e-7 || s.restGain > 1e6 || s.growthPoints > 72 ||
    (s.settledHours === 0 && (s.energyRecovered !== 0 || s.restGain !== 0 || s.growthPoints !== 0)) ||
    (s.energyRecovered === 0 && s.restGain !== 0)) return null;
  return s;
}

export function SleepSummary({ feedback }: { feedback: CareFeedback }) {
  const summary = recordedSleep(feedback);
  if (!summary) return null;
  return <div className="care-learning sleep-summary" role="group" aria-label="这次睡眠的实际结算">
    <h3>这次睡眠 · 已确认</h3>
    <span>入睡：<time dateTime={new Date(summary.startedAt).toISOString()}>{localTime(summary.startedAt)}</time></span>
    <span>起床：<time dateTime={new Date(summary.wokeAt).toISOString()}>{localTime(summary.wokeAt)}</time>（本地时间）</span>
    <span>实际结算：{amount(summary.settledHours)} 小时</span>
    <strong>恢复体力：+{amount(summary.energyRecovered)}</strong>
    <span>休息习惯：+{amount(summary.restGain)}</span>
    <span>睡眠期间成长：+{amount(summary.growthPoints)} 点</span>
    <p>包含期间自然成长，不是起床奖励；体力满后不再计休息习惯，成年形态不重选。</p>
    <small>仅统计这次入睡后已保存的结算；长时间离开仍沿用单次结算上限，不补算超出部分。本页暂存，刷新后不重建。</small>
  </div>;
}
