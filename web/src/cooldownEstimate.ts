import type { CareFeedback } from "./types";

// A cooldown reply is historical. Use only the acknowledged action timestamp
// and the server's retryAt to describe what the player saw at that moment;
// never turn this into a live local-clock eligibility check.
export function cooldownEstimate(feedback: Pick<CareFeedback, "reason" | "retryAt" | "effect">): string {
  const retryAt = feedback.retryAt;
  if (feedback.reason !== "cooldown" || !feedback.effect || typeof retryAt !== "number" ||
      !Number.isSafeInteger(feedback.effect.at) || !Number.isSafeInteger(retryAt)) return "";
  const remaining = retryAt - feedback.effect.at;
  if (remaining <= 0 || remaining > 24 * 60 * 60 * 1000) return "";
  const minutes = Math.max(1, Math.ceil(remaining / 60000));
  return `记录时约还需 ${minutes} 分钟；以之后实际结果为准。`;
}
