import { formNames, growthProgress, stageNames, stagePoints } from "./growth";
import type { Growth } from "./types";

// Approximate spoken text must not turn a positive trace into zero or an
// unfinished stage into its target. The range value retains the raw snapshot.
function pointsReading(value: number, target: number): string {
  if (value > 0 && value < .01) return "不足 0.01";
  if (value < target && Number(value.toFixed(2)) === target) return `不足 ${target}`;
  return Number.isInteger(value) ? String(value) : `约 ${value.toFixed(2)}`;
}

export function GrowthTrack({ growth, estimated = false }: { growth: Growth; estimated?: boolean }) {
  const { points, target } = stagePoints(growth);
  const value = Math.max(0, Math.min(target, points));
  const source = estimated ? "旧档兼容估算" : "最近读取";
  const text = growth.stage === "egg" ? "等待孵化，孵化后开始成长。"
    : growth.stage === "adult" ? estimated
      ? "成年期预览，实际成长与形态以服务端记录为准。"
      : `成年期，成长完成，${formNames[growth.form || "balanced"]}已定型。`
    : `${stageNames[growth.stage]}，本阶段 ${pointsReading(value, target)} / ${target} 点；尚未进入${growth.stage === "baby" ? "成长期" : "成年期"}。`;
  return <div className="growth-track" role="progressbar" aria-label="本阶段成长进度"
    aria-valuemin={0} aria-valuemax={target} aria-valuenow={value} aria-valuetext={`${source}：${text}`}>
    <i style={{ width: `${growthProgress(growth)}%` }} aria-hidden="true" />
  </div>;
}
