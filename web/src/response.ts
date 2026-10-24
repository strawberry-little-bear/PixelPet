import { validGameResponse } from "./gameResponse";
import { fishCatalogFor } from "./fishing";
import { parkCatalog } from "./walk";
import { outingMemoryWords } from "./outing-memory";
import type { Memory, Result } from "./types";
import { careHabitUnits } from "./careHabitUnits";
import { games } from "./games";
import { interestLimit } from "./companion";
import { validSaveGeneration } from "./requestFailure";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is number =>
  count(value) && value <= 8640000000000000;

// Optional on old servers, but render-critical when present: the scene,
// handbook and care explanations read these numbers and nested habits directly.
// Check display-safe shapes only; stage thresholds, chronology, form selection
// and migration remain the server's responsibility. Never fill missing records.
const growthQuantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
function validGrowth(value: unknown): boolean {
  if (value == null) return true;
  if (!record(value) || !record(value.care)) return false;
  const care = value.care;
  const evidence = value.formRecord;
  return ["egg", "baby", "growing", "adult"].includes(value.stage as string) &&
    ["", "balanced", "lively", "gentle", "easygoing"].includes(value.form as string) &&
    ["points", "trackedHours", "wellbeing"].every(key => growthQuantity(value[key])) &&
    ["growingAt", "adultAt"].every(key => timestamp(value[key])) &&
    ["nutrition", "play", "clean", "rest"].every(key => growthQuantity(care[key])) &&
    ["lastFeed", "lastPlay", "lastClean"].every(key => timestamp(care[key])) &&
    (evidence == null || (record(evidence) &&
      ["nutrition", "play", "clean", "rest", "trackedHours", "wellbeing"].every(key => growthQuantity(evidence[key]))));
}

// Optional legacy shared history is still render-critical when supplied:
// the handbook maps interests, repeats bounded integer dots, and formats dates.
// Check safe shapes only; chronology/credit/order remain server rules. Never
// turn malformed history into an empty record or invent a completed game.
const sharedGame = (value: unknown) => games.some(game => game.id === value);
function validGameExperience(value: unknown): boolean {
  return value == null || (record(value) && sharedGame(value.kind) &&
    typeof value.id === "string" && value.id.trim().length > 0 && timestamp(value.at));
}
function validCompanion(value: unknown): boolean {
  return value == null || (record(value) && timestamp(value.since) &&
    Array.isArray(value.interests) && value.interests.every(interest => record(interest) &&
      sharedGame(interest.kind) && count(interest.points) && interest.points <= interestLimit && timestamp(interest.lastAt)) &&
    validGameExperience(value.recent));
}

// Permanent memories are optional on old servers. Supplied records are read
// by filter/sort, date formatting and artwork selection; reject unsafe shapes
// before accepting the response, never replace damaged history with an empty
// album. Chronology, uniqueness and how memories are earned stay server rules.
const memoryKinds: Record<Memory["kind"], unknown> = {
  ...outingMemoryWords,
  hatch: true, growing: true, adult: true, meal: true, bath: true, goodnight: true, rested: true,
  stars: true, "perfect-stars": true, days: true, outfit: true, decoration: true,
  wallpaper: true, floor: true, tiles: true, snake: true, tetris: true, fishing: true, walk: true, treasure: true, keepsake: true,
};
function validAlbum(value: unknown): boolean {
  return value == null || (record(value) && timestamp(value.since) && typeof value.legacy === "boolean" &&
    // A nil Go slice is a legitimate empty legacy/egg album.
    (value.entries == null || (Array.isArray(value.entries) && value.entries.every(memory =>
      record(memory) && typeof memory.kind === "string" && Object.hasOwn(memoryKinds, memory.kind) &&
      timestamp(memory.at) && ["shared", "saved", "elapsed"].includes(memory.source as string) &&
      (memory.form === undefined || ["", "balanced", "lively", "gentle", "easygoing"].includes(memory.form as string)) &&
      (memory.score === undefined || count(memory.score)) && (memory.days === undefined || count(memory.days)) &&
      (memory.item === undefined || typeof memory.item === "string") &&
      (memory.outingId === undefined || typeof memory.outingId === "string")))));
}

