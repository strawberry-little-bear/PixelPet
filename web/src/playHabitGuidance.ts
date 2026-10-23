import type { Growth } from "./types";

const cooldownMs = 30 * 60 * 1000;

// This is a current read-only hint for the guide, not a promise about the next
// result. The server remains authoritative when a game is collected.
export function playHabitGuidance(growth: Pick<Growth, "care"> | undefined, now: number): string {
  const lastPlay = growth?.care?.lastPlay;
  if (!growth || typeof lastPlay !== "number" || !Number.isSafeInteger(lastPlay) || lastPlay < 0 || !Number.isFinite(now) || now <= 0) {
    return "陪玩习惯间隔待同步；仍可陪玩，是否记入以收好本局时的结果为准。";
  }
  if (lastPlay === 0) {
    return "陪玩习惯尚未记录；完整收好本局后，符合间隔才会记入。";
  }
  if (lastPlay > now) {
    return "陪玩习惯的上次记录晚于当前时间；仍可陪玩，是否记入以收好本局时的结果为准。";
  }
  const remaining = lastPlay + cooldownMs - now;
  if (remaining > 0) {
    return `陪玩习惯记录时约还需 ${Math.max(1, Math.ceil(remaining / 60000))} 分钟；仍可陪玩，本局结果会照实说明。`;
  }
  return "陪玩习惯间隔已过；完整收好本局后，是否记入以结算结果为准。";
}
