import { games } from "./games";
import type { GameHistory, PetState } from "./types";

// Read only saved counters; old interests and memories cannot recover totals.
export function savedGameHistory(pet: PetState): GameHistory | null {
  const history = pet.companion?.history;
  if (pet.schema < 19 || !Number.isSafeInteger(pet.companion?.since) || !history || !Number.isSafeInteger(history.since) || history.since <= 0 || history.since > 8.64e15 ||
      history.since > pet.lastTick || history.since < pet.companion!.since ||
      !Array.isArray(history.completions) || history.completions.length !== games.length ||
      !history.completions.every((entry, index) => entry && entry.kind === games[index].id &&
        Number.isSafeInteger(entry.count) && entry.count >= 0)) return null;
  return history;
}

export function completionLabel(count: number) {
  return `${count === Number.MAX_SAFE_INTEGER ? "≥" : ""}${count} 局`;
}
