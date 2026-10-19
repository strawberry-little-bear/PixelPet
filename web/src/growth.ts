import type { AdultForm, Growth, GrowthStage, PetState } from "./types";

export const stageNames: Record<GrowthStage, string> = {
  egg: "等待孵化",
  baby: "幼年期",
  growing: "成长期",
  adult: "成年期",
};
export const formNames: Record<AdultForm, string> = {
  balanced: "均衡型",
  lively: "活力型",
  gentle: "恬静型",
  easygoing: "自在型",
};
export const formDescriptions: Record<AdultForm, string> = {
  balanced: "日常照顾相互配合，长成温暖的小伙伴。",
  lively: "经常一起玩耍，长成爱冒险的小伙伴。",
  gentle: "喜欢清爽与安稳休息，长成安静的小伙伴。",
  easygoing: "按自己的节奏长大，之后也能继续好好照顾。",
};
export function emptyGrowth(stage: GrowthStage = "baby"): Growth {
  return {
    stage,
    points: 0,
    form: "",
    trackedHours: 0,
    wellbeing: 0,
    growingAt: 0,
    adultAt: 0,
    care: {
      nutrition: 0,
      play: 0,
      clean: 0,
      rest: 0,
      lastFeed: 0,
      lastPlay: 0,
      lastClean: 0,
    },
  };
}
// Allows an already open tab to render during the server's schema-1 -> 2 update.
export function petGrowth(pet: PetState | null, now: number): Growth {
  if (pet?.growth) return pet.growth;
  const g = emptyGrowth(pet?.hatchedAt ? "baby" : "egg");
  if (!pet?.hatchedAt) return g;
  g.points = Math.min(72, Math.max(0, (now - pet.hatchedAt) / 3600000));
  if (g.points >= 24) g.stage = "growing";
  if (g.points >= 72) {
    g.stage = "adult";
    g.form = "balanced";
  }
  return g;
}
// The same unrounded predicates drive the provisional form and its explanation.
// Keep the existing server tolerances and priority; the handbook never decides
// or overwrites a saved adult form.
export function formConditions(g: Pick<Growth, "trackedHours" | "wellbeing"> & {
  care: Pick<Growth["care"], "play" | "clean" | "rest">;
}): { conditions: Record<AdultForm, boolean>; first: AdultForm } {
  const gentle = (g.care.clean + g.care.rest) / 2;
  const easygoing = g.trackedHours >= 12 && g.wellbeing / g.trackedHours < 0.45 - 1e-9;
  const lively = g.care.play >= 2 && g.care.play > gentle * 1.5 + 1e-9;
  const calm = gentle >= 2 - 1e-9 && gentle > g.care.play * 1.5 + 1e-9;
  return {
    conditions: { easygoing, lively, gentle: calm, balanced: !easygoing && !lively && !calm },
    first: easygoing ? "easygoing" : lively ? "lively" : calm ? "gentle" : "balanced",
  };
}
export function tendency(g: Growth): AdultForm {
  return g.form || formConditions(g).first;
}
export function growthProgress(g: Growth) {
  const { points, target } = stagePoints(g);
  return Math.max(0, Math.min(100, (points / target) * 100));
}
export function stagePoints(g: Growth) {
  return g.stage === "adult"
    ? { points: 72, target: 72 }
    : g.stage === "growing"
      ? { points: g.points - 24, target: 48 }
      : { points: g.points, target: 24 };
}

// Round remaining points upwards: a nearly complete stage is never shown as
// already finished before the authoritative state actually advances it.
export function nextGrowthGoal(g: Growth): string {
  if (g.stage === "adult") return `${formNames[g.form || "balanced"]}已定型，继续温柔陪伴`;
  if (g.stage === "egg") return "按 B 迎接小伙伴，开始成长旅程";
  const target = g.stage === "growing" ? 72 : 24;
  const remaining = Math.ceil(Math.max(0, target - g.points) * 100) / 100;
  return `距${g.stage === "baby" ? "成长期" : "成年期"}还差 ${remaining.toFixed(2)} 点`;
}

// Shared with handbook navigation so page count and wraparound cannot drift.
export const growthPageCount = 6;

// Keep the priority explicit: comfort is checked before dominant habits.
export const formRules: { form: AdultForm; rule: string }[] = [
  { form: "easygoing", rule: "记录 ≥12h 且平均舒适度 <45%" },
  { form: "lively", rule: "陪玩 ≥2 且 > 恬静分 ×1.5" },
  { form: "gentle", rule: "恬静分 ≥2 且 > 陪玩 ×1.5" },
  { form: "balanced", rule: "其余情况，日常习惯相互配合" },
];
