import type { Result } from "./types";
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

// Guard the required, render-critical core before applying a successful reply.
// This is not a second save/schema validator: migrations and gameplay rules
// remain the server's responsibility. Never repair a reply
// with invented needs, empty logs or a fabricated success message.
export function validCoreResponse(value: unknown): value is Result {
  if (!record(value) || !record(value.state)) return false;
  const state = value.state;
  const needs = state.needs;
  if (!record(needs)) return false;
  return count(state.schema) && state.schema > 0 &&
    count(state.revision) && count(state.species) &&
    typeof state.name === "string" && typeof state.sleeping === "boolean" &&
    timestamp(state.createdAt) && timestamp(state.hatchedAt) && timestamp(state.lastTick) &&
    count(state.careCount) && validGrowth(state.growth) &&
    ["hunger", "mood", "clean", "energy"].every(key => {
      return typeof needs[key] === "number" && Number.isFinite(needs[key]) && needs[key] >= 0 && needs[key] <= 100;
    }) &&
    // A nil Go log slice is valid legacy data and is rendered as no entries.
    (state.logs == null || (Array.isArray(state.logs) && state.logs.every(log =>
      record(log) && timestamp(log.at) && typeof log.text === "string"))) &&
    timestamp(value.serverTime) && typeof value.message === "string" &&
    (value.saveGeneration === undefined || validSaveGeneration(value.saveGeneration));
}
