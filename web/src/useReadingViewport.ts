import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/** Consume explicit navigation once, even if recovery interrupts its target. */
export function useReadingViewport(
  root: RefObject<HTMLElement | null>,
  request: object | null,
  selector: string,
  enabled: boolean,
) {
  const consumed = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!request || consumed.current === request) return;
    // Never queue a jump to replay after a poll, replacement or foregrounding.
    consumed.current = request;
    if (!enabled || document.hidden) return;
    const target = root.current?.querySelector<HTMLElement>(selector);
    if (!target) return;
    const box = target.getBoundingClientRect();
    if (!box.width || !box.height || (box.top >= 0 && box.bottom <= window.innerHeight)) return;
    // Normal document flow, not an inner scroll box. Preserve native focus.
    window.scrollBy({ top: box.top - 12, behavior: "instant" });
  }, [root, request, selector, enabled]);
}
