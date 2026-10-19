import type { RefObject } from "react";
import { useReadingViewport } from "./useReadingViewport";

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
  useReadingViewport(root, request, request?.target === "guide"
    ? ".game-guide > header" : ".fishing-pause,.walk-pause,.tetris-overlay",
    !blocked && !!sessionKey && request?.sessionKey === sessionKey &&
    page === (request?.target === "guide" ? "pause-guide" : "game"));
}
