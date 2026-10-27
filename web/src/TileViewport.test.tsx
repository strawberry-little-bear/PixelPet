import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTileViewport, type TileDestination } from "./useTileViewport";
type Props = { request: TileDestination | null; sessionKey?: string | null; enabled?: boolean; target?: boolean };
function View({ request, sessionKey = "one", enabled = true, target = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useTileViewport(root, request, sessionKey, enabled);
  return <div className="device-stage"><div ref={root} className="lcd-content">{target && <><svg className="tile-board"/><div className="tile-status"/><p className="tile-message"/></>}</div><div className="device-buttons"/></div>;
}
const destination = (target: TileDestination["target"] = "selection"): TileDestination => ({ sessionKey: "one", target });
let messageTop: number, top: number, gridTop: number, height: number, width: number, scrollTop: number;
beforeEach(() => {
  messageTop = -290; top = -400; gridTop = -550; height = 100; width = 200; scrollTop = 0;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    if (this.matches(".lcd-content")) return { top: 0, bottom: 300, width: 300, height: 300, left: 0, right: 300, x: 0, y: 0, toJSON: () => ({}) };
    const y = this.matches(".tile-board") ? gridTop : this.matches(".tile-message") ? messageTop : top;
    return { top: y, bottom: y + height, width, height, left: 0, right: width, x: 0, y, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function scrollContainer(view: ReturnType<typeof render>) {
  const root = view.container.querySelector<HTMLElement>(".lcd-content")!;
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => { scrollTop = Math.max(0, Number(top)); });
  Object.defineProperty(root, "scrollTop", { configurable: true, get: () => scrollTop, set: value => { scrollTop = Number(value); } });
  Object.defineProperty(root, "scrollTo", { configurable: true, value: scrollTo });
  return { root, scrollTo };
}
it("reveals the board and current/selected feedback together when they fit without moving focus", () => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  const view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination()}/>);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: "instant" });
  expect(document.activeElement).toBe(button); button.remove();
});
it("prioritizes readable feedback when the board and feedback cannot fit together", () => {
  gridTop = -1200;
  const view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination()}/>);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: "instant" });
});
it("accounts for the LCD viewport rather than the page or physical keys", () => {
  top = 550; gridTop = 400;
  const view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination()}/>);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 362, behavior: "instant" });
});
it("preserves manual reading on snapshots; only a new explicit request reveals again", () => {
  const request = destination(), view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={request}/>); expect(scrollTo).toHaveBeenCalledTimes(1);
  view.rerender(<View request={request}/>); expect(scrollTo).toHaveBeenCalledTimes(1);
  view.rerender(<View request={destination()}/>); expect(scrollTo).toHaveBeenCalledTimes(2);
});
it.each([{enabled:false}, {sessionKey:"two"}, {sessionKey:null}, {target:false}])("consumes blocked or obsolete requests without replay: %j", props => {
  const request = destination(), view = render(<View request={request} {...props}/>);
  expect(window.scrollBy).not.toHaveBeenCalled();
  view.rerender(<View request={request}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("does not replay a request made in the background on foregrounding", () => {
  Object.defineProperty(document, "hidden", { configurable:true, value:true });
  const request = destination(), view = render(<View request={request}/>);
  Object.defineProperty(document, "hidden", { configurable:true, value:false });
  view.rerender(<View request={request}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each([{top:150,gridTop:50,height:100,width:200},{top:-400,gridTop:-550,height:0,width:200},{top:-400,gridTop:-550,height:100,width:0}])("leaves visible or unlaid-out content alone: %j", box => {
  ({top,gridTop,height,width}=box); const view = render(<View request={null}/>); const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination()}/>); expect(scrollTo).not.toHaveBeenCalled();
});
it("does not jump on initial restoration without an explicit action", () => {
  render(<View request={null}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});

it("B/C reveal the operation message rather than leaving it behind the key dock", () => {
  gridTop = -600; top = -200; messageTop = 500;
  const view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination("feedback")}/>);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 312, behavior: "instant" });
});
it("B/C keep the selected description with the message when both fit", () => {
  gridTop = -1200; top = -400; messageTop = -290;
  const view = render(<View request={null}/>);
  const { scrollTo } = scrollContainer(view);
  view.rerender(<View request={destination("feedback")}/>);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: "instant" });
});
