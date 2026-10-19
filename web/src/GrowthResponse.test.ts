import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { Result } from "./types";

const now = Date.now();
const base: Result = { state: { schema: 12, revision: 1, species: 2, name: "成长回复", createdAt: now - 1000, hatchedAt: now - 1000,
  lastTick: now, sleeping: false, careCount: 0, logs: [], needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, growth: emptyGrowth() }, serverTime: now, message: "" };
const invalid: [string, unknown][] = [
  ["array growth", []], ["primitive growth", 3], ["missing stage", { ...emptyGrowth(), stage: undefined }],
  ["unknown stage", { ...emptyGrowth(), stage: "teen" }], ["object form", { ...emptyGrowth(), form: {} }],
  ["unknown form", { ...emptyGrowth(), form: "invisible" }], ["string points", { ...emptyGrowth(), points: "1" }],
  ["null points", { ...emptyGrowth(), points: null }], ["negative points", { ...emptyGrowth(), points: -1 }],
  ["missing habits", { ...emptyGrowth(), care: undefined }], ["array habits", { ...emptyGrowth(), care: [] }],
  ["string rest", { ...emptyGrowth(), care: { ...emptyGrowth().care, rest: "0.02" } }],
  ["missing feed time", { ...emptyGrowth(), care: { ...emptyGrowth().care, lastFeed: undefined } }],
  ["negative habit", { ...emptyGrowth(), care: { ...emptyGrowth().care, clean: -.1 } }],
  ["string tracking", { ...emptyGrowth(), trackedHours: "12" }], ["null wellbeing", { ...emptyGrowth(), wellbeing: null }],
  ["invalid growing date", { ...emptyGrowth(), growingAt: 8640000000000001 }],
  ["invalid adult date", { ...emptyGrowth(), adultAt: 8640000000000001 }],
  ["array form record", { ...emptyGrowth(), formRecord: [] }], ["incomplete form record", { ...emptyGrowth(), formRecord: {} }],
  ...["nutrition", "play", "clean", "rest", "trackedHours", "wellbeing"].map(key => [
    `string record ${key}`, { ...emptyGrowth("adult"), form: "balanced", points: 72,
      formRecord: { nutrition: 0, play: 0, clean: 0, rest: .02, trackedHours: 12, wellbeing: 9.6, [key]: "bad" } },
  ] as [string, unknown]),
];
function respond(growth: unknown) {
  const result = { ...base, state: { ...base.state, growth } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
  return JSON.parse(JSON.stringify(result));
}
afterEach(() => vi.unstubAllGlobals());

describe.each(["state", "action"])("growth response guard on %s", path => {
  it.each(invalid)("does not accept %s as a renderable success", async (_, growth) => {
    respond(growth);
    await expect(request(path, path === "action" ? { kind: "feed" } : undefined)).rejects.toMatchObject({ outcome: path === "action" ? "unknown" : "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, emptyGrowth("egg"), emptyGrowth("baby"), { ...emptyGrowth("growing"), points: 30, growingAt: now },
    { ...emptyGrowth("adult"), form: "gentle", points: 72, growingAt: now, adultAt: now },
    { ...emptyGrowth("adult"), form: "balanced", points: 72, growingAt: now, adultAt: now, formRecord: null },
    { ...emptyGrowth("adult"), form: "balanced", points: 72, growingAt: now, adultAt: now,
      formRecord: { nutrition: 0, play: 0, clean: 0, rest: .02, trackedHours: 12, wellbeing: 9.6 } },
    { ...emptyGrowth(), futureGrowthField: { untouched: true }, care: { ...emptyGrowth().care, futureHabit: 2 } },
  ])("keeps compatible missing/valid/future growth unchanged %#", async growth => {
    const expected = respond(growth);
    expect(await request(path, path === "action" ? { kind: "feed" } : undefined)).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
