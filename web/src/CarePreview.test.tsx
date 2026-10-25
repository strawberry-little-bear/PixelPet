import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CarePreview, careMenuConfirmation, carePreview } from "./CarePreview";
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

  it.each(["feed", "clean"] as const)("shows %s remaining habit minutes from the accepted snapshot", kind => {
    const p = pet(), field = kind === "feed" ? "lastFeed" : "lastClean";
    for (const [ago, minutes] of [[0, 30], [1, 30], [60000, 29], [29 * 60000, 1], [30 * 60000 - 1, 1]]) {
      p.growth!.care[field] = now - ago;
      const text = carePreview(p, kind).join("");
      expect(text).toContain(`最近读取时约还需 ${minutes} 分钟`);
      expect(text).toContain("照顾仍能改善状态");
    }
    p.growth!.care[field] = now - 30 * 60000;
    expect(carePreview(p, kind).join("")).toContain("符合记录");
    expect(carePreview(p, kind).join("")).not.toContain("还需");
  });

  it.each(["feed", "clean"] as const)("does not invent %s eligibility or minutes from invalid/future history", kind => {
    const p = pet(), field = kind === "feed" ? "lastFeed" : "lastClean";
    for (const [at, last] of [[now, now + 1], [now, -1], [now, NaN], [now, Infinity],
      [now, now - .5], [0, 0], [NaN, 0], [Infinity, 0], [now + .5, now]]) {
      p.lastTick = at; p.growth!.care[field] = last;
      const text = carePreview(p, kind).join("");
      expect(text).toContain("间隔待同步");
      expect(text).not.toMatch(/符合记录|还需|成长 \+/);
    }
    p.lastTick = now; p.growth!.care[field] = now + 1;
    p.needs[kind === "feed" ? "hunger" : "clean"] = 80;
    expect(carePreview(p, kind).join("")).toContain("已满足");
    expect(carePreview(p, kind).join("")).not.toContain("待同步");
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

it.each([
 ["feed", "hunger", 95.9, undefined, "B 确认"],
 ["feed", "hunger", 96, undefined, "最近读取：暂不能喂食"],
 ["clean", "clean", 98.9, undefined, "B 确认"],
 ["clean", "clean", 99, undefined, "最近读取：暂不用洗澡"],
 ["feed", "hunger", 96 - 1e-11, 1e-9, "最近读取：暂不能喂食"],
 ["clean", "clean", 99 - 1e-11, 1e-9, "最近读取：暂不用洗澡"],
 ["feed", "hunger", 96 - 1e-11, undefined, "B 确认"],
 ["clean", "clean", 99 - 1e-11, 1, "B 确认"],
] as const)("shares %s / %s=%s boundary guidance with the care preview", (kind, need, value, tolerance, expected) => {
 const saved = pet(); saved.needs[need] = value;
 const rules = { needTolerance: tolerance } as CareRules;
 const before = structuredClone(saved);
 expect(careMenuConfirmation(saved, kind, rules)).toBe(expected);
 const explanation = expected === "B 确认"
  ? kind === "feed" ? "饱食已满足" : "清洁已满足"
  : kind === "feed" ? "暂时不能喂食" : "暂时不用洗澡";
 expect(carePreview(saved, kind, rules).join("")).toContain(explanation);
 expect(saved).toEqual(before);
});
it("does not turn habit cooldowns or missing legacy growth into blocked confirmations", () => {
 const saved = pet(); saved.growth!.care.lastFeed = now;
 expect(careMenuConfirmation(saved, "feed")).toBe("B 确认");
 delete saved.growth;
 expect(careMenuConfirmation(saved, "feed")).toBe("B 确认");
 saved.sleeping = true;
 for (const kind of ["sleep", "status", "moment", "album", "journal"]) {
  expect(careMenuConfirmation(saved, kind)).toBe("B 确认");
 }
});
