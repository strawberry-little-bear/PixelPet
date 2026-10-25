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

  it.each([
    [new Date(2026, 2, 24, 14).getTime(), "spring", "春日"],
    [new Date(2026, 5, 24, 14).getTime(), "summer", "夏日"],
    [new Date(2026, 8, 24, 14).getTime(), "autumn", "秋日"],
    [new Date(2026, 11, 24, 14).getTime(), "winter", "冬日"],
  ] as const)("adds a present-tense seasonal cue for %s", (at, season, seasonLabel) => {
    expect(quietAtmosphere(2, "growing", "", at)).toMatchObject({ season, seasonLabel });
  });

  it.each([
    [1, "winter"], [2, "winter"], [3, "spring"], [4, "spring"],
    [5, "spring"], [6, "summer"], [7, "summer"], [8, "summer"],
    [9, "autumn"], [10, "autumn"], [11, "autumn"], [12, "winter"],
  ] as const)("uses the local calendar season throughout month %s", (month, season) => {
    for (const day of [1, new Date(2026, month, 0).getDate()]) {
      const at = new Date(2026, month - 1, day, 12).getTime();
      expect(quietAtmosphere(2, "growing", "", at)?.season).toBe(season);
    }
  });

  it("keeps seasonal events suitable for every character and hour", () => {
    const spring = new Set<string>();
    const summer = new Set<string>();
    for (let species = 0; species < 10; species++) {
      const springEvent = quietAtmosphere(species, "baby", "", new Date(2026, 2, 24, 2).getTime())!.event;
      const summerEvent = quietAtmosphere(species, "baby", "", new Date(2026, 5, 24, 2).getTime())!.event;
      spring.add(springEvent); summer.add(summerEvent);
      expect(springEvent).not.toMatch(/耳朵/);
      expect(quietAtmosphere(species, "baby", "", localTime(2))!.event).not.toMatch(/鼻尖/);
      expect(quietAtmosphere(species, "baby", "", localTime(22))!.text).not.toMatch(/脚步/);
      expect(summerEvent).not.toMatch(/阳光/);
    }
    expect(spring.size).toBe(3);
    expect(summer.size).toBe(3);
  });

  it("keeps the small seasonal event stable for the same day without persisting it", () => {
    const at = localTime(14, 24);
    const first = quietAtmosphere(2, "adult", "gentle", at);
    expect(first?.event).toBeTruthy();
    expect(first?.event).toBe(quietAtmosphere(2, "adult", "gentle", at + 4 * 60 * 60 * 1000)?.event);
    expect(first?.season).toBe(quietAtmosphere(2, "adult", "gentle", localTime(14, 25))?.season);
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
