import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
import { fishCatalog } from "./fishing";
import { validCoreResponse } from "./response";
const now = Date.now();
function reply(fishing: unknown) {
  return { state: { schema: 17, revision: 1, species: 2, name: "钓鱼边界", createdAt: now, hatchedAt: now, lastTick: now,
    sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0, logs: [],
    game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing", startedAt: now, round: 0, score: 0, lastBeat: -1, fishing } },
    serverTime: now, message: "" };
}
const session = { spot: 0, casts: 0, phase: "ready", step: 0, waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: now, paused: true };
afterEach(() => vi.unstubAllGlobals());
const invalid: [string, unknown][] = [
  ["missing session", undefined], ["null session", null], ["array session", []],
  ["string session", "empty"], ["object catches", { ...session, catches: {} }],
  ["string catches", { ...session, catches: "fish" }], ["numeric catches", { ...session, catches: 0 }],
  ["null catch", { ...session, catches: [null] }], ["object catch", { ...session, catches: [{}] }],
  ["unknown catch", { ...session, catches: ["made-up"] }], ["nested array", { ...session, catches: [[]] }],
  ["too many catches", { ...session, catches: Array(4).fill("reed-minnow") }],
];
it.each(invalid)("rejects %s rather than treating damaged catches as empty", async (_, fishing) => {
  const r = reply(fishing);
  expect(validCoreResponse(r)).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(r))));
  await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
  await expect(request("action", { kind: "fish-reel" })).rejects.toMatchObject({ outcome: "unknown" });
});
it.each([undefined, null, [], ...fishCatalog.map(f => [f.id]), ["reed-minnow", "reed-minnow", "rain-koi"]])("accepts empty or known catches unchanged (%j)", catches => {
  const r = reply({ ...session, ...(catches === undefined ? {} : { catches }) }), before = structuredClone(r);
  // Display-shape checks, not a second validator for casts, rain or discovery credit.
  expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
});
it("does not make the optional legacy game mandatory", () => {
  const r = reply(null);
  expect(validCoreResponse({ ...r, state: { ...r.state, game: null } })).toBe(true);
  expect(validCoreResponse({ ...r, state: { ...r.state, game: undefined } })).toBe(true);
});
