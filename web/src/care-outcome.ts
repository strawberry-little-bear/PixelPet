import type { AdultForm, CareFeedback, PetState, Result } from "./types";

export type CareOutcomeFeedback = CareFeedback & { companionResponse?: string };
type CareMoment = "feed" | "clean" | "wake";
const baby: Record<CareMoment, string> = {
  feed: "它小口吃好饭团，轻轻靠近你。",
  clean: "它抖抖洗净的身子，朝你眨眨眼。",
  wake: "它睡眼蒙眬地望望你，慢慢舒展身子。",
};
const growing: Record<CareMoment, string> = {
  feed: "它吃好饭团，抬起头认真望望你。",
  clean: "它舒展开洗净的身子，轻轻回应你。",
  wake: "它慢慢睁开眼睛，朝熟悉的你靠近一些。",
};
const adult: Record<AdultForm, Record<CareMoment, string>> = {
  balanced: {
    feed: "它吃好饭团，安稳地陪在你身边。",
    clean: "它洗净身子，在你身边安稳地待着。",
    wake: "它慢慢醒来，安稳地望着身边的你。",
  },
  lively: {
    feed: "它吃好饭团，朝你轻轻晃了晃身子。",
    clean: "它抖抖洗净的身子，朝你轻轻晃一晃。",
    wake: "它睁开眼睛，朝你轻轻晃了晃身子。",
  },
  gentle: {
    feed: "它吃好饭团，静静地朝你靠近一点。",
    clean: "它洗净身子，静静地依在你身边。",
    wake: "它慢慢醒来，静静地朝你靠近一点。",
  },
  easygoing: {
    feed: "它慢慢吃好饭团，悠然地眨眨眼。",
    clean: "它洗净身子，慢悠悠地舒展一下。",
    wake: "它悠悠睁开眼睛，慢慢舒展身子。",
  },
};

// Keep this page's accepted response. Reads, elapsed age and later habits must
// never reconstruct or rewrite a previous care moment. Missing legacy metadata
// retains the existing generic receipt; the server's numbers stay untouched.
export function completedCareOutcome(action: string, before: PetState | null, result: Result): CareOutcomeFeedback | null {
  const feedback = result.careFeedback, after = result.state;
  if (!feedback) return null;
  const effect = feedback.effect;
  if (!before || !before.hatchedAt || before.createdAt !== after.createdAt ||
      before.hatchedAt !== after.hatchedAt || before.species !== after.species || after.revision < before.revision ||
      !effect || effect.at !== result.serverTime || !Number.isSafeInteger(effect.at) || effect.at <= 0 || effect.at > 8.64e15)
    return feedback;
  let moment: CareMoment;
  if ((action === "feed" || action === "clean") && feedback.kind === action && !before.sleeping && !after.sleeping &&
      ["credited", "cooldown", "not-needed"].includes(feedback.reason)) moment = action;
  else if (action === "sleep" && feedback.kind === "sleep" && feedback.reason === "awake" && before.sleeping && !after.sleeping)
    moment = "wake";
  else return feedback;
  const growth = after.growth;
  const companionResponse = growth?.stage === "baby" ? baby[moment] : growth?.stage === "growing" ? growing[moment] :
    growth?.stage === "adult" && typeof growth.form === "string" && Object.hasOwn(adult, growth.form) ? adult[growth.form as AdultForm][moment] : undefined;
  return companionResponse ? { ...feedback, companionResponse } : feedback;
}
