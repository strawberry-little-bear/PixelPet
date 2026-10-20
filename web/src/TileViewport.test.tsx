import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTileViewport, type TileDestination } from "./useTileViewport";
type Props = { request: TileDestination | null; sessionKey?: string | null; enabled?: boolean; target?: boolean };
function View({ request, sessionKey = "one", enabled = true, target = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useTileViewport(root, request, sessionKey, enabled);
  return <div className="device-stage"><div ref={root}>{target && <><svg className="tile-board"/><div className="tile-status"/><p className="tile-message"/></>}</div><div className="device-buttons"/></div>;
}
const destination = (target: TileDestination["target"] = "selection"): TileDestination => ({ sessionKey: "one", target });
let messageTop: number, top: number, gridTop: number, height: number, width: number, dockTop: number;
beforeEach(() => {
  messageTop = -290; top = -400; gridTop = -550; height = 100; width = 200; dockTop = 600;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const y = this.matches(".device-buttons") ? dockTop : this.matches(".tile-board") ? gridTop : this.matches(".tile-message") ? messageTop : top;
    return { top: y, bottom: y+height, width, height, left: 0, right: width, x: 0, y, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("reveals the board and current/selected feedback together when they fit without moving focus", () => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  render(<View request={destination()}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -562, behavior: "instant" });
  expect(document.activeElement).toBe(button); button.remove();
});
it("prioritizes readable feedback when the board and feedback cannot fit together", () => {
  gridTop = -1200;
  render(<View request={destination()}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -412, behavior: "instant" });
});
it("accounts for the sticky physical keys rather than just viewport bounds", () => {
  top = 550; gridTop = 400;
  render(<View request={destination()}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 388, behavior: "instant" });
});
it("preserves manual reading on snapshots; only a new explicit request reveals again", () => {
  const request = destination(), view = render(<View request={request}/>);
  view.rerender(<View request={request}/>); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  view.rerender(<View request={destination()}/>); expect(window.scrollBy).toHaveBeenCalledTimes(2);
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
it.each([{top:200,gridTop:50,height:100,width:200},{top:-400,gridTop:-550,height:0,width:200},{top:-400,gridTop:-550,height:100,width:0}])("leaves visible or unlaid-out content alone: %j", box => {
  ({top,gridTop,height,width}=box); render(<View request={destination()}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("does not jump on initial restoration without an explicit action", () => {
  render(<View request={null}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});

it("B/C reveal the operation message rather than leaving it behind the key dock", () => {
  gridTop = -600; top = -200; messageTop = 500;
  render(<View request={destination("feedback")}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:488,behavior:"instant"});
});
it("B/C keep the selected description with the message when both fit", () => {
  gridTop = -1200; top = -400; messageTop = -290;
  render(<View request={destination("feedback")}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:-412,behavior:"instant"});
});
