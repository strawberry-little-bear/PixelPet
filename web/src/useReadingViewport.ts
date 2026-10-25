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
    const scrollport = (() => {
      for (let element = target.parentElement; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
        if (element === root.current) break;
      }
      return null;
    })();
    let box = target.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Reading-mode LCDs and nested panels scroll independently of the page.
    // Move the nearest scrollport first so the target is not left below a
    // fixed LCD viewport when the outer document is already at its limit.
    if (scrollport) {
      const port = scrollport.getBoundingClientRect();
      const top = port.top + 12, bottom = port.bottom - 12;
      const delta = box.top < top ? box.top - top : box.bottom > bottom ? box.bottom - bottom : 0;
      if (delta) scrollport.scrollTop += delta;
      box = target.getBoundingClientRect();
    }
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    // Normal document flow. Preserve native focus.
    window.scrollBy({ top: box.top - 12, behavior: "instant" });
  }, [root, request, selector, enabled]);
}
