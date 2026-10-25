import { describe, expect, it } from "vitest";
import { gameCompletionVoice } from "./gameCompletionVoice";
import { games } from "./games";
import { emptyGrowth } from "./growth";

describe("settled game companion responses", () => {
  it.each([
    ["stars", "这一局的星光收好了。"], ["tiles", "这一盘图案配好了。"],
    ["snake", "这一段追果子的路收好了。"], ["tetris", "这一局积木收好了。"],
    ["fishing", "这趟池塘之行收好了。"], ["walk", "这一小段路走完了。"],
    ["treasure", "这趟林间探索收好了。"],
  ] as const)("closes %s with its own context, including babies", (kind, lead) => {
    const growth = emptyGrowth("baby"), before = structuredClone(growth);
    expect(gameCompletionVoice(growth, kind, true)).toEqual({
      stage: "baby", text: lead + "小小的它轻轻晃了晃，靠着你歇一会儿。",
    });
    expect(growth).toEqual(before);
  });

  it.each(games)("does not infer saved completion or reward for $id", ({ id }) => {
    const growth = emptyGrowth("baby");
    expect(gameCompletionVoice(growth, id, false)?.text).toBe("这次尝试先到这里。小小的它轻轻晃了晃，靠着你歇一会儿。");
    expect(gameCompletionVoice(growth, id, null)?.text).toBe("游戏先告一段落。小小的它轻轻晃了晃，靠着你歇一会儿。");
  });

  it("keeps early growing responses neutral instead of assigning a personality", () => {
    const growth = emptyGrowth("growing");
    expect(gameCompletionVoice(growth, "walk", true)).toEqual({stage: "growing", text: "这一小段路走完了。它靠近了些，陪你歇一会儿。"});
  });

  it.each([
    ["balanced", "它稳稳靠近，和你一起歇一会儿。"],
    ["lively", "它轻快地晃了晃，带着余兴陪在你身边。"],
    ["gentle", "它安静地靠近，陪你慢慢放松下来。"],
    ["easygoing", "它慢悠悠地晃了晃，和你自在地歇一会儿。"],
  ] as const)("uses %s in growing evidence and the saved adult form", (form, text) => {
    const growing = emptyGrowth("growing");
    if (form === "balanced") growing.care.nutrition = 1;
    if (form === "lively") growing.care.play = 3;
    if (form === "gentle") growing.care.clean = growing.care.rest = 3;
    if (form === "easygoing") growing.trackedHours = 12;
    growing.form = form === "lively" ? "gentle" : "lively"; // Not a saved adult yet.
    const before = structuredClone(growing);
    expect(gameCompletionVoice(growing, "walk", true)).toEqual({stage: "growing", form, text: "这一小段路走完了。" + text});
    expect(growing).toEqual(before);
    const adult = emptyGrowth("adult"); adult.form = form; adult.care.play = 100;
    expect(gameCompletionVoice(adult, "walk", true)).toEqual({stage: "adult", form, text: "这一小段路走完了。" + text});
  });

  it("does not invent a stage or a missing adult form", () => {
    expect(gameCompletionVoice(undefined, "stars", true)).toBeNull();
    expect(gameCompletionVoice(emptyGrowth("egg"), "stars", true)).toBeNull();
    const adult = emptyGrowth("adult"); adult.care.play = 100;
    expect(gameCompletionVoice(adult, "stars", true)).toBeNull();
    adult.form = "future" as never;
    expect(gameCompletionVoice(adult, "stars", true)).toBeNull();
  });
});
