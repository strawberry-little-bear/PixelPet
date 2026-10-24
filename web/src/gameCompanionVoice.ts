import { tendency } from "./growth";
import type { AdultForm, GameExperience, Growth } from "./types";

export type GameCompanionVoice = {
  form: AdultForm;
  text: string;
};

const formLines: Record<AdultForm, Record<GameExperience["kind"], string>> = {
  balanced: {
    stars: "它稳稳陪你接住每一颗星星。",
    tiles: "它稳稳陪你把图案一对对收好。",
    snake: "它稳稳陪你看清下一步，再向前走。",
    tetris: "它稳稳陪你想好落点，再放下积木。",
    fishing: "它稳稳陪你守着浮漂，慢慢等回应。",
    walk: "它稳稳陪你走完这一小段路。",
    treasure: "它稳稳陪你翻找每一片落叶。",
  },
  lively: {
    stars: "它跃跃欲试，想和你一起追上星星。",
    tiles: "它跃跃欲试，等着和你一起找到下一对。",
    snake: "它跃跃欲试，跟着你的方向动起来。",
    tetris: "它跃跃欲试，准备和你一起把积木搭高。",
    fishing: "它跃跃欲试，陪你盯紧水面等鱼来。",
    walk: "它跃跃欲试，想和你一起走快一点。",
    treasure: "它跃跃欲试，想马上拨开落叶看看。",
  },
  gentle: {
    stars: "它安静观察着，陪你慢慢等星星落下。",
    tiles: "它安静观察着，陪你慢慢找出相同图案。",
    snake: "它安静观察着，陪你慢慢想好转弯。",
    tetris: "它安静观察着，陪你慢慢看清落点。",
    fishing: "它安静观察着，陪你听着水声等浮漂。",
    walk: "它安静地陪着你，一步一步看沿途风景。",
    treasure: "它安静观察着，陪你慢慢翻找林间小物。",
  },
  easygoing: {
    stars: "它按自己的节奏陪你接星星，不急着赶。",
    tiles: "它按自己的节奏陪你配对，慢慢来就好。",
    snake: "它按自己的节奏陪你前进，转弯也不急。",
    tetris: "它按自己的节奏陪你搭积木，先想清楚再落下。",
    fishing: "它按自己的节奏陪你等鱼，不必催浮漂。",
    walk: "它按自己的节奏陪你散步，沿路看看就好。",
    treasure: "它按自己的节奏陪你探索，不必一次找完。",
  },
};

function validForm(value: unknown): value is AdultForm {
  return value === "balanced" || value === "lively" || value === "gentle" || value === "easygoing";
}

function hasGrowingEvidence(growth: Growth) {
  const care = growth.care;
  return [growth.trackedHours, care?.nutrition, care?.play, care?.clean, care?.rest]
    .some(value => typeof value === "number" && Number.isFinite(value) && value > 0);
}

/**
 * A read-only line for a game companion. It follows the same saved/provisional
 * tendency rules as the game directory and never changes game state.
 */
export function gameCompanionVoice(growth: Growth | undefined, game: GameExperience["kind"]): GameCompanionVoice | null {
  if (!growth) return null;
  const form = growth.stage === "adult" && validForm(growth.form)
    ? growth.form
    : growth.stage === "growing" && hasGrowingEvidence(growth)
      ? tendency(growth)
      : null;
  return form ? { form, text: formLines[form][game] } : null;
}
