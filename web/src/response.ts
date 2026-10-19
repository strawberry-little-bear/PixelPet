import type { Result } from "./types";
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

// Feedback is optional on old servers. If provided, its base fields are used
// directly by the short success text. Optional effect receipts retain their own
// local guard; missing/bad effect metadata does not make safe feedback unusable.
function validCareFeedback(value: unknown): boolean {
  if (value == null) return true;
  return record(value) &&
    ["feed", "clean", "catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "sleep"].includes(value.kind as string) &&
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
    timestamp(value.from) && timestamp(value.to) &&
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
  return count(state.schema) && state.schema > 0 &&
    count(state.revision) && count(state.species) &&
    typeof state.name === "string" && typeof state.sleeping === "boolean" &&
    timestamp(state.createdAt) && timestamp(state.hatchedAt) && timestamp(state.lastTick) &&
    count(state.careCount) && validGrowth(state.growth) && validCompanion(state.companion) &&
    validNeeds(state.needs) &&
    // A nil Go log slice is valid legacy data and is rendered as no entries.
    (state.logs == null || (Array.isArray(state.logs) && state.logs.every(log =>
      record(log) && timestamp(log.at) && typeof log.text === "string"))) &&
    timestamp(value.serverTime) && typeof value.message === "string" && validCareFeedback(value.careFeedback) &&
    validReturnRecap(value.returnRecap) &&
    (value.recapPending === undefined || typeof value.recapPending === "boolean") &&
    (value.recapClaimed === undefined || typeof value.recapClaimed === "boolean") &&
    (value.saveGeneration === undefined || validSaveGeneration(value.saveGeneration));
}
