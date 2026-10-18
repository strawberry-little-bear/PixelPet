// A lost response cannot tell us whether a mutation committed. Keep this separate
// from api.ts so callers (and API mocks) share the same error classification.
export class RequestFailure extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "unknown" | "unavailable", public readonly code?: "save_corrupt" | "clock_ahead" | "save_changed" | "game_finished", public readonly saveGeneration?: string) {
    super(message);
    this.name = "RequestFailure";
  }
}

export const needsReconciliation = (error: unknown) =>
  !(error instanceof RequestFailure && error.outcome === "rejected");

export const isSaveCorrupt = (error: unknown) =>
  error instanceof RequestFailure && error.code === "save_corrupt";

export const isClockAhead = (error: unknown) =>
  error instanceof RequestFailure && error.code === "clock_ahead";

export const isSaveChanged = (error: unknown) =>
  error instanceof RequestFailure && error.code === "save_changed";

export const isGameFinished = (error: unknown) =>
  error instanceof RequestFailure && error.code === "game_finished";

export const failureGeneration = (error: unknown) =>
  error instanceof RequestFailure ? error.saveGeneration : undefined;

export const validSaveGeneration = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
