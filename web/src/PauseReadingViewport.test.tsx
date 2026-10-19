import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePauseReadingViewport, type PauseReadingDestination } from "./usePauseReadingViewport";

type Props = { request: PauseReadingDestination | null; sessionKey?: string | null; page?: string; blocked?: boolean; target?: boolean };
function Reader({ request, sessionKey = "one", page = "pause-guide", blocked = false, target = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  usePauseReadingViewport(root, request, sessionKey, page, blocked);
  return <div ref={root}>{target && <section className="game-guide"><header>本局玩法</header></section>}</div>;
}
const destination = (): PauseReadingDestination => ({ sessionKey: "one", target: "guide" });
let top: number, height: number, width: number;
beforeEach(() => {
  top = -500; height = 80; width = 200;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("scrolls above-screen reading to a small margin without focus or smooth motion", () => {
  const focus = document.createElement("button"); document.body.append(focus); focus.focus();
  render(<Reader request={destination()} />);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -512, behavior: "instant" });
  expect(document.activeElement).toBe(focus); focus.remove();
});
it("also brings a below-screen heading into view", () => {
  top = 900; render(<Reader request={destination()} />);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 888, behavior: "instant" });
});
it("does not scroll on a snapshot/rerender, but a new explicit request can scroll again", () => {
  const request = destination(), view = render(<Reader request={request} />);
  view.rerender(<Reader request={request} />); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  view.rerender(<Reader request={destination()} />); expect(window.scrollBy).toHaveBeenCalledTimes(2);
});
it.each([
  { sessionKey: "two" }, { sessionKey: null }, { page: "game" }, { blocked: true }, { target: false },
])("discards an interrupted request without replay on recovery: %j", state => {
  const request = destination(), view = render(<Reader request={request} {...state} />);
  expect(window.scrollBy).not.toHaveBeenCalled();
  view.rerender(<Reader request={request} />); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("hidden navigation is consumed, not deferred until foreground", () => {
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  const request = destination(), view = render(<Reader request={request} />);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  view.rerender(<Reader request={request} />); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each([{ top: 40, height: 80, width: 200 }, { top: 0, height: 0, width: 200 }, { top: -500, height: 80, width: 0 }])(
  "leaves visible or unlaid-out content alone: %j", box => {
    ({ top, height, width } = box); render(<Reader request={destination()} />); expect(window.scrollBy).not.toHaveBeenCalled();
  },
);
it("no request means no initial-load or unrelated-reader jump", () => {
  render(<Reader request={null} />); expect(window.scrollBy).not.toHaveBeenCalled();
});
