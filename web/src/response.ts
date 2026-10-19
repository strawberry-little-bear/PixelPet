import type { Result } from "./types";
import { validSaveGeneration } from "./requestFailure";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is number =>
  count(value) && value <= 8640000000000000;

// Guard the required, render-critical core before applying a successful reply.
// This is not a second save/schema validator: optional feature data, migrations
// and gameplay rules remain the server's responsibility. Never repair a reply
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
    count(state.careCount) &&
    ["hunger", "mood", "clean", "energy"].every(key => {
      return typeof needs[key] === "number" && Number.isFinite(needs[key]) && needs[key] >= 0 && needs[key] <= 100;
    }) &&
    // A nil Go log slice is valid legacy data and is rendered as no entries.
    (state.logs == null || (Array.isArray(state.logs) && state.logs.every(log =>
      record(log) && timestamp(log.at) && typeof log.text === "string"))) &&
    timestamp(value.serverTime) && typeof value.message === "string" &&
    (value.saveGeneration === undefined || validSaveGeneration(value.saveGeneration));
}
