import { games } from "./games";
import type { GameInfo } from "./games";
import type { GameReceipt, PetState, Result, WalkGameReceipt } from "./types";

export type GameOutcomeRecord = {
  kind: GameInfo["id"];
  at: number;
  message: string;
  shared: boolean | null;
  gameReceipt?: GameReceipt;
};
const finishActions: Record<GameInfo["id"], string> = {
  stars: "catch", tiles: "tile-pick", snake: "snake-finish", tetris: "tetris-finish",
  fishing: "fish-finish", walk: "walk-finish", treasure: "treasure-finish",
};

// Capture only this page's accepted completion. Never parse coins out of prose,
// subtract wallets (another tab may have spent coins), or reconstruct a lost
// acknowledgement from a later read/log. The server's result stays verbatim.
export function completedGameOutcome(action: string, before: PetState | null, result: Result): GameOutcomeRecord | null {
  const game = before?.game, after = result.state;
  const kind = games.find(g => g.id === (game?.kind || "stars"))?.id;
  if (!before || !game || !game.id || !kind || action !== finishActions[kind] || after.game ||
      before.createdAt !== after.createdAt || before.hatchedAt !== after.hatchedAt || before.species !== after.species ||
      after.revision < before.revision || typeof result.message !== "string" || !result.message.trim() || result.message.length > 4096 ||
      !Number.isSafeInteger(result.serverTime) || result.serverTime <= 0 || result.serverTime > 8.64e15) return null;
  const recent = after.companion?.recent;
  const record: GameOutcomeRecord = { kind, at: result.serverTime, message: result.message,
    shared: after.companion ? recent?.id === game.id && recent.kind === kind : null };
  const walk = kind === "walk" ? validWalkReceipt(result.gameReceipt?.walk) : undefined;
  if (walk) record.gameReceipt = { walk };
  return record;
}

function validWalkReceipt(value: unknown): WalkGameReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const numbers = [v.cleared, v.total, v.routeCoins, v.performanceCoins, v.awardedCoins];
  if (!numbers.every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1000)) return undefined;
  const receipt = value as WalkGameReceipt;
  if (receipt.total !== 12 || receipt.routeCoins !== 3 || receipt.performanceCoins !== Math.floor(receipt.cleared / 4) || receipt.awardedCoins > receipt.routeCoins + receipt.performanceCoins) return undefined;
  return { ...receipt };
}
