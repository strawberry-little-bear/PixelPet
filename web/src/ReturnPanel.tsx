import type { ReturnRecap } from "./types";
import { formNames, stageNames } from "./growth";
import "./return.css";

const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
export function absenceLabel(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
}
export function ReturnPanel({ recap, page }: { recap: ReturnRecap; page: number }) {
  const { before, after } = recap;
  const changed = before.stage !== after.stage;
  return <section className="return-panel" aria-label="回访小结">
    <header><strong>你回来啦</strong><span>{page + 1} / 2</span></header>
    {page === 0 ? <>
      <p>离开了 {absenceLabel(recap.to - recap.from)}</p>
      <div className="return-needs">
        {([ ["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"] ] as const).map(([key, label]) =>
          <div key={key}><span>{label}</span><strong>{before.needs[key].toFixed(1)} → {after.needs[key].toFixed(1)}</strong><small>{signed(after.needs[key] - before.needs[key])}</small></div>)}
      </div>
      <small>这里只记录离开期间实际结算的变化</small>
    </> : <>
      <p className="return-stage">{changed ? `${stageNames[before.stage]} → ${stageNames[after.stage]}` : `仍在${stageNames[after.stage]}`}</p>
      {changed && before.stage === "baby" && after.stage === "adult" && <small>期间也走过了成长期</small>}
      {after.stage === "adult" && <small>{formNames[after.form || "balanced"]}已定型，不会改写</small>}
      <dl>
        <div><dt>成长</dt><dd>{signed(after.points - before.points, 2)} 点</dd></div>
        <div><dt>有效休息</dt><dd>+{Math.max(0, after.rest - before.rest).toFixed(2)} 习惯</dd></div>
        <div><dt>结算时长</dt><dd>{Math.max(0, after.trackedHours - before.trackedHours).toFixed(2)} 小时</dd></div>
      </dl>
      <small>单次离线最多结算 12 小时 · 无额外奖励</small>
    </>}
  </section>;
}
