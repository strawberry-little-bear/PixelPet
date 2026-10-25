import { games } from "./games";
import { formNames, hasGrowthEvidence, tendency } from "./growth";
import type { AdultForm, Growth } from "./types";

export type GamePreference = {
  form: AdultForm;
  basis: "growing" | "adult";
  titles: string[];
  text: string;
};

const preferenceIds: Record<AdultForm, readonly string[]> = {
  balanced: ["stars", "tiles", "walk"],
  lively: ["stars", "snake", "walk"],
  gentle: ["fishing", "tiles", "treasure"],
  easygoing: ["treasure", "fishing", "walk"],
};

const preferenceTexts: Record<AdultForm, string> = {
  balanced: "最近的照顾习惯比较均衡，接星星、连连看或散步都可以试试。",
  lively: "最近更有活力，接星星、贪吃蛇或公园散步可能更合心情。",
  gentle: "最近更喜欢安静观察，钓鱼、连连看或森林寻宝都可以慢慢来。",
  easygoing: "最近想按自己的节奏探索，森林寻宝、钓鱼或散步都很合适。",
};

function validForm(value: unknown): value is AdultForm {
  return value === "balanced" || value === "lively" || value === "gentle" || value === "easygoing";
}

/**
 * A read-only suggestion for the game directory. It reflects saved growth
 * habits, but never changes selection, rewards, growth or the game rules.
 */
export function gamePreference(growth?: Growth): GamePreference | null {
  if (!growth) return null;
  let form: AdultForm;
  let basis: GamePreference["basis"];
  if (growth.stage === "adult" && validForm(growth.form)) {
    form = growth.form;
    basis = "adult";
  } else if (growth.stage === "growing" && hasGrowthEvidence(growth)) {
    form = tendency(growth);
    basis = "growing";
  } else {
    return null;
  }
  const titles = preferenceIds[form].flatMap(id => {
    const title = games.find(game => game.id === id)?.title;
    return title ? [title] : [];
  });
  return { form, basis, titles, text: preferenceTexts[form] };
}

export function gamePreferenceLabel(preference: GamePreference) {
  return preference.basis === "adult"
    ? `${formNames[preference.form]}的小伙伴偏好`
    : `成长期的${formNames[preference.form]}线索`;
}

export function gameIsPreferred(preference: GamePreference, gameId: string) {
  return preferenceIds[preference.form].includes(gameId);
}
