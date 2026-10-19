import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export type PauseReadingDestination = {
  sessionKey: string | null;
  target: "guide" | "pause";
};

/** A one-shot, explicit navigation request; never a heartbeat/focus effect. */
export function usePauseReadingViewport(
  root: RefObject<HTMLElement | null>,
  request: PauseReadingDestination | null,
  sessionKey: string | null,
  page: string,
  blocked: boolean,
) {
  const consumed = useRef<PauseReadingDestination | null>(null);
  useLayoutEffect(() => {
    if (!request || consumed.current === request) return;
    // Discard, rather than queue, a request interrupted by recovery/background
    // or a new session. Restoring visibility must not jump later on its own.
    consumed.current = request;
    if (blocked || document.hidden || !sessionKey || request.sessionKey !== sessionKey ||
      page !== (request.target === "guide" ? "pause-guide" : "game")) return;
    const target = root.current?.querySelector<HTMLElement>(request.target === "guide"
      ? ".game-guide > header" : ".fishing-pause,.walk-pause,.tetris-overlay");
    if (!target) return;
    const box = target.getBoundingClientRect();
    if (!box.width || !box.height || (box.top >= 0 && box.bottom <= window.innerHeight)) return;
    // These reading pages use normal document flow, not an inner scroll box.
    // Keep native focus/three-key activation and avoid animated travel.
    window.scrollBy({ top: box.top - 12, behavior: "instant" });
  }, [root, request, sessionKey, page, blocked]);
}
