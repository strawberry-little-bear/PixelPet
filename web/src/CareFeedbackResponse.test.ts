import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { Result } from "./types";

const now = Date.now();
const credit = { kind: "feed", points: .25, habit: "nutrition", habitGain: 1, reason: "credited" };
const base: Result = { state: { schema: 12, revision: 1, species: 2, name: "照顾反馈", createdAt: now - 1000, hatchedAt: now - 1000,
  lastTick: now, sleeping: false, careCount: 0, logs: [], needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, growth: emptyGrowth() }, serverTime: now, message: "" };
const invalid: [string, unknown][] = [
  ["array feedback", []], ["primitive feedback", 1], ["empty feedback", {}],
  ["string points", { ...credit, points: "1" }], ["object points", { ...credit, points: {} }],
  ["missing points", { ...credit, points: undefined }], ["negative points", { ...credit, points: -1 }],
  ["too many points", { ...credit, points: 73 }], ["null points", { ...credit, points: null }],
  ["object habit", { ...credit, habit: {} }], ["unknown habit", { ...credit, habit: "food" }],
  ["string gain", { ...credit, habitGain: "1" }], ["fractional gain", { ...credit, habitGain: .5 }],
  ["missing gain", { ...credit, habitGain: undefined }], ["negative gain", { ...credit, habitGain: -1 }],
  ["too much gain", { ...credit, habitGain: 2 }],
  ["object kind", { ...credit, kind: {} }], ["unknown kind", { ...credit, kind: "walk-start" }],
  ["object reason", { ...credit, reason: {} }], ["unknown reason", { ...credit, reason: "okay" }],
  ["string retry time", { ...credit, retryAt: "123" }], ["negative retry time", { ...credit, retryAt: -1 }],
  ["unrenderable retry time", { ...credit, retryAt: 8640000000000001 }],
];
function respond(careFeedback: unknown) {
  const result = { ...base, careFeedback };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
  return JSON.parse(JSON.stringify(result));
}
afterEach(() => vi.unstubAllGlobals());

describe.each(["state", "action"])("care feedback guard on %s", path => {
  it.each(invalid)("rejects %s before rendering or announcing reward", async (_, careFeedback) => {
    respond(careFeedback);
    await expect(request(path, path === "action" ? { kind: "feed" } : undefined)).rejects.toMatchObject({ outcome: path === "action" ? "unknown" : "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, credit,
    { ...credit, points: 0 },
    { ...credit, habitGain: 1.4 - .4 },
    { ...credit, habitGain: 2.2 - 1.2 },
    { ...credit, reason: "cooldown", points: 0, habitGain: 0, retryAt: now },
    { ...credit, reason: "not-needed", points: 0, habitGain: 0 },
    { kind: "sleep", reason: "resting", points: 0, habitGain: 0 },
    { kind: "sleep", reason: "awake", points: 0, habitGain: 0 },
    ...["catch", "tile-pick", "snake-finish", "tetris-finish", "fish-finish", "walk-finish", "treasure-finish"].map(kind => ({ ...credit, kind, habit: "play" })),
    { ...credit, futureField: { untouched: true } },
    // Optional before/after metadata has its own receipt guard. It remains optional,
    // and a malformed effect must not invalidate otherwise usable feedback/state.
    { ...credit, effect: { before: null } },
  ])("preserves valid/old/optional metadata unchanged %#", async feedback => {
    const expected = respond(feedback);
    expect(await request(path, path === "action" ? { kind: "feed" } : undefined)).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
