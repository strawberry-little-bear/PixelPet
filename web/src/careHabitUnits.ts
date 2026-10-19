// Each credited action adds exactly one habit. Replies subtract float
// totals, so fractional legacy saves can yield 0.9999999999999999 (or >1).
// Tolerate arithmetic noise in the response/display, never round saved totals
// or a genuinely fractional credit into a whole action.
export function careHabitUnits(value: unknown): 0 | 1 | null {
  if (value === 0) return 0;
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value - 1) <= 1e-8 ? 1 : null;
}
