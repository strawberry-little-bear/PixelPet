import { GrowthBasis } from "./GrowthBasis";
import { CompanionPanel } from "./CompanionPanel";
import { PetArt, petRigClass } from "./PetArt";
import { FormEmblem, GrowthOutfit } from "./GrowthOutfit";
import {
  formDescriptions,
  formNames,
  growthProgress,
  stageNames,
  tendency,
  stagePoints,
  growthPageCount,
  formRules,
  formConditions,
} from "./growth";
import { stageLook } from "./stageLooks";
import { species } from "./types";
import type { CareRules, Companion, Growth, GrowthStage } from "./types";
import "./growth.css";

function StagePreviews({ growth, index }: { growth: Growth; index: number }) {
  const stages: GrowthStage[] = ["baby", "growing", "adult"];
  const current = stages.indexOf(growth.stage);
  const form = tendency(growth);
  return (
    <div className="growth-previews" aria-label="三个成长阶段的外观预览">
      {stages.map((stage, i) => (
        <div key={stage} className={`growth-preview growth-${stage}`}
          data-preview-stage={stage} data-preview-form={stage === "adult" ? form : ""}
          aria-current={i === current ? "step" : undefined}>
          <div className="growth-preview-frame" aria-hidden="true">
            <div className="growth-preview-art">
              <div className={`growth-size ${petRigClass(index, stage)}`}>
                <PetArt index={index} stage={stage} expression="still" />
                <GrowthOutfit stage={stage} form={stage === "adult" ? form : ""} />
              </div>
              {stage === "adult" && <FormEmblem form={form} />}
            </div>
          </div>
          <strong>{stageNames[stage]}</strong>
          <small>{stage === "adult"
            ? `${formNames[form]}${growth.form ? " · 现在" : "预览"}`
            : i === current ? "现在" : i < current ? "已走过" : "待成长"}</small>
        </div>
      ))}
    </div>
  );
}

