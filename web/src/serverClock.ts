// A response supplies the epoch; performance.now supplies elapsed time between
// responses. Never derive gameplay time from later wall-clock adjustments.
export type ServerClockAnchor = { serverTime: number; measuredAt: number };
export function anchorServerClock(serverTime: number, measuredAt = performance.now()): ServerClockAnchor {
  return { serverTime, measuredAt };
}
export function readServerClock(anchor: ServerClockAnchor, measuredAt = performance.now()): number {
  return anchor.serverTime + Math.max(0, measuredAt - anchor.measuredAt);
}
