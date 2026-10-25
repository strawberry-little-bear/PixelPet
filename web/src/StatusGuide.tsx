import type { CareRules, PetState } from "./types";
import { LifeSummary } from "./LifeSummary";
import "./status-guide.css";

export const statusPageCount = 2;
const needLabels = [["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"]] as const;

// Optional response metadata must not turn a legacy/malformed response into a
// made-up numeric rule or a failed write. The normal status readings still work.
export function validCareRules(value: unknown): value is CareRules {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<CareRules>;
  return typeof v.maxOfflineHours === "number" && Number.isFinite(v.maxOfflineHours) && v.maxOfflineHours > 0 &&
    [v.awake, v.sleeping].every(rates => rates && needLabels.every(([key]) => typeof rates[key] === "number" && Number.isFinite(rates[key])));
}

export function StatusGuide({ pet, rules, now = Date.now() }: { pet: PetState; rules: CareRules | null; now?: number }) {
  const rates = rules?.[pet.sleeping ? "sleeping" : "awake"];
  return <section className="status-guide" aria-label="时间与状态说明">
    <h3>时间与状态</h3>
    <p>最近读取：{pet.sleeping ? "正在睡觉" : "清醒中"}</p>
    <LifeSummary pet={pet} now={now} />
    <section className="status-time-detail" aria-label="时间变化明细">
      <h4>时间变化明细</h4>
    {rates ? <>
      <dl className="status-rates" aria-label="每小时基准变化">
        {needLabels.map(([key, label]) => <div key={key} data-need={key}>
          <dt>{label}</dt><dd>{rates[key] === 0 ? "不因时间流逝变化" : `${rates[key] > 0 ? "+" : "−"}${Math.abs(rates[key])} / 小时`}</dd>
        </div>)}
      </dl>
      <p>这是基准速率，到 0 / 100 为止，不是一小时后的预测；照顾和游戏会另改读数。</p>
      <p>离开后，下次读取或操作时结算，单次最多 {rules.maxOfflineHours} 小时；多出的时间不补扣、不补长。</p>
    </> : <p>详细速率尚未读到，暂不显示数字；以已保存的状态和实际照顾结果为准。</p>}
    <p>{pet.sleeping
      ? "睡着时体力恢复，心情不因时间流逝下降；饱食和清洁仍会下降。"
      : "想休息时可从菜单睡下：体力慢慢恢复，饱食和清洁仍会下降。"}</p>
    <p>{pet.growth?.stage === "adult"
      ? "成年形态已固定，状态仍会变化；照顾还可以留下习惯与共同经历。"
      : "保持舒适有助成长；不必为了成长反复照顾，习惯只按实际效果和间隔记录。"}</p>
    </section>
  </section>;
}
