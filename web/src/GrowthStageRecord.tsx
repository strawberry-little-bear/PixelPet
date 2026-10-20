import { stageNames } from "./growth";
import type { GrowthStage, PetState } from "./types";

type Stage = Exclude<GrowthStage, "egg">;
const order: GrowthStage[] = ["egg", "baby", "growing", "adult"];
const milestone = { baby: "孵化", growing: "进入成长期", adult: "成年定型" };
const kind = { baby: "hatch", growing: "growing", adult: "adult" } as const;
const validDate = (at: number) => Number.isSafeInteger(at) && at > 0 && at <= 8.64e15;

// Read dates only from the accepted save, never the age-based stage preview or
// a browser clock. Album provenance qualifies a date; it cannot replace one.
export function GrowthStageRecord({ pet, stage }: { pet: PetState; stage: Stage }) {
  const growth = pet.growth;
  const at = stage === "baby" ? pet.hatchedAt : stage === "growing" ? growth?.growingAt : growth?.adultAt;
  const date = at !== undefined && validDate(at) ? new Date(at) : null;
  let unavailable: string | undefined;
  if (!pet.hatchedAt) unavailable = stage === "baby" ? "等待孵化，之后开始记录" : `尚未${milestone[stage]}`;
  else if (stage !== "baby" && !growth) unavailable = "成长记录尚未读到，不推算阶段日期";
  else if (stage !== "baby" && growth && order.indexOf(growth.stage) < order.indexOf(stage)) unavailable = `尚未${milestone[stage]}`;
  else if (!date) unavailable = "这一阶段的时间未记录";
  const memory = pet.album?.entries?.find(m => m.kind === kind[stage] && m.at === at &&
    (stage !== "adult" || m.form === growth?.form));
  const source = memory?.source === "shared" ? "成长经历记录"
    : memory?.source === "saved" ? "旧档记录" : "存档记录（来源未注明）";
  return <div className="growth-stage-record" role="group" aria-label={`${stageNames[stage]}时间`}>
    {unavailable || !date ? <small>{unavailable}</small> : <>
      <small>{source} · {milestone[stage]}</small>
      <time dateTime={date.toISOString()}>{date.toLocaleString("zh-CN", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })}</time>
    </>}
  </div>;
}
