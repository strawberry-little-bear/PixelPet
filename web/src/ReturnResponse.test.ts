import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { Result, ReturnRecap } from "./types";

const now = Date.now();
const snapshot = { needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, stage: "baby" as const, form: "" as const, points: 1, rest: 0, trackedHours: 1, sleeping: false };
const recap: ReturnRecap = { id: "old-return-id", from: now - 1800000, to: now, before: structuredClone(snapshot), after: structuredClone(snapshot) };
const base: Result = { state: { schema: 12, revision: 1, species: 2, name: "回访回复", createdAt: now - 3600000, hatchedAt: now - 3600000,
  lastTick: now, sleeping: false, careCount: 0, logs: [], needs: snapshot.needs, growth: emptyGrowth() }, serverTime: now, message: "" };
const invalid: [string, Record<string, unknown>][] = [
  ...[["array", []], ["primitive", 1], ["empty", {}],
    ["missing id", { ...recap, id: undefined }], ["object id", { ...recap, id: {} }], ["empty id", { ...recap, id: " " }],
    ["string from", { ...recap, from: "123" }], ["negative to", { ...recap, to: -1 }],
    ["unrenderable from", { ...recap, from: 8640000000000001 }], ["missing to", { ...recap, to: undefined }],
    ["from after to", { ...recap, from: now + 1 }], ["to before from", { ...recap, to: recap.from - 1 }],
    ["reversed to epoch zero", { ...recap, to: 0 }],
  ].map(([name, value]) => [String(name), { returnRecap: value }] as [string, Record<string, unknown>]),
  ...["before", "after"].flatMap(endpoint => [
    ["missing snapshot", undefined], ["array snapshot", []], ["missing needs", { ...snapshot, needs: null }],
    ["array needs", { ...snapshot, needs: [] }], ["string need", { ...snapshot, needs: { ...snapshot.needs, energy: "80" } }],
    ["overfull need", { ...snapshot, needs: { ...snapshot.needs, hunger: 101 } }],
    ["negative need", { ...snapshot, needs: { ...snapshot.needs, clean: -1 } }],
    ["unknown stage", { ...snapshot, stage: "elder" }], ["object form", { ...snapshot, form: {} }],
    ["string points", { ...snapshot, points: "1" }], ["missing rest", { ...snapshot, rest: undefined }],
    ["negative hours", { ...snapshot, trackedHours: -1 }], ["too many hours", { ...snapshot, trackedHours: 1000001 }],
    ["string sleeping", { ...snapshot, sleeping: "false" }],
  ].map(([name, value]) => [`${endpoint} ${name}`, { returnRecap: { ...recap, [endpoint]: value } }] as [string, Record<string, unknown>])),
  ["string pending", { recapPending: "false" }], ["object claimed", { recapClaimed: {} }],
];
const old = structuredClone(recap); delete old.before.sleeping; delete old.after.sleeping;
const partial = structuredClone(recap); delete partial.before.sleeping;
const compatible = [ {}, { returnRecap: null }, { returnRecap: recap, recapPending: true },
  { returnRecap: { ...recap, from: now, to: now } },
  { returnRecap: { ...recap, from: 0, to: now } },
  { returnRecap: old }, { returnRecap: partial },
  { returnRecap: { ...recap, before: { ...snapshot, sleeping: null }, after: { ...snapshot, sleeping: null } } },
  { returnRecap: recap, recapPending: false, recapClaimed: true },
  { returnRecap: { ...recap, futureField: { preserved: true } }, extra: "unchanged" },
];
afterEach(() => vi.unstubAllGlobals());
const paths = [ ["state", undefined], ["visit", {}], ["action", { kind: "feed" }], ["recap/read", { id: recap.id }] ] as const;
describe.each(paths)("return response on %s", (path, body) => {
  it.each(invalid)("rejects %s without retrying or claiming a notification", async (_, fields) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...base, ...fields }))));
    await expect(request(path, body)).rejects.toMatchObject({ outcome: body ? "unknown" : "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(compatible)("preserves compatible optional history %#", async fields => {
    const reply = JSON.parse(JSON.stringify({ ...base, ...fields }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(reply))));
    expect(await request(path, body)).toEqual(reply);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
