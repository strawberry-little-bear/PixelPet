import { Sprite } from "./Sprite";
import {
  formDescriptions,
  formNames,
  growthProgress,
  stageNames,
  tendency,
  stagePoints,
} from "./growth";
import type { Growth } from "./types";
import "./growth.css";

export function GrowthPanel({
  growth: g,
  index,
  page,
}: {
  growth: Growth;
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
            <Sprite index={index} />
            <div>
              <strong>
                {stageNames[g.stage]}
                {g.form ? ` · ${formNames[g.form]}` : ""}
              </strong>
              <small>
                {g.stage === "adult"
                  ? "你的照顾，成就了现在的它"
                  : "每一点照顾，都会慢慢长大"}
              </small>
            </div>
          </div>
          <div className="growth-stage-track">
            {["幼年", "成长", "成年"].map((text, i) => (
              <span
                key={text}
                className={
                  i <= ["baby", "growing", "adult"].indexOf(g.stage)
                    ? "reached"
                    : ""
                }
              >
                <i>{i + 1}</i>
                {text}
              </span>
            ))}
          </div>
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
      ) : (
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
            有效照顾 +0.25，奖励间隔 30 分钟。
            <br />
            饱食 ≤70 喂食、清洁 ≤65 洗澡才记入。
            <br />
            完成陪玩 / 恢复体力也能帮助成长。
          </small>
        </>
      )}
      <span className="growth-page-dots">{page + 1} / 2</span>
    </div>
  );
}
