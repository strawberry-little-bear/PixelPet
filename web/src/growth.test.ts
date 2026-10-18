import { describe, expect, it } from "vitest";
import { emptyGrowth, growthProgress, stagePoints, tendency } from "./growth";
import type { AdultForm, Growth } from "./types";

describe("growth handbook rules", () => {
  it.each([
    ["baby", 0, 0, 24, 0],
    ["baby", 12, 12, 24, 50],
    ["growing", 24, 0, 48, 0],
    ["growing", 36, 12, 48, 25],
    ["adult", 72, 72, 72, 100],
  ] as const)("shows %s stage progress at %s points", (stage, points, current, target, percent) => {
    const g = { ...emptyGrowth(stage), points };
    expect(stagePoints(g)).toEqual({ points: current, target });
    expect(growthProgress(g)).toBe(percent);
  });

  it.each([
    [0, 0, 0, "balanced"],
    [2, 0, 0, "lively"],
    [0, 2, 2, "gentle"],
    [3, 2, 2, "balanced"], // Exactly 1.5x is not a dominant habit.
    [2, 3, 3, "balanced"],
    [1, 0, 0, "balanced"], // A single game cannot determine the form.
  ] as const)("matches habit tendency for play=%s, clean=%s, rest=%s", (play, clean, rest, form) => {
    const g = emptyGrowth();
    Object.assign(g.care, { play, clean, rest });
    expect(tendency(g)).toBe(form);
  });

  it("requires enough history and below-45% comfort for easygoing", () => {
    const g = emptyGrowth();
    g.trackedHours = 11;
    g.wellbeing = 1.1;
    expect(tendency(g)).toBe("balanced");
    g.trackedHours = 12;
    g.wellbeing = 1.2;
    expect(tendency(g)).toBe("easygoing");
    g.wellbeing = 12 * .45;
    expect(tendency(g)).toBe("balanced");
  });

  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("never replaces a saved %s adult form with a new tendency", form => {
    const g: Growth = { ...emptyGrowth("adult"), points: 72, form, trackedHours: 12, wellbeing: 0 };
    g.care.play = 100;
    expect(tendency(g)).toBe(form);
  });
});
