import type { ReactNode } from "react";

// Keep one mounted live region per selection view. Ordinary state reads leave
// its text unchanged; only the choice or its available action is announced.
export function SelectionStatus({ scope, children }: { scope: string; children: ReactNode }) {
  return <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-selection-status={scope}>{children}</p>;
}
