import type { ReturnRecap } from "./types";
import { formNames, stageNames } from "./growth";
import "./return.css";

export const returnPageCount = 2;

// A real nonzero settlement must not become a signed zero after rounding.
// Preserve ordinary precision and exact zero; only mark sub-display changes.
const tiny = (n: number, digits: number) => n !== 0 && Number(Math.abs(n).toFixed(digits)) === 0;
const amount = (n: number, digits = 2) => tiny(n, digits) ? `<${(10 ** -digits).toFixed(digits)}` : Math.abs(n).toFixed(digits);
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${amount(n, digits)}`;
export function absenceLabel(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
}
const recordTime = (at: number) => new Date(at).toLocaleString("zh-CN", {
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function ReturnPanel({ recap, page, updated = false }: { recap: ReturnRecap; page: number; updated?: boolean }) {
  const { before, after } = recap;
  const changed = before.stage !== after.stage;
  const smallChange = page === 0
    ? (["hunger", "mood", "clean", "energy"] as const).some(key => tiny(after.needs[key] - before.needs[key], 1))
    : [after.points - before.points, Math.max(0, after.rest - before.rest), Math.max(0, after.trackedHours - before.trackedHours)].some(n => tiny(n, 2));
  return <section className="return-panel" aria-label="回访小结">
    <header><strong>你回来啦</strong><span>{page + 1} / {returnPageCount}</span></header>
    {updated && <p className="return-sync-note" role="status">已更新为最新回访记录，本次从第一页开始。</p>}
    <div className="return-period" aria-label="记录时段（本地时间）">
      <small>记录时段（本地时间）</small>
      <span>从 <time dateTime={new Date(recap.from).toISOString()}>{recordTime(recap.from)}</time></span>
      <span>到 <time dateTime={new Date(recap.to).toISOString()}>{recordTime(recap.to)}</time></span>
    </div>
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
        <div><dt>有效休息</dt><dd>+{amount(Math.max(0, after.rest - before.rest))} 习惯</dd></div>
        <div><dt>结算时长</dt><dd>{amount(Math.max(0, after.trackedHours - before.trackedHours))} 小时</dd></div>
      </dl>
      <small>单次离线最多结算 12 小时 · 无额外奖励</small>
    </>}
    {smallChange && <small>「&lt;」表示变化小于显示精度，并非没有变化；前后读数仍按原精度四舍五入。</small>}
  </section>;
}
