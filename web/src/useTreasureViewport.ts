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
    const selection = container.querySelector<HTMLElement>(".treasure-selection");
    const scrollable = container.scrollHeight > container.clientHeight && container.clientHeight > 0;
    if (scrollable) {
      const viewport = container.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const top = viewport.top + 12;
      const bottom = viewport.bottom - 12 - (selection?.getBoundingClientRect().height ?? 0);
      if (box.top < top) container.scrollTop += box.top - top;
      else if (box.bottom > bottom) container.scrollTop += box.bottom - bottom;
      // On short screens, bring the feedback closer to the keys within the LCD
      // before moving the page. Otherwise revealing the keys can hide the target.
      const visible = target.getBoundingClientRect();
      const missing = dock.getBoundingClientRect().bottom - visible.top - (window.innerHeight - 24);
      if (missing > 0) container.scrollTop -= Math.min(container.scrollTop, missing, Math.max(0, bottom - visible.bottom));
    }
    const box = target.getBoundingClientRect(), controls = dock.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Choose the smallest document movement that reveals both the feedback and
    // the entire key dock, including the lower B key. Keep native button focus.
    const readout = selection?.getBoundingClientRect();
    const lower = Math.max(box.bottom, controls.bottom, readout?.bottom ?? -Infinity) - window.innerHeight + 12;
    const upper = Math.min(box.top, controls.top, readout?.top ?? Infinity) - 12;
    const movement = lower <= upper ? Math.max(lower, Math.min(0, upper)) : box.top - 12;
    if (movement) window.scrollBy({ top: movement, behavior: "instant" });
  }, [root, request, sessionKey, enabled]);
}
