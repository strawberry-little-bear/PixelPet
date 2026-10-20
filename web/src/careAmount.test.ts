import { expect, it } from "vitest";
import { careAmount, fixedCareAmount } from "./careAmount";

// The same edge cases are exercised by TestDiaryAmountOnlyFormatsWithoutHidingTinyGains
// and TestWakeDiaryRoundsHalfStepsWithoutSettlementPartitionDust in Go.
it.each([
  [0, "0.00"], [1e-12, "<0.01"], [.004, "<0.01"], [.00499999, "<0.01"],
  [.005 - Number.EPSILON, "0.01"], [.005, "0.01"], [.25, "0.25"],
  [.03499999999999659, "0.04"], [.035, "0.04"], [.03500000000000341, "0.04"],
  [1.005, "1.01"], [7.034999999999997, "7.04"],
  [14.325 - 1e-12, "14.33"], [14.325, "14.33"], [14.325 + 1e-12, "14.33"],
  [14.32499999, "14.32"], [14.32500001, "14.33"], [72, "72.00"], [100, "100.00"],
])("formats actual care amount %s as %s without mutating it", (n, expected) => {
  const original = n;
  expect(careAmount(n as number)).toBe(expected);
  expect(n).toBe(original);
});

it("keeps before/after need readings fixed-width while preserving tiny positive gains", () => {
  expect(fixedCareAmount(.001)).toBe("0.00");
  expect(careAmount(.001)).toBe("<0.01");
  expect(fixedCareAmount(60.035)).toBe("60.04");
});
