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
export function tendency(g: Growth): AdultForm {
  if (g.form) return g.form;
  if (g.trackedHours >= 12 && g.wellbeing / g.trackedHours < 0.45 - 1e-9)
    return "easygoing";
  const gentle = (g.care.clean + g.care.rest) / 2;
  if (g.care.play >= 2 && g.care.play > gentle * 1.5 + 1e-9) return "lively";
  if (gentle >= 2 - 1e-9 && gentle > g.care.play * 1.5 + 1e-9) return "gentle";
  return "balanced";
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
