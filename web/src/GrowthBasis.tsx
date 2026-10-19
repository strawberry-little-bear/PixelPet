import type { CareRules, GrowthRuleBasis, GrowthStage } from "./types";

// Optional server response metadata: never replace a missing coefficient
// with today's hardcoded defaults, or break successful reads from older servers.
function validBasis(value: unknown): value is GrowthRuleBasis {
  if (!value || typeof value !== "object") return false;
  const v = value as GrowthRuleBasis;
  const points = [v.basePerHour, v.comfortPerHour, v.restPointsPerHabit];
  return points.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 72) &&
    typeof v.restEnergyPerHabit === "number" && Number.isFinite(v.restEnergyPerHabit) && v.restEnergyPerHabit > 0 && v.restEnergyPerHabit <= 100;
}

export function GrowthBasis({ stage, rules }: { stage: GrowthStage; rules?: CareRules | null }) {
  const g = rules?.growth;
  return <section className="growth-basis" aria-label="成长与照顾基准">
    <h4>舒适与休息，怎样帮助长大</h4>
    {stage === "egg" ? <p>孵化后才开始积累成长；现在不预报长大时间。</p> : <>
      {stage === "adult" && <p>成长已完成，不再增加成长点；成年形态不会重选。</p>}
      {validBasis(g) ? <>
        {stage !== "adult" && <>
          <p>自然成长基准（点/小时）<br />{g.basePerHour} + {g.comfortPerHour} × 舒适比例</p>
          <p>舒适比例是四项需求的平均值 ÷ 100，随状态变化累计，不只看某一刻或历史平均。</p>
        </>}
        <p>睡眠每实际恢复 {g.restEnergyPerHabit} 点体力，累计 1 点休息习惯{stage === "adult" ? "。" : `、+${g.restPointsPerHabit} 成长点。`}可分次积累；体力满后不再增加这部分。</p>
      </> : <p>成长基准尚未读到，暂不显示数字；以已保存的状态和实际照顾结果为准。</p>}
      <p>这是结算基准，不是到达下一阶段的时间预测；入睡本身不送体力或成长点。</p>
    </>}
  </section>;
}
