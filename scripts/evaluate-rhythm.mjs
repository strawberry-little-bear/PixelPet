// Offline design arithmetic only. Not imported by the game, not a score validator.
// No network, timers, filesystem, database, or player input is used.
import { pathToFileURL } from "node:url";

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
  return value;
}

// Candidate: the client begins its visual preview after receiving/rendering a cue.
// Both endpoints use the same preview duration. Relative to the server target,
// input arrives RTT + extra leg jitter + render delay + assumed response delay late.
export function arrivalDelta({ roundTripMs, downJitterMs = 0, upJitterMs = 0, renderMs, responseMs }) {
  const delta = Object.entries({ roundTripMs, downJitterMs, upJitterMs, renderMs, responseMs })
    .reduce((sum, [name, value]) => sum + nonnegative(value, name), 0);
  return nonnegative(delta, "summed delta");
}

export function withinWindow(deltaMs, earlyMs, lateMs) {
  if (!Number.isFinite(deltaMs)) throw new RangeError("deltaMs must be finite");
  nonnegative(earlyMs, "earlyMs"); nonnegative(lateMs, "lateMs");
  return deltaMs >= -earlyMs && deltaMs <= lateMs;
}

export function evaluate() {
  const narrow = { earlyMs: 250, lateMs: 250 };
  const broad = { earlyMs: 250, lateMs: 1800 };
  const rows = [];
  for (const roundTripMs of [0, 100, 300, 800]) {
    for (const mode of ["nominal", "extra-jitter"]) {
      const cases = [];
      for (const downJitterMs of [0, 100, 300]) for (const upJitterMs of [0, 100, 300]) {
        if ((downJitterMs === 0 && upJitterMs === 0) !== (mode === "nominal")) continue;
        for (const renderMs of [16, 67, 200]) for (const responseMs of [80, 200, 400, 600]) {
          const delta = arrivalDelta({ roundTripMs, downJitterMs, upJitterMs, renderMs, responseMs });
          cases.push({ delta, narrow: withinWindow(delta, narrow.earlyMs, narrow.lateMs), broad: withinWindow(delta, broad.earlyMs, broad.lateMs) });
        }
      }
      rows.push({ roundTripMs, mode, cases: cases.length,
        minDeltaMs: Math.min(...cases.map(c => c.delta)), maxDeltaMs: Math.max(...cases.map(c => c.delta)),
        narrowAccepted: cases.filter(c => c.narrow).length, broadAccepted: cases.filter(c => c.broad).length });
    }
  }
  return {
    scope: "Synthetic timing assumptions, not measured users/network, not gameplay validation",
    unit: "milliseconds; roundTripMs is RTT, not one-way delay",
    model: "Client starts an equal preview after cue receipt/render; no clock alignment or RTT compensation",
    assumptions: { roundTripMs: [0, 100, 300, 800], extraJitterPerLegMs: [0, 100, 300], renderMs: [16, 67, 200], responseMs: [80, 200, 400, 600] },
    candidates: { narrow, broad }, cases: rows.reduce((sum, r) => sum + r.cases, 0), rows,
    warning: "Grid counts are not user success rates. Broad still rejects some stress cases; real input, latency, pause, anatomy and feedback remain unverified. No game parameters are changed.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(evaluate(), null, 2));
}
