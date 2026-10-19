import { describe, expect, it } from "vitest";
import { careAdvice } from "./CareAdvice";
import { carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState } from "./types";

function pet(stage: GrowthStage): PetState {
  return { schema: 11, revision: 1, species: 2, name: "照顾伙伴", createdAt: 1, hatchedAt: 1,
    lastTick: 2, sleeping: false, needs: { hunger: 80, clean: 80, energy: 80, mood: 80 },
    careCount: 0, growth: emptyGrowth(stage), logs: [] };
}

describe("care guidance names the actual menu choices", () => {
  describe.each(["baby", "growing", "adult"] as const)("%s", stage => {
    it.each([
      ["hunger", "吃点东西"], ["clean", "洗个澡澡"], ["energy", "睡个好觉"], ["mood", "一起玩耍"],
    ] as const)("names the menu item for low %s", (need, label) => {
      const p = pet(stage); p.needs[need] = 10;
      const before = structuredClone(p);
      expect(careAdvice(p)).toContain(`从菜单选「${label}」`);
      expect(p).toEqual(before);
    });
    it.each([["hunger", "吃点东西"], ["clean", "洗个澡澡"]] as const)("names both steps for sleeping low %s", (need, label) => {
      const p = pet(stage); p.sleeping = true; p.needs[need] = 10;
      expect(careAdvice(p)).toContain(`先从菜单选「起床啦」，再选「${label}」`);
      expect(carePreview(p, need === "hunger" ? "feed" : "clean").join("")).toContain(`再选「${label}」`);
    });
    it("explains ongoing food and cleanliness loss even at full energy", () => {
      const p = pet(stage); p.needs.energy = 100;
      const before = structuredClone(p);
      const preview = carePreview(p, "sleep").join("");
      expect(preview).toContain("不增加休息习惯");
      expect(preview).toContain("饱食和清洁仍会下降");
      expect(p).toEqual(before);
    });
  });
});
