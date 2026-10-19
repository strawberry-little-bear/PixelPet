import type { PetState, SleepSession } from "./types";
import "./sleep-progress.css";

const date = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;
const nonnegative = (n: number) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const amount = (n: number) => n > 0 && n < .005 ? "<0.01" : n.toFixed(2);
const localTime = (n: number) => new Date(n).toLocaleString("zh-CN", {
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

// Read a single authoritative snapshot, not a client timer or a subtraction of
// lifetime totals. Missing/invalid optional history never means zero recovery.
function recordedProgress(pet: PetState): SleepSession | null {
  const s = pet.sleepSession, g = pet.growth, eps = 1e-7;
  if (!pet.sleeping || pet.game || (!Number.isSafeInteger(pet.schema) || pet.schema < 17) || !date(pet.hatchedAt) || !date(pet.lastTick) ||
      !s || !g || !["baby", "growing", "adult"].includes(g.stage) || !date(s.startedAt) ||
      s.startedAt < pet.hatchedAt || s.startedAt > pet.lastTick) return null;
  if (![s.settledHours, s.energyRecovered, s.restGain, s.growthPoints, g.points, g.trackedHours, g.care?.rest, pet.needs.energy].every(nonnegative)) return null;
  if (g.points > 72 || pet.needs.energy > 100 ||
      s.settledHours > (pet.lastTick - s.startedAt) / 3600000 + eps || s.settledHours > g.trackedHours + eps ||
      s.energyRecovered > pet.needs.energy + eps || s.restGain > g.care.rest + eps || s.growthPoints > g.points + eps ||
      (s.settledHours === 0 && (s.energyRecovered !== 0 || s.restGain !== 0 || s.growthPoints !== 0)) ||
      (s.energyRecovered === 0 && s.restGain !== 0)) return null;
  return s;
}

export function SleepProgress({ pet }: { pet: PetState }) {
  const s = recordedProgress(pet);
  if (!s) return null;
  const unsettled = Math.max(0, (pet.lastTick - s.startedAt) / 3600000 - s.settledHours);
  return <section className="sleep-progress" role="group" aria-label="本段休息的已保存进度">
    <strong>本段休息 · 最近读取</strong>
    <span>入睡：<time dateTime={new Date(s.startedAt).toISOString()}>{localTime(s.startedAt)}</time></span>
    <span>记录截至：<time dateTime={new Date(pet.lastTick).toISOString()}>{localTime(pet.lastTick)}</time>（本地时间）</span>
    <dl>
      <div><dt>实际结算：</dt><dd>{amount(s.settledHours)} 小时</dd></div>
      <div><dt>恢复体力：</dt><dd>+{amount(s.energyRecovered)}</dd></div>
      <div><dt>休息习惯：</dt><dd>+{amount(s.restGain)}</dd></div>
      <div><dt>睡眠期间成长：</dt><dd>+{amount(s.growthPoints)} 点</dd></div>
    </dl>
    {unsettled > 1e-7 && <p>未计入结算：{amount(unsettled)} 小时。单次结算有上限，这部分不会补算，也不是额外损失的体力或成长。</p>}
    <p>包含期间自然成长，不是叫醒奖励；体力满后不再计休息习惯，成年形态不重选。</p>
    <small>只展示本次入睡后已保存的结算，不按浏览器时间估算。查看不会叫醒；起床小结以实际结果为准。</small>
  </section>;
}
