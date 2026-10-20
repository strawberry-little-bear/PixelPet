// Format validated nonnegative care snapshots/receipts, never stored values.
// Match internal/game/care_diary.go: remove only nanounit-scale floating-point
// dust at decimal half-steps, so a receipt and its durable diary agree.
export function fixedCareAmount(value: number): string {
  return (Math.round(value * 100 + 1e-7) / 100).toFixed(2);
}

export function careAmount(value: number): string {
  const fixed = fixedCareAmount(value);
  return value > 0 && fixed === "0.00" ? "<0.01" : fixed;
}
