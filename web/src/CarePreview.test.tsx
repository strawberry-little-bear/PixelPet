import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CarePreview, carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { CareRules, GrowthStage, PetState } from "./types";

const now = 2_000_000_000_000;
function pet(stage: GrowthStage = "baby"): PetState {
  const growth = emptyGrowth(stage);
  if (stage === "adult") Object.assign(growth, { points: 72, form: "gentle" });
  return { schema: 11, revision: 1, species: 2, name: "预览伙伴", createdAt: now - 4 * 86400000,
    hatchedAt: now - 4 * 86400000, lastTick: now, sleeping: false,
    needs: { hunger: 60, clean: 60, mood: 80, energy: 80 }, careCount: 0, growth, logs: [] };
}
afterEach(cleanup);

describe("read-only care preview", () => {
  it.each([
    ["feed", "hunger", 70, "符合记录"],
    ["feed", "hunger", 70.000001, "饱食已满足"],
    ["feed", "hunger", 95.999999, "饱食已满足"],
    ["feed", "hunger", 96, "暂时不能喂食"],
    ["clean", "clean", 65, "符合记录"],
    ["clean", "clean", 65.000001, "清洁已满足"],
    ["clean", "clean", 98.999999, "清洁已满足"],
    ["clean", "clean", 99, "暂时不用洗澡"],
  ] as const)("matches %s need boundary %s=%s", (kind, key, value, text) => {
    const p = pet(); p.needs[key] = value;
    expect(carePreview(p, kind).join("")).toContain(text);
  });

  it("explains the remaining food room and the nominal side effect near full", () => {
    const p = pet();
    p.needs.hunger = 95;
    const rules = { actions: { feed: { hunger: 20, mood: 3, clean: -3 } } } as unknown as CareRules;
    const text = carePreview(p, "feed", rules).join("");
    expect(text).toContain("最多补 5 点到 100");
    expect(text).toContain("清洁基准下降 3 点，到 0 为止");
    expect(text).toContain("饱食达到 96 后不能喂食");
  });

  it.each([0, 1, 3, 60])("qualifies the feed side effect when cleanliness is %s", clean => {
    const p = pet();
    p.needs.hunger = 95;
    p.needs.clean = clean;
    const original = structuredClone(p);
    const rules = { actions: { feed: { hunger: 20, clean: -3 } } } as unknown as CareRules;
    const text = carePreview(p, "feed", rules).join("");
    expect(text).toContain("清洁基准下降 3 点，到 0 为止");
    expect(text).not.toContain("清洁会下降 3 点");
    expect(p).toEqual(original);
  });

  it("qualifies the legacy feed side effect without inventing a numeric rule", () => {
    const p = pet(); p.needs.hunger = 95; p.needs.clean = 0;
    const text = carePreview(p, "feed").join("");
    expect(text).toContain("清洁可能稍微下降，最低到 0");
    expect(text).not.toContain("下降 3 点");
  });

  it("explains the upper clamp if the server supplies a positive cleanliness effect", () => {
    const p = pet(); p.needs.hunger = 95; p.needs.clean = 99;
    const rules = { actions: { feed: { hunger: 20, clean: 3 } } } as unknown as CareRules;
    expect(carePreview(p, "feed", rules).join("")).toContain("清洁基准增加 3 点，到 100 为止");
  });

  it("keeps the near-cap explanation on the executable side of the 96 boundary", () => {
    const near = pet(); near.needs.hunger = 95.999999;
    expect(carePreview(near, "feed").join("")).toContain("饱食达到 96 后不能喂食");
    const full = pet(); full.needs.hunger = 96;
    expect(carePreview(full, "feed").join("")).toContain("暂时不能喂食");
    expect(carePreview(full, "feed").join("")).not.toContain("最多补");
  });

  it.each(["feed", "clean"] as const)("matches %s cooldown inclusivity and keeps need priority", kind => {
    const p = pet(), field = kind === "feed" ? "lastFeed" : "lastClean";
    for (const [ago, credited] of [[0, false], [30 * 60000 - 1, false], [30 * 60000, true], [31 * 60000, true]] as const) {
      p.growth!.care[field] = now - ago;
      expect(carePreview(p, kind).join("")).toContain(credited ? "符合记录" : "间隔内");
    }
    p.growth!.care[field] = now;
    p.needs[kind === "feed" ? "hunger" : "clean"] = 80;
    expect(carePreview(p, kind).join("")).toContain("已满足");
    expect(carePreview(p, kind).join("")).not.toContain("间隔内");
    p.growth!.care[field] = 0;
    p.needs[kind === "feed" ? "hunger" : "clean"] = 60;
    expect(carePreview(p, kind).join("")).toContain("符合记录");
  });

  it.each(["baby", "growing", "adult"] as const)("never mutates or promises a new adult form in %s", stage => {
    const p = pet(stage), original = structuredClone(p);
    for (const kind of ["feed", "clean", "sleep"] as const) {
      const text = carePreview(p, kind, { awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 },
        sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
        growth: { basePerHour: .5, comfortPerHour: .75, restEnergyPerHabit: 28, restPointsPerHabit: .25 } }).join("");
      expect(text).toContain(stage === "adult" ? "形态不变" : "+0.25");
      if (stage === "adult") expect(text).not.toContain("成长 +");
    }
    expect(p).toEqual(original);
  });

  it("does not manufacture legacy care history or rewards", () => {
    const p = pet(); delete p.growth;
    expect(carePreview(p, "feed").join("")).toContain("尚未读到");
    expect(carePreview(p, "clean").join("")).not.toContain("+0.25");
    expect(carePreview(p, "sleep").join("")).toContain("尚未读到");
  });

  it("does not expire cached cooldowns according to the client clock", () => {
    const p = pet(); p.growth!.care.lastFeed = now - 10 * 60000;
    const before = carePreview(p, "feed");
    const native = Date.now;
    try { Date.now = () => now + 86400000; expect(carePreview(p, "feed")).toEqual(before); }
    finally { Date.now = native; }
    p.lastTick = now + 21 * 60000;
    expect(carePreview(p, "feed").join("")).toContain("符合记录");
  });

  it("explains sleeping, waking, full energy, and their real rest requirement", () => {
    const p = pet(); p.sleeping = true;
    for (const kind of ["feed", "clean"] as const) expect(carePreview(p, kind).join("")).toContain("先选「起床啦」");
    expect(carePreview(p, "sleep").join("")).toContain("反复睡下或叫醒");
    p.sleeping = false;
    expect(carePreview(p, "sleep").join("")).toContain("饱食和清洁仍会下降");
    p.needs.energy = 100;
    expect(carePreview(p, "sleep").join("")).toContain("不增加休息习惯");
  });

  it.each(["feed", "clean", "sleep"] as const)("does not invite %s before hatching or during a game", kind => {
    const p = pet(); p.hatchedAt = 0;
    expect(carePreview(p, kind).join("")).toContain("先迎接");
    p.hatchedAt = now - 10000; p.game = { startedAt: now, score: 0, round: 0, lastBeat: -1 };
    expect(carePreview(p, kind).join("")).toContain("先收好或结束");
  });

  it.each(["feed", "clean", "sleep", "status", "arcade"])("renders %s without new controls or live announcements", kind => {
    const p = pet(); const { container } = render(<CarePreview pet={p} kind={kind} hint="只读说明" />);
    expect(container.querySelector("button,a,input,[tabindex],[aria-live]")).toBeNull();
    expect(container.textContent).toContain(["status", "arcade"].includes(kind) ? "只读说明" : "实际以照顾结果为准");
  });
});
