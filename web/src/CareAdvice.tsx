import { bodyNeed, petNeed } from "./needs";
import { careMenuLabel } from "./careMenu";
import type { PetState } from "./types";

// Reuse the pet's existing need priority; this is advice, not an extra reward rule.
export function careAdvice(pet: PetState): string {
  if (!pet.hatchedAt) return "先迎接小伙伴，再慢慢了解它。";
  if (pet.game) return "先收好或结束本局，再照顾小伙伴。";
  if (pet.sleeping) {
    const need = bodyNeed(pet);
    if (need) {
      const care = need.kind === "hungry" ? "吃点东西" : "洗澡";
      const action = careMenuLabel(need.kind === "hungry" ? "feed" : "clean");
      return `${pet.needs.energy >= 100 ? "体力已满" : "正在休息"}；醒来后优先${care}。先从菜单选「${careMenuLabel("sleep", true)}」，再选「${action}」；体力满后不再增加休息习惯。`;
    }
    return pet.needs.energy >= 100
      ? `体力已满，可以从菜单选「${careMenuLabel("sleep", true)}」；继续睡不会增加休息习惯。`
      : "正在休息，不必急着叫醒；体力满后不再增加休息习惯。";
  }
  switch (petNeed(pet)?.kind) {
    case "hungry": return `现在适合吃点东西；从菜单选「${careMenuLabel("feed")}」。`;
    case "dirty": return `现在适合洗澡；从菜单选「${careMenuLabel("clean")}」。`;
    case "tired": return `现在适合休息；从菜单选「${careMenuLabel("sleep")}」。`;
    case "playful": return `想一起玩一会儿；从菜单选「${careMenuLabel("arcade")}」，去游戏角看看。`;
    case "quiet": return "可以安静陪伴，不必为了成长反复照顾。";
    default: return "现在很舒适，不必为了成长反复照顾。";
  }
}

export function CareAdvice({ pet }: { pet: PetState }) {
  return <p className="care-advice" aria-label="照顾建议">{careAdvice(pet)}</p>;
}
