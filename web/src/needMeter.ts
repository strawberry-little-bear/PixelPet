// Shared semantics for the two read-only presentations of accepted needs.
// Preserve the exact bar value, but explain the rounded visible number to AT.
// No live region or focus target: background heartbeats must not steal reading.
export const needMeterDescriptionId = "need-reading-description";
export function needMeterAttributes(label: string, value: number) {
  return {
    role: "meter",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": value,
    "aria-valuetext": `${Number.isInteger(value) ? "" : "约 "}${Math.round(value)} / 100`,
    "aria-describedby": needMeterDescriptionId,
  };
}
