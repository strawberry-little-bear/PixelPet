import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { validCoreResponse } from "./response";
import { games } from "./games";
import type { Result } from "./types";
const now = Date.now();
const experience = { id: "saved-session", kind: "tiles", at: now };
function reply(): Result {
  return { state: { schema: 12, revision: 1, species: 2, name: "一起慢慢玩", createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0, logs: [],
    companion: { since: now - 3600000, interests: games.map(g => ({ kind: g.id, points: 0, lastAt: 0 })), recent: { ...experience, kind: "tiles" } } },
    serverTime: now, message: "" };
}
const invalid: [string, Record<string, unknown>][] = [
  ["non-object companion", { companion: [] }],
  ["missing interests", { companion: { since: now } }],
  ["null interests", { companion: { since: now, interests: null } }],
  ["non-array interests", { companion: { since: now, interests: {} } }],
  ["null interest", { companion: { since: now, interests: [null] } }],
  ...["2", -.1, 1.5, 6, 1000000000].map(points => [`unsafe repeat count ${points}`, { companion: { since: now, interests: [{ kind: "tiles", points, lastAt: 0 }] } }] as [string, Record<string, unknown>]),
  ["unknown interest kind", { companion: { since: now, interests: [{ kind: "invented", points: 2, lastAt: 0 }] } }],
  ["invalid lastAt", { companion: { since: now, interests: [{ kind: "tiles", points: 2, lastAt: "yesterday" }] } }],
  ["undisplayable since", { companion: { since: 8640000000000001, interests: [] } }],
  ["undisplayable recent date", { companion: { since: now, interests: [], recent: { ...experience, at: 8640000000000001 } } }],
  ["missing recent date", { companion: { since: now, interests: [], recent: { id: "saved-session", kind: "tiles" } } }],
  ["unknown recent game", { companion: { since: now, interests: [], recent: { ...experience, kind: "invented" } } }],
  ["empty recent ID", { companion: { since: now, interests: [], recent: { ...experience, id: " " } } }],
  ["non-string recent ID", { companion: { since: now, interests: [], recent: { ...experience, id: {} } } }],
];
afterEach(() => vi.unstubAllGlobals());
describe("provided shared-game history must be render-safe before applying a response", () => {
  it.each(invalid)("rejects %s for reads and unknown writes", async (_label, state) => {
    const damaged = { ...reply(), state: { ...reply().state, ...state } };
    expect(validCoreResponse(damaged)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(damaged))));
    await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it.each([null, undefined, { since: 0, interests: [] }, { since: now, interests: [{ kind: "tiles", points: 5, lastAt: now }], recent: null }])("preserves legacy/partial safe history %j", companion => {
    expect(validCoreResponse({ ...reply(), state: { ...reply().state, companion } })).toBe(true);
  });
  it.each(games.map(g => g.id))("accepts current game %s and integer interest boundaries", kind => {
    for (const points of [0, 5]) expect(validCoreResponse({ ...reply(), state: { ...reply().state, companion: {
      since: now, interests: [{ kind, points, lastAt: 0 }], recent: { ...experience, kind },
    } } })).toBe(true);
  });
});