// Nil/missing Go slices are legal empty saved collections. Only those absent
// values mean empty: reject malformed supplied history before rendering instead
// of hiding it behind an Array.isArray fallback. Save chronology/uniqueness and
// discovery credit remain server rules; this guard does not modify the response.
function validDiscoveries(value: unknown, ids: readonly { id: string }[]): boolean {
  return value == null || (Array.isArray(value) && value.every(discovery =>
    record(discovery) && ids.some(item => item.id === discovery.id) &&
    timestamp(discovery.firstAt) && timestamp(discovery.lastAt) &&
    count(discovery.count) && discovery.count > 0));
}
function validPond(value: unknown, schema: number): boolean {
  return value == null || (record(value) && timestamp(value.since) && validDiscoveries(value.fish, fishCatalogFor({ schema })));
}
function validPark(value: unknown): boolean {
  return value == null || (record(value) && timestamp(value.since) && count(value.walks) &&
    timestamp(value.lastWalkAt) && validDiscoveries(value.finds, parkCatalog));
}

// Empty Go catches may be null or omitted even in an active session. Do not
// confuse them with malformed supplied arrays or an absent fishing model.
// This only guards display shape; phase/credit/sky rules stay on the server.
function validFishingResponse(value: unknown, schema: number): boolean {
  if (!record(value) || value.kind !== "fishing") return true;
  const n = value.fishing;
  const catalog = fishCatalogFor({ schema });
  return record(n) && (n.catches == null || (Array.isArray(n.catches) && n.catches.length <= 3 &&
    n.catches.every(id => catalog.some(fish => fish.id === id))));
}

// Cosmetics and shop data are optional on legacy servers, but supplied models
// are read directly by outfit previews, ownership checks and purchase quotes.
// A nil Go slice means no belongings/catalog, not a damaged supplied array.
// Prices, catalog IDs, ownership consistency and reward caps stay server-owned.
function validEconomy(value: unknown): boolean {
  if (value == null) return true;
  if (!record(value) || !record(value.equipped)) return false;
  const equipped = value.equipped;
  return ["coins", "gameCoins"].every(key => count(value[key])) &&
    ["lastDailyAt", "lastGameAt"].every(key => timestamp(value[key])) &&
    (value.owned == null || (Array.isArray(value.owned) && value.owned.every(id => typeof id === "string"))) &&
    ["accessory", "room"].every(key => typeof equipped[key] === "string") &&
    ["wallpaper", "floor"].every(key => equipped[key] === undefined || typeof equipped[key] === "string");
}
function validShop(value: unknown): boolean {
  return value == null || (record(value) && count(value.dailyCoins) && count(value.gameDailyLimit) &&
    (value.maxCoins === undefined || count(value.maxCoins)) &&
    (value.catalog == null || (Array.isArray(value.catalog) && value.catalog.every(item => record(item) &&
      ["id", "name", "description"].every(key => typeof item[key] === "string") &&
      ["accessory", "room", "wallpaper", "floor"].includes(item.slot as string) && count(item.price)))));
}

// Feedback is optional on old servers. If provided, its base fields are used
// directly by the short success text. Optional effect receipts retain their own
// local guard; missing/bad effect metadata does not make safe feedback unusable.
function validTilePath(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return false;
  return value.every((item) => record(item) && count(item.x) && item.x <= 5 && count(item.y) && item.y <= 5);
}

function validCareFeedback(value: unknown): boolean {
  if (value == null) return true;
  return record(value) &&
    ["feed", "clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish", "sleep"].includes(value.kind as string) &&
    ["credited", "not-needed", "cooldown", "resting", "awake"].includes(value.reason as string) &&
    typeof value.points === "number" && Number.isFinite(value.points) && value.points >= 0 && value.points <= 72 &&
    careHabitUnits(value.habitGain) !== null &&
    (value.habit === undefined || ["nutrition", "clean", "play"].includes(value.habit as string)) &&
    (value.retryAt === undefined || timestamp(value.retryAt));
}

