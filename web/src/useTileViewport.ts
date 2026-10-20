import { useLayoutEffect, useRef, type RefObject } from "react";

export type TileDestination = { sessionKey: string; target: "selection" | "feedback" };

/** One explicit three-key action, not a snapshot-driven scroll or focus move. */
export function useTileViewport(root: RefObject<HTMLElement | null>, request: TileDestination | null,
  sessionKey: string | null, enabled: boolean) {
  const consumed = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!request || consumed.current === request) return;
    consumed.current = request;
    if (!enabled || request.sessionKey !== sessionKey || document.hidden) return;
    const status = root.current?.querySelector<HTMLElement>(".tile-status");
    const board = root.current?.querySelector<SVGElement>(".tile-board");
    const message = root.current?.querySelector<HTMLElement>(".tile-message");
    const dock = root.current?.closest(".device-stage")?.querySelector<HTMLElement>(".device-buttons");
    if (!status || !board || !message || !dock) return;
    const statusBox = status.getBoundingClientRect(), grid = board.getBoundingClientRect();
    const box = request.target === "feedback" ? message.getBoundingClientRect() : statusBox;
    const bottom = Math.min(window.innerHeight, dock.getBoundingClientRect().top) - 12;
    if (!box.width || !box.height) return;
    // Keep the board and selection with feedback when they fit. On a short
    // screen, B/C prioritize the operation result, while A prioritizes the
    // current/selected description. The rest remains in native document flow.
    const top = box.bottom - grid.top <= bottom - 12 ? grid.top
      : box.bottom - statusBox.top <= bottom - 12 ? statusBox.top : box.top;
    if (top >= 12 && box.bottom <= bottom) return;
    window.scrollBy({ top: top - 12, behavior: "instant" });
  }, [root, request, sessionKey, enabled]);
}
