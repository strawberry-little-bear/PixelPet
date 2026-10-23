import { describe, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { playHabitGuidance } from "./playHabitGuidance";

const now = Date.parse("2026-10-23T10:00:00Z");

describe("play habit guide", () => {
  it("does not invent a cooldown when growth is unavailable or malformed", () => {
    expect(playHabitGuidance(undefined, now)).toContain("间隔待同步");
    expect(playHabitGuidance({ care: { ...emptyGrowth().care, lastPlay: 1.5 } }, now)).toContain("间隔待同步");
    expect(playHabitGuidance(emptyGrowth(), 0)).toContain("间隔待同步");
  });

  it("explains a first game separately from a recorded habit", () => {
    expect(playHabitGuidance(emptyGrowth(), now)).toContain("尚未记录");
  });

  it("shows the saved historical remaining interval without blocking play", () => {
    const growth = emptyGrowth();
    growth.care.lastPlay = now - 10 * 60 * 1000;
    expect(playHabitGuidance(growth, now)).toContain("约还需 20 分钟");
    expect(playHabitGuidance(growth, now)).toContain("仍可陪玩");
  });

  it("shows when the interval has passed and guards a clock mismatch", () => {
    const growth = emptyGrowth();
    growth.care.lastPlay = now - 31 * 60 * 1000;
    expect(playHabitGuidance(growth, now)).toContain("间隔已过");
    growth.care.lastPlay = now + 1;
    expect(playHabitGuidance(growth, now)).toContain("晚于当前时间");
  });
});