// Historical snapshots are optional metadata, never reconstructed from the
// current pet. Validate before presentation/claim: date formatting and needs
// read both endpoints directly. Missing sleep context remains unknown.
function validReturnSnapshot(value: unknown): boolean {
  return record(value) && validNeeds(value.needs) &&
    ["egg", "baby", "growing", "adult"].includes(value.stage as string) &&
    ["", "balanced", "lively", "gentle", "easygoing"].includes(value.form as string) &&
    ["points", "rest", "trackedHours"].every(key => growthQuantity(value[key])) &&
    (value.sleeping == null || typeof value.sleeping === "boolean");
}
function validReturnRecap(value: unknown): boolean {
  return value == null || (record(value) && typeof value.id === "string" && value.id.trim().length > 0 &&
    // Both dates may be renderable while the saved interval still runs backward.
    // Do not let absenceLabel turn it into a fabricated one-minute return.
    timestamp(value.from) && timestamp(value.to) && value.from <= value.to &&
    validReturnSnapshot(value.before) && validReturnSnapshot(value.after));
}
function validNeeds(value: unknown): boolean {
  return record(value) && ["hunger", "mood", "clean", "energy"].every(key => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
  });
}

// Guard the required, render-critical core before applying a successful reply.
// This is not a second save/schema validator: migrations and gameplay rules
// remain the server's responsibility. Never repair a reply
// with invented needs, empty logs or a fabricated success message.
export function validCoreResponse(value: unknown): value is Result {
  if (!record(value) || !record(value.state)) return false;
  const state = value.state;
  const schema = state.schema;
  if (!count(schema) || schema <= 0) return false;
  return count(state.revision) && count(state.species) &&
    typeof state.name === "string" && typeof state.sleeping === "boolean" &&
    timestamp(state.createdAt) && timestamp(state.hatchedAt) && timestamp(state.lastTick) &&
    count(state.careCount) && validEconomy(state.economy) && validShop(value.shop) && validGameResponse(state.game) && validTreasureResponse(state.game) && validFishingResponse(state.game, schema) && validGrowth(state.growth) && validCompanion(state.companion) && validAlbum(state.album) && validPond(state.pond, schema) && validPark(state.park) &&
    validNeeds(state.needs) &&
    // A nil Go log slice is valid legacy data and is rendered as no entries.
    (state.logs == null || (Array.isArray(state.logs) && state.logs.every(log =>
      record(log) && timestamp(log.at) && typeof log.text === "string"))) &&
    timestamp(value.serverTime) && typeof value.message === "string" && validCareFeedback(value.careFeedback) &&
    (value.tileLink === undefined || validTilePath(value.tileLink)) &&
    (value.tileHint === undefined || validTilePath(value.tileHint)) &&
    validReturnRecap(value.returnRecap) &&
    (value.recapPending === undefined || typeof value.recapPending === "boolean") &&
    (value.recapClaimed === undefined || typeof value.recapClaimed === "boolean") &&
    (value.saveGeneration === undefined || validSaveGeneration(value.saveGeneration));
}

// Only the new render-critical model; other existing game guards stay unchanged.
function validTreasureResponse(value: unknown): boolean {
  if (!record(value) || value.kind !== "treasure") return true;
  const n = value.treasure;
  return record(n) && Array.isArray(n.layout) && n.layout.length === 9 &&
    n.layout.every(item => count(item) && item <= 3) &&
    Array.isArray(n.opened) && n.opened.length <= 6 &&
    n.opened.every(index => count(index) && index < 9) && new Set(n.opened).size === n.opened.length &&
    count(n.step) && n.step <= 1_000_000 && typeof n.paused === "boolean";
}
