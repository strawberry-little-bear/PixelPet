import { hasGrowthEvidence, tendency } from "./growth";
import type { AdultForm, GameExperience, Growth, GrowthStage } from "./types";

export type GameCompletionVoice = {
  stage: Exclude<GrowthStage, "egg">;
  form?: AdultForm;
  text: string;
};

const sharedLines: Record<GameExperience["kind"], string> = {
  stars: "这一局的星光收好了。",
  tiles: "这一盘图案配好了。",
  snake: "这一段追果子的路收好了。",
  tetris: "这一局积木收好了。",
  fishing: "这趟池塘之行收好了。",
  walk: "这一小段路走完了。",
  treasure: "这趟林间探索收好了。",
};
const formLines: Record<AdultForm, string> = {
  balanced: "它稳稳靠近，和你一起歇一会儿。",
  lively: "它轻快地晃了晃，带着余兴陪在你身边。",
  gentle: "它安静地靠近，陪你慢慢放松下来。",
  easygoing: "它慢悠悠地晃了晃，和你自在地歇一会儿。",
};
const validForm = (form: unknown): form is AdultForm =>
  form === "balanced" || form === "lively" || form === "gentle" || form === "easygoing";

// Read only the accepted after-state. No age-based fallback, reward inference or
// reuse of in-progress hints: even a short/legacy attempt has already ended.
export function gameCompletionVoice(growth: Growth | undefined, game: GameExperience["kind"], shared: boolean | null): GameCompletionVoice | null {
  if (!growth || (growth.stage !== "baby" && growth.stage !== "growing" && growth.stage !== "adult")) return null;
  const stage = growth.stage;
  let form: AdultForm | undefined;
  if (stage === "adult") {
    if (!validForm(growth.form)) return null;
    form = growth.form;
  } else if (stage === "growing") {
    if (hasGrowthEvidence(growth)) {
      // A provisional tendency must not be replaced by a stale adult-form field.
      form = tendency({ ...growth, form: "" });
    }
  }
  const lead = shared === true ? sharedLines[game]
    : shared === false ? "这次尝试先到这里。" : "游戏先告一段落。";
  const response = stage === "baby" ? "小小的它轻轻晃了晃，靠着你歇一会儿。"
    : form ? formLines[form] : "它靠近了些，陪你歇一会儿。";
  return { stage, ...(form && { form }), text: `${lead}${response}` };
}
