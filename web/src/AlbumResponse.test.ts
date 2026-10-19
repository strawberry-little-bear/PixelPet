import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
import { validCoreResponse } from "./response";
import type { Memory, Result } from "./types";
const now = Date.now(), memory = { kind: "meal", at: now, source: "shared" };
const album = () => ({ since: now, legacy: false, entries: [{ ...memory }] });
function reply(): Result {
  return { state: { schema: 12, revision: 1, species: 2, name: "回忆好好留着", createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0, logs: [] }, serverTime: now, message: "" };
}
const invalid: [string, unknown][] = [
  ["array album", []], ["missing album metadata", {}], ["bad since", { ...album(), since: "yesterday" }],
  ["undisplayable since", { ...album(), since: 8640000000000001 }], ["non-boolean legacy", { ...album(), legacy: "false" }],
  ["object entries", { ...album(), entries: {} }], ["string entries", { ...album(), entries: "memories" }],
  ...[null, [], {}, { ...memory, kind: {} }, { ...memory, kind: "unknown" }, { ...memory, at: "today" },
    { ...memory, at: 8640000000000001 }, { ...memory, at: -1 }, { ...memory, source: {} }, { ...memory, source: "unknown" },
    { ...memory, form: {} }, { ...memory, form: "unknown" }, { ...memory, item: {} }, { ...memory, score: {} },
    { ...memory, score: -1 }, { ...memory, score: 1.5 }, { ...memory, days: "seven" }, { ...memory, days: -1 },
    { ...memory, days: Number.MAX_SAFE_INTEGER + 1 }].map((entry, index) => [`unsafe entry ${index}`, { ...album(), entries: [entry] }] as [string, unknown]),
];
afterEach(() => vi.unstubAllGlobals());
it.each(invalid)("rejects %s before it reaches album rendering or save success", async (_, value) => {
  const r = { ...reply(), state: { ...reply().state, album: value } };
  expect(validCoreResponse(r)).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(r))));
  await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
  await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
});
it.each([undefined, null, album(), { ...album(), entries: [] }, { ...album(), entries: null }])("accepts missing/legacy/empty albums without editing the response (%j)", value => {
  const r = { ...reply(), state: { ...reply().state, album: value } }, before = structuredClone(r);
  expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
const kinds: Memory["kind"][] = ["hatch", "growing", "adult", "meal", "bath", "goodnight", "stars", "perfect-stars", "days", "outfit", "decoration", "wallpaper", "floor", "tiles", "snake", "tetris", "fishing", "walk"];
it.each(kinds)("preserves display-safe %s memories and optional old fields", kind => {
  const entries = [{ kind, at: now, source: "saved", score: 0, days: 7, form: "gentle", item: "future-cosmetic-id" }];
  const r = { ...reply(), state: { ...reply().state, album: { ...album(), legacy: true, entries } } };
  expect(validCoreResponse(r)).toBe(true);
});
