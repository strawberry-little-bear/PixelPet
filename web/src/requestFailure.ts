// A lost response cannot tell us whether a mutation committed. Keep this separate
// from api.ts so callers (and API mocks) share the same error classification.
export class RequestFailure extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "unknown" | "unavailable") {
    super(message);
    this.name = "RequestFailure";
  }
}

export const needsReconciliation = (error: unknown) =>
  !(error instanceof RequestFailure && error.outcome === "rejected");
