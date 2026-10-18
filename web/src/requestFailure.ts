// A lost response cannot tell us whether a mutation committed. Keep this separate
// from api.ts so callers (and API mocks) share the same error classification.
export class RequestFailure extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "unknown" | "unavailable", public readonly code?: "save_corrupt") {
    super(message);
    this.name = "RequestFailure";
  }
}

export const needsReconciliation = (error: unknown) =>
  !(error instanceof RequestFailure && error.outcome === "rejected");

export const isSaveCorrupt = (error: unknown) =>
  error instanceof RequestFailure && error.code === "save_corrupt";
