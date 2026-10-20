import type { PetState } from "./types";

export type TreasureReaction = { gameId: string; step: number; cell: number; item: number; serial: number };
export const treasureReactionMs = 1600;

// Called only for this page's accepted dig command, never for reads/resumes.
// Require one newly opened cell; terminal map reveals are not discoveries.
export function treasureReactionFor(before: PetState["game"], after: PetState["game"],
  cell: unknown, serial: number): TreasureReaction | null {
  const a = before?.treasure, b = after?.treasure;
  if (before?.kind !== "treasure" || after?.kind !== "treasure" || !before.id || before.id !== after.id || !a || !b || a.paused ||
    a.layout.length !== 9 || b.layout.length !== 9 ||
    !Number.isInteger(cell) || (cell as number) < 0 || (cell as number) > 8 || a.opened.includes(cell as number) ||
    b.step !== a.step + 1 || b.opened.length !== a.opened.length + 1 || b.opened.at(-1) !== cell ||
    a.opened.some((old, i) => old !== b.opened[i]) || a.layout.some((old, i) => old !== b.layout[i])) return null;
  return { gameId: before.id, step: b.step, cell: cell as number, item: b.layout[cell as number], serial };
}
