import { describe, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { gameIsPreferred, gamePreference, gamePreferenceLabel } from "./gamePreference";

describe("game preference from growth", () => {
  it.each([
    ["balanced", ["接星星", "连连看", "公园散步"]],
    ["lively", ["接星星", "贪吃蛇", "公园散步"]],
    ["gentle", ["池塘钓鱼", "连连看", "森林寻宝"]],
    ["easygoing", ["森林寻宝", "池塘钓鱼", "公园散步"]],
  ] as const)("suggests games for a recorded %s tendency", (form, titles) => {
    const growth = emptyGrowth("growing");
    growth.trackedHours = form === "easygoing" ? 12 : 1;
    growth.wellbeing = form === "easygoing" ? 0 : 80;
    growth.care.play = form === "lively" ? 3 : 0;
    growth.care.clean = form === "gentle" ? 3 : 0;
    growth.care.rest = form === "gentle" ? 2 : 0;
    const preference = gamePreference(growth);
    expect(preference?.form).toBe(form);
    expect(preference?.basis).toBe("growing");
    expect(preference?.titles).toEqual(titles);
    expect(preference && gamePreferenceLabel(preference)).toContain(form === "balanced" ? "均衡型" : form === "lively" ? "活力型" : form === "gentle" ? "恬静型" : "自在型");
  });

  it("does not infer a preference from an empty growing record", () => {
    expect(gamePreference(emptyGrowth("growing"))).toBeNull();
    expect(gamePreference(emptyGrowth("baby"))).toBeNull();
  });

  it("uses the saved adult form and marks only its suggested games", () => {
    const growth = emptyGrowth("adult");
    growth.form = "gentle";
    const preference = gamePreference(growth)!;
    expect(preference.basis).toBe("adult");
    expect(gameIsPreferred(preference, "fishing")).toBe(true);
    expect(gameIsPreferred(preference, "snake")).toBe(false);
  });

  it("keeps malformed adult form data quiet", () => {
    const growth = emptyGrowth("adult");
    (growth as { form: unknown }).form = "";
    expect(gamePreference(growth)).toBeNull();
  });
});
