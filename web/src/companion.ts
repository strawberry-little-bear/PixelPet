import { games } from "./games";
import type { Companion, GameExperience } from "./types";

export type SharedGameKind = (typeof games)[number]["id"];
export const interestLimit = 5;
export const experienceWords: Record<SharedGameKind, string> = {
  stars: "还记得刚才的星光，轻轻挥了挥。",
  tiles: "把刚才配好的小图案，又认真看了看。",
  snake: "想起一起收的果子，开心地轻轻摇晃。",
  tetris: "像刚才叠积木一样，认真地点点头。",
  fishing: "想起刚才的池塘，安静地看着小鱼。",
};

export function interestSummary(c?: Companion) {
  const best = Math.max(0, ...(c?.interests.map(r => r.points) ?? []));
  if (best < 2) return "还在慢慢了解彼此，玩喜欢的就好。";
  const leaders = c!.interests.filter(r => r.points === best);
  return leaders.length === 1
    ? `目前更熟悉${games.find(g => g.id === leaders[0].kind)?.title}，不是固定性格。`
    : "熟悉的游戏不止一种，不必只玩一种。";
}

// A read/refresh cannot create an echo. Match the local session being settled,
// require saved care feedback, and suppress duplicate response delivery.
export function completedExperience(
  beforeID: string | undefined,
  experience: GameExperience | undefined,
  hasFeedback: boolean,
  seen: Set<string>,
) {
  if (!beforeID || !experience || !hasFeedback ||
      experience.id !== beforeID || seen.has(experience.id)) return null;
  seen.add(experience.id);
  if (seen.size > 16) seen.delete(seen.values().next().value!);
  return experience;
}
