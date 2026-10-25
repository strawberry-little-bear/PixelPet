// Measurement-only envelope; never imported by the rhythm client or protocol.
// Conditional on locally consistent elapsed clock rates: the server timestamp
// was taken between request send and receipt. RTT does not identify either leg.
export function targetOffsetBounds({ sentMs, receivedMs, serverMs, eventMs, targetMs, clockUncertain = false }) {
  for (const value of [sentMs, receivedMs, serverMs, eventMs, targetMs]) {
    if (!Number.isFinite(value)) throw new RangeError('Timing observations must be finite numbers.');
  }
  if (receivedMs < sentMs || eventMs < receivedMs) throw new RangeError('Timing observations must preserve local order.');
  if (typeof clockUncertain !== 'boolean') throw new TypeError('Clock uncertainty must be explicit.');
  if (clockUncertain) return { available: false, reason: 'clock-discontinuity' };
  const minMs = eventMs - receivedMs + (serverMs - targetMs);
  const maxMs = eventMs - sentMs + (serverMs - targetMs);
  const widthMs = receivedMs - sentMs;
  if (![minMs, maxMs, widthMs].every(Number.isFinite)) throw new RangeError('Timing envelope overflow.');
  return { available: true, minMs, maxMs, widthMs,
    position: minMs > 0 ? 'after-target' : maxMs < 0 ? 'before-target' : 'includes-target' };
}
