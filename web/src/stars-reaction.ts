import type { PetState } from "./types";

type Game = PetState["game"];
export type StarsReaction = { gameId: string; round: number; score: number; beat: number; lane: number };
export const starsReactionMs = 900;

// Only call for this page's accepted catch, never for reads or recovery.
// The fifth catch already has the existing home celebration.
export function starsReactionFor(before: Game, after: Game, lane: unknown): StarsReaction | null {
  if (!before || !after || before.kind || after.kind || !before.id || before.id !== after.id ||
    before.startedAt !== after.startedAt || !Number.isInteger(lane) || (lane as number) < 0 || (lane as number) > 2 ||
    !Number.isInteger(before.round) || before.round < 0 || before.round > 3 || after.round !== before.round + 1 ||
    !Number.isInteger(before.score) || before.score < 0 || before.score > before.round || after.score !== before.score + 1 ||
    !Number.isInteger(before.lastBeat) || before.lastBeat < -1 || !Number.isInteger(after.lastBeat) ||
    after.lastBeat < 0) return null;
  return { gameId: before.id, round: after.round, score: after.score, beat: after.lastBeat, lane: lane as number };
}

export function starsReactionMatches(reaction: StarsReaction | null | undefined, game: Game, lane: number): boolean {
  return !!reaction && !!game && !game.kind && reaction.gameId === game.id && reaction.round === game.round &&
    reaction.score === game.score && reaction.beat === game.lastBeat && reaction.lane === lane;
}
