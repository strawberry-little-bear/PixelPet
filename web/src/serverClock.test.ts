import { afterEach, expect, it, vi } from "vitest";
import { anchorServerClock, readServerClock } from "./serverClock";

afterEach(() => vi.useRealTimers());
it("uses the supplied response epoch, including a lower epoch on later acceptance", () => {
  expect(readServerClock(anchorServerClock(20000, 30), 45)).toBe(20015);
  expect(readServerClock(anchorServerClock(10000, 50), 65)).toBe(10015);
});
it("does not run backwards when elapsed sampling has not advanced", () => {
  const anchor = anchorServerClock(20000, 30);
  expect(readServerClock(anchor, 30)).toBe(20000);
  expect(readServerClock(anchor, 29)).toBe(20000);
});
it("uses monotonic elapsed time, not a subsequent wall clock change", () => {
  vi.useFakeTimers(); vi.setSystemTime(20000);
  const anchor = anchorServerClock(10000);
  vi.setSystemTime(-600000);
  vi.advanceTimersByTime(100);
  expect(readServerClock(anchor)).toBe(10100);
  vi.setSystemTime(600000);
  vi.advanceTimersByTime(200);
  expect(readServerClock(anchor)).toBe(10300);
});
