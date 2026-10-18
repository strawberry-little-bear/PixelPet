import type { CareFeedback as Feedback, Growth } from "./types";
import { nextGrowthGoal } from "./growth";

const habitNames = { nutrition: "喂食习惯", clean: "清洁习惯", play: "陪玩习惯" };

export function feedbackText(feedback: Feedback, growth: Growth, now: number) {
  if (feedback.reason === "credited") {
    const habit = feedback.habit ? `${habitNames[feedback.habit]} +${feedback.habitGain}` : "习惯已记住";
    const gain = feedback.points > 0
      ? `成长 +${feedback.points < .005 ? "<0.01" : feedback.points.toFixed(2)} · `
      : "";
    return { title: gain + habit, detail: nextGrowthGoal(growth) };
  }
  if (feedback.reason === "resting") {
    return { title: "晚安，需要时会慢慢恢复体力", detail: growth.stage === "adult"
      ? "恢复体力会记录休息习惯，成年形态不变"
      : "每恢复 28 体力，休息 +1 · 成长 +0.25" };
  }
  if (feedback.reason === "awake") {
    return { title: "早安，恢复的体力会记入休息习惯", detail: nextGrowthGoal(growth) };
  }
  const title = feedback.kind === "feed" ? "吃得香香 · 状态已改善"
    : feedback.kind === "clean" ? "洗得干净 · 状态已改善" : "陪玩完成 · 状态已改善";
  if (feedback.reason === "not-needed") {
    return { title, detail: feedback.kind === "feed"
      ? "饱食 ≤70 时喂食，才记入成长习惯"
      : "清洁 ≤65 时洗澡，才记入成长习惯" };
  }
  const minutes = Math.max(0, Math.ceil(((feedback.retryAt ?? now) - now) / 60000));
  return { title, detail: minutes > 0
    ? `本次无额外奖励 · 同类奖励还需 ${minutes} 分钟`
    : "奖励间隔已结束，下次需要时再来吧" };
}

export function CareFeedback({ feedback, growth, mood, now }: {
  feedback: Feedback | null;
  growth: Growth;
  mood: string;
  now: number;
}) {
  const text = feedback ? feedbackText(feedback, growth, now)
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
