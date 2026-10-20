import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
import { validCoreResponse } from "./response";

const now = Date.now();
const common = { id: "0123456789abcdef0123456789abcdef", startedAt: now, round: 0, score: 0, lastBeat: -1 };
const tiles = { board: Array(16).fill(1), pick: -1, pairs: 0, shuffles: 0 };
const snake = { body: [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }], food: { x: 8, y: 5 }, direction: 0, eaten: 0, step: 0, lastMoveAt: now, paused: true };
const tetris = { board: Array(96).fill(0), active: { kind: 1, rotation: 0, x: 2, y: 0 }, next: 2, lines: 0, pieces: 0, step: 0, lastFallAt: now, paused: true };
const walking = { route: Array(12).fill("rock"), souvenirs: ["leaf", "flower", "pebble"], beat: 0, step: 0, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: now, lastInputAt: now, paused: true };
const games = {
  stars: { ...common }, tiles: { ...common, kind: "tiles", tiles }, snake: { ...common, kind: "snake", snake },
  tetris: { ...common, kind: "tetris", tetris }, walk: { ...common, kind: "walk", walking },
  fishing: { ...common, kind: "fishing", fishing: { spot: 0, casts: 0, catches: null, phase: "ready", step: 0, waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: now, paused: true } },
  treasure: { ...common, kind: "treasure", treasure: { layout: [0, 1, 2, 3, 0, 1, 2, 3, 0], opened: [], step: 0, paused: true } },
};
function reply(game: unknown) {
  return { state: { schema: 17, revision: 1, species: 2, name: "模型边界", createdAt: now, hatchedAt: now, lastTick: now,
    sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0, logs: [], game }, serverTime: now, message: "" };
}
afterEach(() => vi.unstubAllGlobals());
const invalid: [string, unknown][] = [
  ["scalar game", "tiles"], ["array game", []], ["unknown kind", { ...common, kind: "stars" }],
  ["object kind", { ...common, kind: {} }], ["object score", { ...common, score: {} }],
  ["unsafe score", { ...common, score: Number.MAX_SAFE_INTEGER + 1 }], ["negative round", { ...common, round: -1 }],
  ["unsafe date", { ...common, startedAt: 8640000000000001 }], ["bad beat", { ...common, lastBeat: -2 }],
  ["bad id", { ...common, id: {} }],
];
for (const [name, model, fields] of [
  ["tiles", tiles, { board: [null, {}, Array(15).fill(1), [...Array(15).fill(1), 9]], pick: [-2, 16, {}], pairs: [-1, 9], shuffles: ["0"] }],
  ["snake", snake, { body: [null, {}, [], Array(121).fill({ x: 0, y: 0 }), [null], [{ x: 12, y: 0 }]], food: [null, { x: 0, y: 10 }], direction: [4], eaten: [-1, 9], step: ["0"], lastMoveAt: [-1], paused: ["true"], end: [{}] }],
  ["tetris", tetris, { board: [null, {}, Array(95).fill(0), [...Array(95).fill(0), 8]], active: [{ kind: 99, rotation: 0, x: 2, y: 0 }, { kind: 1, rotation: 1e9, x: 2, y: 0 }, { kind: 1, rotation: 0, x: 2, y: -1e9 }, {}], next: [99], lines: [{}], pieces: [-1], step: ["0"], lastFallAt: [-1], paused: [null], end: ["other"] }],
  ["walk", walking, { route: [null, {}, Array(11).fill("rock"), [...Array(11).fill("rock"), "unknown"]], souvenirs: [null, [], ["leaf", "flower", "unknown"]], beat: [73], step: [null], cleared: [{}], pose: ["fly"], poseUntil: [-1], lastPulseAt: [-1], lastInputAt: [-1], paused: [1] }],
] as const) {
  const key = name === "walk" ? "walking" : name;
  for (const missing of [undefined, null, [], "model"]) invalid.push([`${name} missing/non-object model ${JSON.stringify(missing)}`, { ...common, kind: name, [key]: missing }]);
  for (const [field, values] of Object.entries(fields)) for (const bad of values) {
    invalid.push([`${name}.${field}=${JSON.stringify(bad)}`, { ...common, kind: name, [key]: { ...model, [field]: bad } }]);
  }
}
// Hooks also inspect supplied models outside their kind-specific game screen.
invalid.push(["damaged extra tetris model", { ...games.tiles, tetris: { ...tetris, board: null } }]);
it.each(invalid)("rejects %s through read and uncertain-write recovery", async (_, game) => {
  const r = reply(game);
  expect(validCoreResponse(r)).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(r))));
  await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
  await expect(request("action", { kind: "play" })).rejects.toMatchObject({ outcome: "unknown" });
});
it.each(Object.entries(games))("accepts %s display shapes without mutation", (_, game) => {
  const r = reply(game), before = structuredClone(r);
  expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
it.each([undefined, null, { ...common, id: undefined }, { ...common, id: "", kind: "" },
  { ...games.tetris, tetris: { ...tetris, active: undefined, end: "won" } },
  { ...games.tetris, tetris: { ...tetris, active: null, end: "stacked" } },
  // Display safety does not enforce score chronology, board connectivity or rewards.
  { ...games.snake, score: 3 }, { ...games.tiles, tiles: { ...tiles, board: Array(16).fill(0) } },
])("preserves legal legacy/empty boundary %j", game => {
  const r = reply(game), before = structuredClone(r);
  expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
