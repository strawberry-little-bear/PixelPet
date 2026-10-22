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
    const container = root.current;
    const target = container?.querySelector<HTMLElement>(selector);
    const dock = container?.closest(".device-stage")?.querySelector<HTMLElement>(".device-buttons");
    if (!container || !target || !dock) return;
    const scrollable = container.scrollHeight > container.clientHeight && container.clientHeight > 0;
    if (scrollable) {
      const viewport = container.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const top = viewport.top + 12;
      const bottom = viewport.bottom - 12;
      if (box.top < top) container.scrollTop += box.top - top;
      else if (box.bottom > bottom) container.scrollTop += box.bottom - bottom;
    }
    const box = target.getBoundingClientRect(), controls = dock.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (box.top >= 12 && box.bottom <= Math.min(window.innerHeight, controls.top) - 12) return;
    // Keep native button focus. A scrollable LCD consumes only its own reading
    // position; the outer document moves only when the target or key dock is
    // outside the viewport.
    window.scrollBy({ top: box.top - 12, behavior: "instant" });
  }, [root, request, sessionKey, enabled]);
}
