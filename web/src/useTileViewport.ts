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
    const viewport = root.current;
    if (!viewport || !status || !board || !message) return;
    const viewportBox = viewport.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect(), grid = board.getBoundingClientRect();
    const box = request.target === "feedback" ? message.getBoundingClientRect() : statusBox;
    if (!box.width || !box.height || !viewportBox.width || !viewportBox.height) return;
    // Keep the board with the selected/feedback text when they fit. The tile
    // board now lives in the fixed LCD viewport, so only that native scroll
    // container moves; the page and physical key dock stay put.
    const top = box.bottom - grid.top <= viewportBox.height - 24 ? grid.top
      : box.bottom - statusBox.top <= viewportBox.height - 24 ? statusBox.top : box.top;
    const currentTop = viewportBox.top + 12;
    const currentBottom = viewportBox.bottom - 12;
    const delta = top < currentTop ? top - currentTop : box.bottom > currentBottom ? box.bottom - currentBottom : 0;
    if (!delta) return;
    viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + delta), behavior: "instant" });
  }, [root, request, sessionKey, enabled]);
}
