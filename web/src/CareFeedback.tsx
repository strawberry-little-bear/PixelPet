import type { CareFeedback as Feedback, CareRules, Growth } from "./types";
import { nextGrowthGoal } from "./growth";
import { sleepGrowthGuidance } from "./sleepGuidance";
import { careHabitUnits } from "./careHabitUnits";

const habitNames = { nutrition: "喂食习惯", clean: "清洁习惯", play: "陪玩习惯" };

export function feedbackText(feedback: Feedback, growth: Growth, now: number, context?: { rules?: CareRules | null; growthRecorded?: boolean }) {
  if (feedback.reason === "credited") {
    const habitGain = careHabitUnits(feedback.habitGain) ?? feedback.habitGain;
    const habit = feedback.habit ? `${habitNames[feedback.habit]} +${habitGain}` : "习惯已记住";
    const gain = feedback.points > 0
      ? `成长 +${feedback.points < .005 ? "<0.01" : feedback.points.toFixed(2)} · `
      : "";
    return { title: gain + habit, detail: nextGrowthGoal(growth) };
  }
  if (feedback.reason === "resting") {
    return { title: "晚安，需要时会慢慢恢复体力",
      detail: sleepGrowthGuidance(context?.growthRecorded === false ? null : growth, context?.rules) };
  }
  if (feedback.reason === "awake") {
    return { title: "早安，只按实际恢复的体力记休息习惯", detail: nextGrowthGoal(growth) };
  }
  const title = feedback.kind === "feed" ? "饭团已吃好 · 本次不记习惯"
    : feedback.kind === "clean" ? "泡泡澡洗好 · 本次不记习惯" : "陪玩完成 · 本次不记习惯";
  if (feedback.reason === "not-needed") {
    return { title, detail: feedback.kind === "feed"
      ? "刚才饱食已满足；饱食 ≤70 才记喂食习惯"
      : "刚才清洁已满足；清洁 ≤65 才记清洁习惯" };
  }
  const minutes = Math.max(0, Math.ceil(((feedback.retryAt ?? now) - now) / 60000));
  return { title, detail: minutes > 0
    ? `本次无额外奖励 · 同类奖励还需 ${minutes} 分钟`
    : "奖励间隔已结束，下次需要时再来吧" };
}

export function CareFeedback({ feedback, growth, mood, now, rules, growthRecorded = true }: {
  feedback: Feedback | null;
  growth: Growth;
  mood: string;
  now: number;
  rules?: CareRules | null;
  growthRecorded?: boolean;
}) {
  const text = feedback ? feedbackText(feedback, growth, now, { rules, growthRecorded })
    : { title: mood, detail: nextGrowthGoal(growth) };
  return (
    <div className={`growth-feedback ${feedback ? "has-feedback" : ""}`}
      role={feedback ? "status" : undefined} aria-atomic="true"
      data-feedback={feedback?.reason || "idle"}>
      <strong>{text.title}</strong>
      <small>{text.detail}</small>
    </div>
  );
}
