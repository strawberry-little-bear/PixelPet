import { games } from "./games";
import type { Companion, FishDiscovery, GameExperience } from "./types";

export type SharedGameKind = (typeof games)[number]["id"];
export type DiscoveryEchoKind = "fish-discovery" | "park-discovery";
export type CompanionEchoKind = SharedGameKind | DiscoveryEchoKind;
export const interestLimit = 5;
export const experienceWords: Record<CompanionEchoKind, string> = {
  treasure: "想起一起探索的林地，把小小发现又看了看。",
  stars: "还记得刚才的星光，轻轻挥了挥。",
  tiles: "把刚才配好的小图案，又认真看了看。",
  snake: "想起一起收的果子，开心地轻轻摇晃。",
  tetris: "像刚才叠积木一样，认真地点点头。",
  walk: "想起刚才的小路，轻轻看看带回的小发现。",
  fishing: "想起刚才的池塘，安静地看着小鱼。",
  "fish-discovery": "刚才遇见了新朋友，还在回想那条小鱼。",
  "park-discovery": "刚才路上有新发现，忍不住又回头看了看。",
};

export function validInterestEntries(c?: Companion) {
  const interests = c?.interests;
  if (!Array.isArray(interests)) return [];
  return interests.filter(entry =>
    !!entry && games.some(game => game.id === entry.kind) &&
    Number.isSafeInteger(entry.points) && entry.points >= 0 && entry.points <= interestLimit);
}

const interestCues: Record<SharedGameKind, string> = {
  stars: "它已经很熟悉一起追星光，发呆时也会抬头看看。",
  tiles: "它已经很熟悉一起找图案，安静时也会认真看一会儿。",
  snake: "它已经很熟悉果园里的转弯，尾巴也跟着轻轻晃。",
  tetris: "它已经很熟悉一起摆积木，安静时也会想想下一块放哪里。",
  fishing: "它已经很熟悉池塘边的等待，发呆时也会听一会儿水声。",
  walk: "它已经很熟悉散步的小路，安静时也想慢慢走走。",
  treasure: "它已经很熟悉森林里的小发现，发呆时也会找找角落。",
};

/**
 * Return one passive line when a single game has become a meaningful shared
 * habit. Ties stay quiet: familiarity is not a personality verdict, and the
 * companion should not be nudged toward one game just because of a tie.
 */
export function interestCue(c?: Companion) {
  const interests = validInterestEntries(c);
  const best = Math.max(0, ...interests.map(entry => entry.points));
  if (best < 2) return null;
  const leaders = interests.filter(entry => entry.points === best);
  if (leaders.length !== 1) return null;
  const kind = leaders[0].kind;
  return { kind, text: interestCues[kind] };
}

export function interestSummary(c?: Companion) {
  const interests = validInterestEntries(c);
  const best = Math.max(0, ...interests.map(r => r.points));
  if (best < 2) return "还在慢慢了解彼此，玩喜欢的就好。";
  const leaders = interests.filter(r => r.points === best);
  return leaders.length === 1
    ? `目前更熟悉${games.find(g => g.id === leaders[0].kind)?.title}，不是固定性格。`
    : "熟悉的游戏不止一种，不必只玩一种。";
}

// Completion history is optional in legacy saves. Only expose it when the
// complete, ordered seven-game record is structurally valid; familiarity and
// memories must never be used to reconstruct missing totals.
export function validCompanionHistory(c?: Companion) {
  const history = c?.history;
  if (!history || !Number.isSafeInteger(c?.since) || c.since <= 0 || c.since > 8.64e15 ||
      !Number.isSafeInteger(history.since) || history.since <= 0 ||
      history.since > 8.64e15 || history.since < c.since ||
      !Array.isArray(history.completions) || history.completions.length !== games.length ||
      !history.completions.every((entry, index) => entry && entry.kind === games[index].id &&
        Number.isSafeInteger(entry.count) && entry.count >= 0)) return null;
  return history;
}

export function companionCompletionTotal(c?: Companion) {
  const history = validCompanionHistory(c);
  return history ? history.completions.reduce((total, entry) => total + BigInt(entry.count), 0n).toString() : null;
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

export type DiscoverySource = "fish" | "park";

/**
 * Record only a species/object that was absent from the previous accepted
 * snapshot. Counts increasing for an already known entry are not new finds.
 * The map is deliberately session-local: refreshes cannot reconstruct a
 * celebration from a saved collection alone.
 */
export function recordNewDiscoveries(
  source: DiscoverySource,
  sessionID: string | undefined,
  before: FishDiscovery[] | null | undefined,
  after: FishDiscovery[] | null | undefined,
  pending: Map<string, DiscoveryEchoKind>,
  seen: Set<string>,
) {
  if (!sessionID) return false;
  const known = new Set((before ?? []).map(item => item.id));
  const kind: DiscoveryEchoKind = source === "fish" ? "fish-discovery" : "park-discovery";
  let recorded = false;
  for (const item of after ?? []) {
    if (known.has(item.id)) continue;
    const key = `${source}:${sessionID}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.set(`${source}:${sessionID}`, kind);
    recorded = true;
  }
  if (seen.size > 32) seen.delete(seen.values().next().value!);
  return recorded;
}

export function takeDiscoveryEcho(
  source: DiscoverySource,
  sessionID: string | undefined,
  pending: Map<string, DiscoveryEchoKind>,
) {
  if (!sessionID) return null;
  const key = `${source}:${sessionID}`;
  const value = pending.get(key) ?? null;
  pending.delete(key);
  return value;
}
