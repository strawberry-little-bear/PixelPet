import { useCallback, useRef } from "react";
import { CareAdvice } from "./CareAdvice";
import type { PetState, ReturnRecap } from "./types";
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
const sleepLabel = (sleeping: boolean | undefined) => sleeping === true ? "睡眠" : sleeping === false ? "清醒" : "未记录";
const recordTime = (at: number) => new Date(at).toLocaleString("zh-CN", {
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function ReturnPanel({ recap, page, updated = false, pet }: { recap: ReturnRecap; page: number; updated?: boolean; pet?: PetState }) {
  const restoreFocus = useRef(false);
  const panel = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (restoreFocus.current) {
      node.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
    return () => { restoreFocus.current = document.activeElement === node; };
  }, []);
  // A fresh scroll container also cancels a still-running native End animation.
  // Merely assigning scrollTop=0 lets later browser frames scroll the new page.
  // Same-record updates retain the node, scroll position and reading focus.
  const { before, after } = recap;
  const changed = before.stage !== after.stage;
  const smallChange = page === 0
    ? (["hunger", "mood", "clean", "energy"] as const).some(key => tiny(after.needs[key] - before.needs[key], 1))
    : [after.points - before.points, Math.max(0, after.rest - before.rest), Math.max(0, after.trackedHours - before.trackedHours)].some(n => tiny(n, 2));
  return <section key={JSON.stringify([recap.id, page])} ref={panel} className="return-panel" aria-label="回访小结" tabIndex={0}>
    <header><strong>你回来啦</strong><span>{page + 1} / {returnPageCount}</span></header>
    <small className="return-scroll-hint">可上下滚动阅读；聚焦后可用 ↑/↓ 或空格</small>
    {updated && <p className="return-sync-note" role="status">已更新为最新回访记录，本次从第一页开始。</p>}
    <div className="return-period" aria-label="记录时段（本地时间）">
      <small>记录时段（本地时间）</small>
      <span>从 <time dateTime={new Date(recap.from).toISOString()}>{recordTime(recap.from)}</time></span>
      <span>到 <time dateTime={new Date(recap.to).toISOString()}>{recordTime(recap.to)}</time></span>
    </div>
    <div className="return-period" aria-label="历史睡眠状态">
      <span>离开时：{sleepLabel(before.sleeping)}</span>
      <span>结算结束时：{sleepLabel(after.sleeping)}</span>
      <small>仅为两个时点的记录，不代表当前状态或整个离开期间。</small>
      {(typeof before.sleeping !== "boolean" || typeof after.sleeping !== "boolean") && <small>旧记录缺失的信息不作推测。</small>}
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
      <small aria-label="结算时长说明">这是记录时段内的累计结算，不等同于离开时长；期间如有读取，可能分多次结算。</small>
      <small>每次结算有上限，具体见状态页时间说明；无额外奖励。</small>
    </>}
    {smallChange && <small>「&lt;」表示变化小于显示精度，并非没有变化；前后读数仍按原精度四舍五入。</small>}
    {page === returnPageCount - 1 && <div className="return-care" aria-label="现在的照顾建议">
      <h3>现在怎么照顾</h3>
      {pet ? <>
        <p>最近读取：{pet.sleeping ? "正在睡觉" : "清醒中"}</p>
        <CareAdvice pet={pet} />
        <small>建议按最近读取的当前状态，不是上方的历史记录。</small>
      </> : <p>当前状态尚未读到，回小窝后再查看。</p>}
      <small>B / C 回小窝，再从菜单选择；这里不会自动照顾。</small>
    </div>}
  </section>;
}
