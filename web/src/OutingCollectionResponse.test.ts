import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api";
import { validCoreResponse } from "./response";
import { fishCatalog } from "./fishing";
import { parkCatalog } from "./walk";
const now = Date.now();
const discovery = { id: "reed-minnow", firstAt: now, lastAt: now, count: 1 };
const models = [
  { field: "pond", entries: "fish", ids: fishCatalog.map(f => f.id), metadata: { since: now } },
  { field: "park", entries: "finds", ids: parkCatalog.map(f => f.id), metadata: { since: now, walks: 0, lastWalkAt: 0 } },
] as const;
function reply(field: string, value: unknown) {
  return { state: { schema: 17, revision: 1, species: 2, name: "图鉴边界", createdAt: now, hatchedAt: now, lastTick: now,
    sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0, logs: [], [field]: value },
  serverTime: now, message: "" };
}
afterEach(() => vi.unstubAllGlobals());
for (const model of models) {
  const collection = (entries: unknown) => ({ ...model.metadata, [model.entries]: entries });
  const invalid: [string, unknown][] = [
    ["array model", []], ["missing metadata", {}], ["bad since", { ...collection([]), since: "today" }],
    ["undisplayable since", { ...collection([]), since: 8640000000000001 }],
    ["object collection", collection({})], ["string collection", collection("empty")],
    ...[null, [], {}, { ...discovery, id: {} }, { ...discovery, id: "made-up" },
      { ...discovery, firstAt: "today" }, { ...discovery, lastAt: -1 }, { ...discovery, lastAt: 8640000000000001 },
      { ...discovery, count: 0 }, { ...discovery, count: -1 }, { ...discovery, count: 1.5 },
      { ...discovery, count: "two" }, { ...discovery, count: Number.MAX_SAFE_INTEGER + 1 }]
      .map((entry, i) => [`unsafe entry ${i}`, collection([entry])] as [string, unknown]),
    ...(model.field === "park" ? [
      ["bad walks", { ...collection([]), walks: "zero" }], ["negative walks", { ...collection([]), walks: -1 }],
      ["fractional walks", { ...collection([]), walks: 1.5 }], ["bad last walk", { ...collection([]), lastWalkAt: {} }],
    ] as [string, unknown][] : []),
  ];
  it.each(invalid)(`${model.field} rejects %s without accepting fake empty history or write success`, async (_, value) => {
    const r = reply(model.field, value);
    expect(validCoreResponse(r)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(r))));
    await expect(request("state")).rejects.toMatchObject({ outcome: "unavailable" });
    await expect(request("action", { kind: "feed" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it.each([undefined, null, model.metadata, collection(null), collection([]),
    collection(model.ids.map(id => ({ ...discovery, id })))])(`${model.field} accepts optional/empty/known records unchanged (%j)`, value => {
    const r = reply(model.field, value), before = structuredClone(r);
    expect(validCoreResponse(r)).toBe(true); expect(r).toEqual(before);
  });
}
