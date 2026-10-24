import { describe, expect, it } from "vitest";
import { quietAtmosphere } from "./quiet-atmosphere";

const localTime = (hour: number, day = 24) => new Date(2026, 9, day, hour, 0, 0, 0).getTime();

describe("quietAtmosphere", () => {
  it.each([
    [2, "late-night", "深夜"], [7, "dawn", "晨光"], [10, "day", "白天"],
    [14, "afternoon", "午后"], [18, "dusk", "晚霞"], [22, "night", "月夜"],
  ] as const)("maps %s:00 to the local %s cue", (hour, period, label) => {
    expect(quietAtmosphere(2, "growing", "", localTime(hour))).toMatchObject({ period, label });
  });

  it("is deterministic for the same present context and changes gently with the day", () => {
    const at = localTime(14, 24);
    const first = quietAtmosphere(2, "adult", "gentle", at);
    expect(first).toEqual(quietAtmosphere(2, "adult", "gentle", at));
    expect(first?.text).not.toBe(quietAtmosphere(2, "adult", "gentle", localTime(14, 25))?.text);
  });

  it("uses saved adult form as presentation input without writing or inventing state", () => {
    const lively = quietAtmosphere(2, "adult", "lively", localTime(14));
    const gentle = quietAtmosphere(2, "adult", "gentle", localTime(14));
    expect(lively).toBeTruthy(); expect(gentle).toBeTruthy();
    expect(lively?.period).toBe(gentle?.period);
    expect(lively?.text).not.toBe(gentle?.text);
  });

  it("does not manufacture a cue for invalid presentation data", () => {
    expect(quietAtmosphere(-1, "baby", "", localTime(10))).toBeNull();
    expect(quietAtmosphere(2, undefined, "", localTime(10))).toBeNull();
    expect(quietAtmosphere(2, "baby", "", NaN)).toBeNull();
  });
});
