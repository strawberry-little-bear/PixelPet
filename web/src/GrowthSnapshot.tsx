import { validGrowthBasis } from "./growth";
import type { CareRules, PetState } from "./types";

// Display only the accepted snapshot; do not integrate time, forecast a stage,
// or substitute historical wellbeing for current needs.
const reading = (n: number, digits: number) => n > 0 && Number(n.toFixed(digits)) === 0
  ? `<${(10 ** -digits).toFixed(digits)}` : n.toFixed(digits);
export function GrowthSnapshot({ pet, rules }: { pet: PetState; rules?: CareRules | null }) {
  if (!pet.hatchedAt || pet.growth?.stage === "egg") return null;
  const { hunger, mood, clean, energy } = pet.needs;
  const comfort = (hunger + mood + clean + energy) / 400;
  const stage = pet.growth?.stage, basis = rules?.growth;
  const rate = validGrowthBasis(basis) ? basis.basePerHour + basis.comfortPerHour * comfort : null;
  return <section className="growth-current" aria-label="此刻状态与成长">
    <h4>此刻状态与成长</h4>
    <dl>
      <div><dt>当前舒适度</dt><dd>{reading(comfort * 100, 1)}%</dd></div>
      {stage && stage !== "adult" && rate !== null && <div><dt>自然成长参考</dt><dd>{reading(rate, 2)} 点/小时</dd></div>}
    </dl>
    <p>按最近读取的四项需求计算，不是历史平均；显示值已取近似。</p>
    {!stage ? <p>成长记录尚未读到，不估算当前自然成长。</p>
      : stage === "adult" ? <p>成年不再增加成长点；舒适状态仍值得照顾，不改变已定型的外观。</p>
      : <>
        {rate === null && <p>成长基准尚未读到，暂不显示自然成长数字。</p>}
        <p>自然成长参考不含睡眠额外成长或照顾奖励；随状态变化，不是下一小时的预测。</p>
      </>}
  </section>;
}
