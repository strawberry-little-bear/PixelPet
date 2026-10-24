import { describe, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { gameCompanionVoice } from "./gameCompanionVoice";

describe("game companion voice", () => {
  it("does not invent a tendency before growing evidence exists", () => {
    expect(gameCompanionVoice(emptyGrowth("baby"), "fishing")).toBeNull();
    expect(gameCompanionVoice(emptyGrowth("growing"), "fishing")).toBeNull();
  });

  it("uses the provisional growing tendency and keeps the game context", () => {
    const growth = emptyGrowth("growing");
    growth.care.play = 3;
    expect(gameCompanionVoice(growth, "snake")).toEqual({
      form: "lively",
      text: "它跃跃欲试，跟着你的方向动起来。",
    });
  });

  it.each([
    ["balanced", "tiles", "它稳稳陪你把图案一对对收好。"],
    ["lively", "walk", "它跃跃欲试，想和你一起走快一点。"],
    ["gentle", "fishing", "它安静观察着，陪你听着水声等浮漂。"],
    ["easygoing", "treasure", "它按自己的节奏陪你探索，不必一次找完。"],
  ] as const)("uses the saved adult form for %s", (form, game, text) => {
    const growth = emptyGrowth("adult");
    growth.form = form;
    expect(gameCompanionVoice(growth, game)).toEqual({ form, text });
  });

  it("does not trust an invalid adult form", () => {
    const growth = emptyGrowth("adult");
    growth.form = "future" as never;
    expect(gameCompanionVoice(growth, "stars")).toBeNull();
  });
});
