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
} from "./growth";
import type { Companion, Growth, GrowthStage } from "./types";
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
}: {
  growth: Growth;
  companion?: Companion;
  index: number;
  page: number;
}) {
  const form = tendency(g),
    target = g.stage === "growing" ? 72 : 24;
  const current = stagePoints(g);
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
              ? "形态已确定，之后也要温柔照顾哦。"
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
      ) : page === 3 ? <CompanionPanel companion={companion} /> : (
        <div className="form-guide">
          <div className="habit-heading">
            <span>{g.form ? "已定型 · 形态依据" : "当前倾向 · 形态依据"}</span>
            <strong>{formNames[form]}</strong>
          </div>
          <p className="form-guide-record">
            当前陪玩 {g.care.play.toFixed(1)} · 恬静分 {((g.care.clean + g.care.rest) / 2).toFixed(1)}
          </p>
          <small className="form-guide-history">
            记录 {(Math.floor(g.trackedHours * 10) / 10).toFixed(1)}h · {g.trackedHours > 0
              ? `平均舒适约 ${Math.round(g.wellbeing / g.trackedHours * 100)}%`
              : "尚无舒适度记录"}
          </small>
          <small className="form-guide-formula">恬静分 =（清洁习惯 + 休息习惯）÷ 2</small>
          <ol className="form-rules" aria-label="成年形态判定顺序">
            {formRules.map(({ form: ruleForm, rule }) => (
              <li key={ruleForm} data-rule-form={ruleForm}
                data-selected={ruleForm === form ? "true" : "false"}>
                <strong>{formNames[ruleForm]}</strong><span>{rule}</span>
              </li>
            ))}
          </ol>
          <small className="form-guide-note">
            {g.form ? "高亮为已定形态，当前习惯不改写它。" : "成年时按上方顺序确定，现在仍会变化。"}
            <br />
            {g.form ? "判定规则供参考，不代表成年时的记录。" : "保持舒适、适时照顾，不必刻意追求形态。"}
          </small>
        </div>
      )}
      <span className="growth-page-dots">{page + 1} / {growthPageCount}</span>
    </div>
  );
}