export function GrowthPanel({
  growth: g,
  companion,
  index,
  page,
  rules,
}: {
  growth: Growth;
  companion?: Companion;
  index: number;
  page: number;
  rules?: CareRules | null;
}) {
  const form = tendency(g),
    target = g.stage === "growing" ? 72 : 24;
  const current = stagePoints(g);
  const record = g.stage === "adult" ? g.formRecord : undefined;
  const evidenceCare = record ?? g.care;
  const trackedHours = record?.trackedHours ?? g.trackedHours;
  const wellbeing = record?.wellbeing ?? g.wellbeing;
  const checks = formConditions({ trackedHours, wellbeing, care: evidenceCare });
  return (
    <div className="growth-panel" data-growth-page={page}>
      {page === 0 ? (
        <>
          <div className="growth-panel-title">
            <PetArt index={index} stage={g.stage} />
            <div>
              <strong>
                {stageNames[g.stage]}
                {g.form ? ` · ${formNames[g.form]}` : ""}
              </strong>
              <small>
                {g.stage === "adult"
                  ? "你的照顾，成就了现在的它"
                  : "成年外观为当前倾向，尚未确定"}
              </small>
            </div>
          </div>
          <StagePreviews growth={g} index={index} />
          <div className="growth-score">
            <span>{g.stage === "adult" ? "成长完成" : "本阶段成长值"}</span>
            <b>
              {(Math.floor(current.points * 10) / 10).toFixed(1)}
              <small> / {current.target}</small>
            </b>
          </div>
          <div className="growth-track">
            <i style={{ width: `${growthProgress(g)}%` }} />
          </div>
          <p className="growth-next">
            {g.stage === "adult"
              ? formDescriptions[form]
              : `还需 ${(Math.ceil(Math.max(0, target - g.points) * 10) / 10).toFixed(1)} 点，进入${g.stage === "baby" ? "成长期" : "成年期"}`}
          </p>
          <small className="growth-panel-note">
            {g.stage === "adult"
              ? "形态已确定，还能在纪念册留下新的经历。"
              : "状态越舒适，成长越快；不用着急。"}
          </small>
        </>
      ) : page === 1 ? (
        <>
          <div className="habit-heading">
            <span>{g.form ? "成年形态" : "当前倾向"}</span>
            <strong>{formNames[form]}</strong>
          </div>
          <div className="habit-rows">
            {[
              { name: "适时喂食", value: g.care.nutrition },
              { name: "一起玩耍", value: g.care.play },
              { name: "需要时洗澡", value: g.care.clean },
              { name: "有效休息", value: g.care.rest },
            ].map((row) => (
              <div key={row.name}>
                <span>{row.name}</span>
                <div>
                  <i style={{ width: `${Math.min(100, row.value * 12.5)}%` }} />
                </div>
                <b>{row.value.toFixed(1)}</b>
              </div>
            ))}
          </div>
          <p className="growth-next">
            {g.trackedHours > 0
              ? `平均舒适度 ${Math.round((g.wellbeing / g.trackedHours) * 100)}%`
              : "照顾习惯从现在开始记录。"}
          </p>
          <small className="growth-panel-note">
            {g.stage === "adult"
              ? "喂食/洗澡/陪玩：记习惯，间隔 30 分钟。"
              : "喂食/洗澡/陪玩：+0.25，间隔 30 分钟。"}
            <br />
            饱食 ≤70 喂食、清洁 ≤65 洗澡才记入。
            <br />
            {g.stage === "adult"
              ? "成年后不再加成长点，休息按恢复记录。"
              : "休息按体力恢复积累，每 28 点 +0.25。"}
          </small>
        </>
      ) : page === 3 ? <CompanionPanel companion={companion} /> : page === 4 ? (
        <div className="growth-time-guide" aria-label="离线与成长说明">
          <h3>不在的时候，也慢慢长大</h3>
          <GrowthBasis stage={g.stage} rules={rules} />
          <dl>
            <div><dt>离线结算</dt><dd>从上次保存到回来，状态与成长最多结算 12 小时；多出的时间不补扣、不补长。</dd></div>
            <div><dt>睡着以后</dt><dd>体力恢复到满为止；只按实际恢复量记休息习惯，不按睡了多久计次。</dd></div>
            <div><dt>相识天数</dt><dd>按现实时间计算，不等于成长点，也不代表连续登录；不用补做任务。</dd></div>
            <div><dt>{g.stage === "adult" ? "成年以后" : "长大以后"}</dt><dd>成年形态固定，照顾仍记习惯；新发生的纪念经历还能留下，不重复刷形态。</dd></div>
          </dl>
        </div>
      ) : page === 5 ? (
        <section className="growth-look-guide" aria-label="三阶段外观说明">
          <h3>{species[index] ?? "小伙伴"}的三阶段</h3>
          <p>同一位小伙伴的不同阶段，不是换一只宠物，也不只是放大原图。</p>
          {g.stage === "egg" && <p>孵化后开始三阶段旅程。</p>}
          <dl>
            {(["baby", "growing", "adult"] as const).map(stage => {
              const look = stageLook(index, stage);
              return <div key={stage} data-look-stage={stage} aria-current={g.stage === stage ? "step" : undefined}>
                <dt>{stageNames[stage]} · {look.pose}{g.stage === stage ? " · 现在" : ""}</dt>
                <dd>{look.detail}</dd>
              </div>;
            })}
          </dl>
          <p>{g.stage === "adult"
            ? "成年形态已固定，之后照顾不会重选；装扮是另外穿戴的物品。"
            : "这是阶段造型说明，成年形态仍以长大时的记录为准；装扮不决定成长。"}</p>
          <small>舒适度影响成长，实际照顾记录影响成年倾向；前几页可看数值与规则。</small>
        </section>
      ) : (
        <div className="form-guide">
          <div className="habit-heading">
            <span>{record ? "定型时 · 形态依据" : g.form ? "已定型 · 形态依据" : "当前倾向 · 形态依据"}</span>
            <strong>{formNames[form]}</strong>
          </div>
          {record && <time className="form-record-time" dateTime={new Date(g.adultAt).toISOString()}>
            成年定型 · {new Date(g.adultAt).toLocaleString("zh-CN", {
              year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
            })}
          </time>}
          {g.form && !record && <small className="form-record-missing">未保存定型时的依据，不倒推过去；下面是当前习惯。</small>}
          <p className="form-guide-record">
            {record ? "定型时" : "当前"}陪玩 {evidenceCare.play.toFixed(1)} · 恬静分 {((evidenceCare.clean + evidenceCare.rest) / 2).toFixed(1)}
          </p>
          {record && <small className="form-record-care">
            当时喂食 {record.nutrition.toFixed(1)} · 清洁 {record.clean.toFixed(1)} · 休息 {record.rest.toFixed(1)}
          </small>}
          <small className="form-guide-history">
            记录 {(Math.floor(trackedHours * 10) / 10).toFixed(1)}h · {trackedHours > 0
              ? `平均舒适约 ${Math.round(wellbeing / trackedHours * 100)}%`
              : "尚无舒适度记录"}
          </small>
          <small className="form-guide-formula">恬静分 =（清洁习惯 + 休息习惯）÷ 2</small>
          <small className="form-check-note">
            {record ? "定型时条件核对" : "当前条件核对"}：按未四舍五入的记录核对，依次取首项。
          </small>
          <ol className="form-rules" aria-label="成年形态判定顺序">
            {formRules.map(({ form: ruleForm, rule }) => (
              <li key={ruleForm} data-rule-form={ruleForm}
                data-selected={ruleForm === form ? "true" : "false"}
                data-condition-met={String(checks.conditions[ruleForm])}>
                <strong>{formNames[ruleForm]}</strong>
                <div className="form-rule-detail"><span>{rule}</span>
                  <small className="form-rule-result">{!checks.conditions[ruleForm]
                    ? "未满足" : checks.first === ruleForm ? "满足 · 首项" : "满足 · 前项优先"}</small>
                </div>
              </li>
            ))}
          </ol>
          <small className="form-guide-note">
            {g.form ? "高亮为已定形态，当前习惯不改写它。" : "成年时按上方顺序确定，现在仍会变化。"}
            <br />
            {record ? "定型时保存的记录，不按当前习惯重算；当前习惯见上一页。" : g.form ? "判定规则供参考，不代表成年时的记录。" : "保持舒适、适时照顾，不必刻意追求形态。"}
          </small>
        </div>
      )}
      <span className="growth-page-dots">{page + 1} / {growthPageCount}</span>
    </div>
  );
}
