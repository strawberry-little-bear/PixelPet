import { describe, expect, it } from "vitest";
import { careHabitUnits } from "./careHabitUnits";

describe("response-only care habit units", () => {
  it.each([0, -0])("preserves zero credit %s", value => expect(careHabitUnits(value)).toBe(0));
  it.each([1, 1.4 - .4, 2.2 - 1.2, (999999.4 + 1) - 999999.4, 1 - 1e-9, 1 + 1e-9])(
    "tolerates whole-credit subtraction noise %s", value => expect(careHabitUnits(value)).toBe(1));
  it.each([undefined, null, "1", {}, [], NaN, Infinity, -Infinity, -1, .5, 2, 1e-12, 1 - 1e-7, 1 + 1e-7])(
    "does not coerce invalid/fractional credit %s", value => expect(careHabitUnits(value)).toBeNull());
});
