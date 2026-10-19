import type { CareRules } from "./types";
import { validCareRules } from "./StatusGuide";

/** Read-only onboarding; numeric limits come only from accepted server metadata. */
export function PetCareGuide({ rules }: { rules?: CareRules | null }) {
  return <section className="help-care" aria-label="照顾与成长入门">
    <h3>慢慢长大，不必反复刷照顾</h3>
    <p>幼年 → 成长期 → 成年。保持舒适有助成长；有效照顾留下习惯，影响成年倾向。不是只等年龄，也不必在状态已满时反复照顾。成年后形态固定，仍能记录习惯与共同经历。</p>
    <h3>睡觉是慢慢恢复</h3>
    <p>睡着时体力逐渐恢复到满，休息习惯按实际恢复量记录；反复睡下、叫醒不会立刻增加成长。饱食和清洁仍会下降，需要时从菜单「起床啦」醒来再照顾。</p>
    <h3>离开后也会变化</h3>
    {validCareRules(rules)
      ? <p>下次读取或操作时结算，单次最多 {rules.maxOfflineHours} 小时；该次多出的时间不补扣、不补长。多次读取可能分段累计，整段离开计入的时间可能超过单次上限。</p>
      : <p>离开后会在读取或操作时结算。单次结算上限尚未读到，暂不显示数字；多次读取可能分段累计，以实际保存结果为准。</p>}
    <p>没有永久死亡。菜单「看看状态」查看时间变化，「成长手册」查看阶段与照顾影响，「回访小结」重看已记录的离开变化。</p>
    <p className="help-save">照顾成功后自动存档在这台电脑里；存档盒可以导出、导入备份。</p>
  </section>;
}
