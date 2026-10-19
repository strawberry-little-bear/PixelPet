import { describe, expect, it } from "vitest";
import { feedbackText } from "./CareFeedback";
import { emptyGrowth, nextGrowthGoal } from "./growth";
import type { CareFeedback } from "./types";

const credit: CareFeedback = { kind: "feed", points: .25, habit: "nutrition", habitGain: 1, reason: "credited" };

describe("honest growth feedback", () => {
  it("shows the saved action bonus and next milestone", () => {
    const g = { ...emptyGrowth(), points: .25 };
    expect(feedbackText(credit, g, 0)).toEqual({
      title: "成长 +0.25 · 喂食习惯 +1", detail: "距成长期还差 23.75 点",
    });
  });
  it("shows only habit credit at adulthood and the capped final bonus", () => {
    const g = { ...emptyGrowth("adult"), points: 72, form: "gentle" as const };
    expect(feedbackText({ ...credit, points: 0 }, g, 0)).toEqual({
      title: "喂食习惯 +1", detail: "恬静型已定型，继续温柔陪伴",
    });
    expect(feedbackText({ ...credit, points: .1 }, g, 0).title).toContain("成长 +0.10");
    expect(feedbackText({ ...credit, points: .001 }, g, 0).title).toContain("<0.01");
  });
  it.each(["feed", "clean"] as const)("explains when %s succeeds without habit credit", kind => {
    const text = feedbackText({ ...credit, kind, reason: "not-needed", points: 0, habitGain: 0 }, emptyGrowth(), 0);
    expect(text.title).toContain("本次不记习惯");
    expect(text.title).not.toContain("+0.25");
    expect(text.detail).toContain(kind === "feed" ? "饱食 ≤70" : "清洁 ≤65");
  });
  it("uses server retry time and never shows a negative countdown", () => {
    const f = { ...credit, reason: "cooldown" as const, retryAt: 120001, points: 0, habitGain: 0 };
    expect(feedbackText(f, emptyGrowth(), 1).detail).toContain("2 分钟");
    expect(feedbackText(f, emptyGrowth(), 120001).detail).toContain("已结束");
    expect(feedbackText(f, emptyGrowth(), 130000).detail).toContain("已结束");
  });
  it("does not promise more growth points when an adult goes to sleep", () => {
    const f = { ...credit, kind: "sleep" as const, reason: "resting" as const, points: 0, habitGain: 0 };
    expect(feedbackText(f, emptyGrowth(), 0).detail).toContain("成长基准尚未读到");
    expect(feedbackText(f, emptyGrowth("adult"), 0).detail).toContain("形态不变");
    expect(feedbackText(f, emptyGrowth("adult"), 0).detail).not.toContain("+0.25");
  });
  it("keeps a real target until the server changes stages", () => {
    expect(nextGrowthGoal({ ...emptyGrowth(), points: 23.999 })).toBe("距成长期还差 0.01 点");
    expect(nextGrowthGoal({ ...emptyGrowth("growing"), points: 24 })).toBe("距成年期还差 48.00 点");
  });
});
