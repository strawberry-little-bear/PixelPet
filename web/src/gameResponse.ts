import { parkCatalog } from "./walk";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const timestamp = (v: unknown) => integer(v, 0, 8640000000000000);
const cells = (v: unknown, length: number, max: number) =>
  Array.isArray(v) && v.length === length && v.every(cell => integer(cell, 0, max));
const point = (v: unknown) => record(v) && integer(v.x, 0, 11) && integer(v.y, 0, 9);
const ending = (v: unknown, choices: string[]) => v === undefined || choices.includes(v as string);

function tiles(v: unknown): boolean {
  return record(v) && cells(v.board, 16, 8) && integer(v.pick, -1, 15) &&
    integer(v.pairs, 0, 8) && integer(v.shuffles);
}
function snake(v: unknown): boolean {
  return record(v) && Array.isArray(v.body) && v.body.length > 0 && v.body.length <= 120 &&
    v.body.every(point) && point(v.food) && integer(v.direction, 0, 3) && integer(v.eaten, 0, 8) &&
    integer(v.step) && timestamp(v.lastMoveAt) && typeof v.paused === "boolean" &&
    ending(v.end, ["", "wall", "body", "won", "limit"]);
}
function tetris(v: unknown): boolean {
  if (!record(v)) return false;
  const p = v.active;
  return cells(v.board, 96, 7) && integer(v.next, 1, 7) &&
    [v.lines, v.pieces, v.step].every(n => integer(n)) && timestamp(v.lastFallAt) &&
    typeof v.paused === "boolean" && ending(v.end, ["", "won", "stacked", "limit"]) &&
    // Active is legitimately omitted at the end of a game. Bound rotation and
    // coordinates before blockCells/ghost loops, not just before drawing cells.
    (p == null || (record(p) && integer(p.kind, 1, 7) && integer(p.rotation, 0, 3) &&
      integer(p.x, 0, 7) && integer(p.y, 0, 11)));
}
function walking(v: unknown): boolean {
  return record(v) && Array.isArray(v.route) && v.route.length === 12 &&
    v.route.every(item => item === "rock" || item === "branch") &&
    Array.isArray(v.souvenirs) && v.souvenirs.length === 3 &&
    v.souvenirs.every(id => parkCatalog.some(item => item.id === id)) &&
    integer(v.beat, 0, 72) && [v.step, v.cleared, v.poseUntil].every(n => integer(n)) &&
    ["", "jump", "duck"].includes(v.pose as string) && timestamp(v.lastPulseAt) &&
    timestamp(v.lastInputAt) && typeof v.paused === "boolean";
}

// Only reply display safety: never reconstruct a board, restart a session or
// validate reward/chronology/connectivity rules here. The server owns saves and
// migrations. Fishing catches and treasure retain their existing separate guards.
export function validGameResponse(v: unknown): boolean {
  if (v == null) return true;
  if (!record(v) || (v.kind !== undefined && !["", "tiles", "snake", "tetris", "fishing", "walk", "treasure"].includes(v.kind as string))) return false;
  if (!timestamp(v.startedAt) || !integer(v.round, 0, 4) || !integer(v.score) ||
    !integer(v.lastBeat, -1) || (v.id !== undefined && typeof v.id !== "string")) return false;
  // Legacy stars have neither kind nor id. Validate supplied models too: some
  // hooks/cursors read them even when the kind-specific screen is not active.
  return ([
    ["tiles", "tiles", tiles], ["snake", "snake", snake],
    ["tetris", "tetris", tetris], ["walk", "walking", walking],
  ] as const).every(([kind, key, valid]) =>
    (v.kind === kind || v[key] != null) ? valid(v[key]) : true);
}
