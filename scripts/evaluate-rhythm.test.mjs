import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalDelta, withinWindow, evaluate } from "./evaluate-rhythm.mjs";

const fixture = { roundTripMs: 800, renderMs: 200, responseMs: 600 };
test("RTT is counted once, not twice or as a one-way delay", () => {
  assert.equal(arrivalDelta(fixture), 1600);
  assert.equal(arrivalDelta({ ...fixture, roundTripMs: 0 }), 800);
});
test("each leg's additional jitter is counted independently", () => {
  assert.equal(arrivalDelta({ ...fixture, downJitterMs: 100, upJitterMs: 300 }), 2000);
  assert.equal(arrivalDelta({ ...fixture, downJitterMs: 300, upJitterMs: 100 }), 2000);
});
test("inclusive boundaries do not accidentally drop exact edge cases", () => {
  for (const delta of [-250, 0, 1800]) assert.equal(withinWindow(delta, 250, 1800), true);
  for (const delta of [-250.01, 1800.01]) assert.equal(withinWindow(delta, 250, 1800), false);
});
test("invalid inputs cannot silently produce a misleading report", () => {
  for (const value of [-1, NaN, Infinity, undefined, "800"]) {
    assert.throws(() => arrivalDelta({ ...fixture, roundTripMs: value }), RangeError);
  }
  assert.throws(() => arrivalDelta({ ...fixture, roundTripMs: Number.MAX_VALUE, renderMs: Number.MAX_VALUE }), RangeError);
  assert.throws(() => withinWindow(Infinity, 250, 1800), RangeError);
  assert.throws(() => withinWindow(0, -1, 1800), RangeError);
  assert.throws(() => withinWindow(0, 250, NaN), RangeError);
});
test("the full deterministic grid preserves both nominal and stress failures", () => {
  const report = evaluate();
  assert.deepEqual(evaluate(), report);
  assert.equal(report.cases, 432);
  assert.equal(report.rows.length, 8);
  for (const r of report.rows) {
    assert.equal(r.cases, r.mode === "nominal" ? 12 : 96);
    assert.ok(r.narrowAccepted <= r.broadAccepted && r.broadAccepted <= r.cases);
    assert.ok(r.minDeltaMs <= r.maxDeltaMs);
  }
  const nominal = report.rows.find(r => r.roundTripMs === 800 && r.mode === "nominal");
  assert.equal(nominal.narrowAccepted, 0);
  assert.equal(nominal.broadAccepted, 12);
  const stress = report.rows.find(r => r.roundTripMs === 800 && r.mode === "extra-jitter");
  assert.equal(stress.maxDeltaMs, 2200);
  assert.ok(stress.broadAccepted < stress.cases, "Do not hide broad-window failures to claim fairness");
});
test("large rendering stalls fail the arithmetic instead of being called safe", () => {
  const delta = arrivalDelta({ ...fixture, renderMs: 5000 });
  assert.equal(withinWindow(delta, 250, 1800), false);
});
