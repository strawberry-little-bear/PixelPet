import { useLayoutEffect, useRef, type RefObject } from "react";

export type TreasureDestination = { sessionKey: string; target: "selection" | "result" | "done" };

/** Explicit A/B/continue feedback only. Polls and interrupted replies cannot replay it. */
export function useTreasureViewport(root: RefObject<HTMLElement | null>, request: TreasureDestination | null,
  sessionKey: string | null, enabled: boolean) {
  const consumed = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!request || consumed.current === request) return;
    consumed.current = request;
    if (!enabled || request.sessionKey !== sessionKey || document.hidden) return;
    const selector = request.target === "selection" ? '.treasure-grid [aria-selected="true"]'
      : request.target === "result" ? ".treasure-result" : ".treasure-status";
    const target = root.current?.querySelector<HTMLElement>(selector);
    const dock = root.current?.closest(".device-stage")?.querySelector<HTMLElement>(".device-buttons");
    if (!target || !dock) return;
    const box = target.getBoundingClientRect(), controls = dock.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (box.top >= 12 && box.bottom <= Math.min(window.innerHeight, controls.top) - 12) return;
    // Retain native button focus; no animation, focus transfer or inner scroll box.
    window.scrollBy({ top: box.top - 12, behavior: "instant" });
  }, [root, request, sessionKey, enabled]);
}
