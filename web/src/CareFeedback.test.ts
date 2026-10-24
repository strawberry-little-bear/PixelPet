import { describe, expect, it } from "vitest";
import { feedbackText } from "./CareFeedback";
import { emptyGrowth, nextGrowthGoal } from "./growth";
import type { CareFeedback } from "./types";

const credit: CareFeedback = { kind: "feed", points: .25, habit: "nutrition", habitGain: 1, reason: "credited" };

describe("honest growth feedback", () => {
  it("shows the saved action bonus and next milestone", () => {
    const g = { ...emptyGrowth(), points: .25 };
    expect(feedbackText(credit, g)).toEqual({
      title: "成长 +0.25 · 喂食习惯 +1", detail: "距成长期还差 23.75 点",
    });
  });
  it("shows only habit credit at adulthood and the capped final bonus", () => {
    const g = { ...emptyGrowth("adult"), points: 72, form: "gentle" as const };
    expect(feedbackText({ ...credit, points: 0 }, g)).toEqual({
      title: "喂食习惯 +1", detail: "恬静型已定型，继续温柔陪伴",
    });
    expect(feedbackText({ ...credit, points: .1 }, g).title).toContain("成长 +0.10");
    expect(feedbackText({ ...credit, points: .001 }, g).title).toContain("<0.01");
  });
  it.each(["feed", "clean"] as const)("explains when %s succeeds without habit credit", kind => {
    const text = feedbackText({ ...credit, kind, reason: "not-needed", points: 0, habitGain: 0 }, emptyGrowth());
    expect(text.title).toContain("本次不记习惯");
    expect(text.title).not.toContain("+0.25");
    expect(text.detail).toContain(kind === "feed" ? "饱食 ≤70" : "清洁 ≤65");
  });
  it("describes the saved cooldown without using the retry timestamp as current eligibility", () => {
    for (const retryAt of [undefined, 1, 120001]) {
      const f = { ...credit, reason: "cooldown" as const, retryAt, points: 0, habitGain: 0 };
      expect(feedbackText(f, emptyGrowth()).detail).toBe("记录时同类习惯仍在间隔内；本次不计入。下次以实际结果为准。");
    }
  });
  it("explains the historical remaining interval without turning it into a live promise", () => {
    const at = Date.parse("2026-10-20T01:20:00Z");
    const f = { ...credit, reason: "cooldown" as const, points: 0, habitGain: 0,
      effect: { at, before: { hunger: 60, mood: 70, clean: 60, energy: 80 }, after: { hunger: 80, mood: 73, clean: 57, energy: 80 } },
      retryAt: at + 61_000 };
    expect(feedbackText(f, emptyGrowth()).detail).toBe("记录时同类习惯仍在间隔内；本次不计入。记录时约还需 2 分钟；以之后实际结果为准。");
  });
  it("does not promise more growth points when an adult goes to sleep", () => {
    const f = { ...credit, kind: "sleep" as const, reason: "resting" as const, points: 0, habitGain: 0 };
    expect(feedbackText(f, emptyGrowth()).detail).toContain("成长基准尚未读到");
    expect(feedbackText(f, emptyGrowth("adult")).detail).toContain("形态不变");
    expect(feedbackText(f, emptyGrowth("adult")).detail).not.toContain("+0.25");
  });
  it.each([
    ["baby", 23.96, "0.04"], ["growing", 71.96, "0.04"],
    ["baby", 23.99, "0.01"], ["growing", 71.99, "0.01"],
    ["baby", 23.959999999, "0.05"], ["growing", 71.959999999, "0.05"],
    ["baby", 24 - Number.EPSILON * 24, "0.01"],
    ["growing", 72 - Number.EPSILON * 72, "0.01"],
  ] as const)("rounds the %s/%s gap up without adding a cent for floating-point noise", (stage, points, reading) => {
    const g = { ...emptyGrowth(stage), points };
    expect(nextGrowthGoal(g)).toBe(`距${stage === "baby" ? "成长期" : "成年期"}还差 ${reading} 点`);
    expect(g.points).toBe(points);
  });
  it("keeps a real target until the server changes stages", () => {
    expect(nextGrowthGoal({ ...emptyGrowth(), points: 23.999 })).toBe("距成长期还差 0.01 点");
    expect(nextGrowthGoal({ ...emptyGrowth("growing"), points: 24 })).toBe("距成年期还差 48.00 点");
  });
});
