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
function ScrollReader({ request }: Pick<Props, "request">) {
  const root = useRef<HTMLDivElement>(null);
  usePauseReadingViewport(root, request, "one", "pause-guide", false);
  return <div className="scroll-root" ref={root} style={{ overflowY: "auto" }}><section className="game-guide"><header>本局玩法</header></section></div>;
}
const destination = (): PauseReadingDestination => ({ sessionKey: "one", target: "guide" });
let top: number, height: number, width: number, scrollRoot: HTMLElement | null;
beforeEach(() => {
  top = -500; height = 80; width = 200; scrollRoot = null;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains("scroll-root")) return { top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100, x: 0, y: 100, toJSON: () => ({}) };
    if (scrollRoot && this.matches(".game-guide > header")) {
      const y = 250 - scrollRoot.scrollTop;
      return { top: y, bottom: y + 80, left: 0, right: width, width, height: 80, x: 0, y, toJSON: () => ({}) };
    }
    return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) };
  });
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
it("scrolls an LCD reading port before the outer document", () => {
  const view = render(<ScrollReader request={null} />);
  const root = document.querySelector<HTMLElement>(".scroll-root")!;
  scrollRoot = root;
  Object.defineProperties(root, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
  view.rerender(<ScrollReader request={destination()} />);
  expect(root.scrollTop).toBe(142);
  expect(window.scrollBy).not.toHaveBeenCalled();
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
