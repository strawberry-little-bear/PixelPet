import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareAdvice, careAdvice, recommendedCare } from "./CareAdvice";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState } from "./types";

afterEach(cleanup);
const pet = (stage: GrowthStage = "baby", sleeping = false) => ({
  hatchedAt: 1, sleeping, growth: emptyGrowth(stage),
  needs: { hunger: 80, clean: 80, energy: 80, mood: 80 },
} as PetState);

describe("care advice without changing rewards", () => {
  it.each(["baby", "growing", "adult"] as const)("explains awake and sleeping %s without promising growth", stage => {
    const p = pet(stage);
    const before = structuredClone(p);
    const { container } = render(<CareAdvice pet={p} />);
    expect(container.textContent).toContain("现在很舒适");
    expect(container.querySelector("button, a, input")).toBeNull();
    expect(p).toEqual(before);
    expect(careAdvice(pet(stage, true))).toContain("体力满后不再增加");
  });
  it("uses the existing urgent body priority, not a separate growth threshold", () => {
    const p = pet();
    p.needs = { hunger: 30, clean: 10, energy: 20, mood: 10 };
    expect(careAdvice(p)).toContain("洗澡");
    p.needs.clean = 80;
    expect(careAdvice(p)).toContain("休息");
    p.needs.energy = 80;
    expect(careAdvice(p)).toContain("吃点东西");
  });
  it("does not invite tired pets to play and remains usable without legacy growth", () => {
    const p = pet(); delete p.growth;
    p.needs.mood = 50; p.needs.energy = 43;
    expect(careAdvice(p)).toContain("安静陪伴");
    p.needs.energy = 80;
    expect(careAdvice(p)).toContain("游戏角");
    p.game = { startedAt: 1, round: 0, score: 0, lastBeat: -1 };
    expect(careAdvice(p)).toContain("结束本局");
    expect(recommendedCare(p)).toBeNull();
    delete p.game; p.hatchedAt = 0;
    expect(recommendedCare(p)).toBeNull();
  });
});
