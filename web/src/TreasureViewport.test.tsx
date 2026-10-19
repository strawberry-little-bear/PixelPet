import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTreasureViewport, type TreasureDestination } from "./useTreasureViewport";

type Props = { request: TreasureDestination | null; sessionKey?: string | null; enabled?: boolean; target?: boolean };
function View({request, sessionKey = "one", enabled = true, target = true}: Props) {
  const root = useRef<HTMLDivElement>(null);
  useTreasureViewport(root, request, sessionKey, enabled);
  return <div className="device-stage"><div ref={root}>{target && <><div className="treasure-grid"><span aria-selected="true"/></div><p className="treasure-result"/><p className="treasure-status"/></>}</div><div className="device-buttons"/></div>;
}
const destination = (target: TreasureDestination["target"] = "selection"): TreasureDestination => ({sessionKey:"one", target});
let top: number, height: number, width: number, dockTop: number;
beforeEach(() => {
  top = -400; height = 100; width = 200; dockTop = 600;
  Object.defineProperty(document, "hidden", {configurable:true,value:false});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const y = this.matches(".device-buttons") ? dockTop : top;
    return {top:y,bottom:y+height,width,height,left:0,right:width,x:0,y,toJSON:()=>({})};
  });
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it.each(["selection","result","done"] as const)("reveals explicit %s without focus transfer or animation", target => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  render(<View request={destination(target)}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:-412,behavior:"instant"});
  expect(document.activeElement).toBe(button); button.remove();
});
it("a target inside the viewport but covered by the key dock also needs revealing", () => {
  top=550; render(<View request={destination()}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:538,behavior:"instant"});
});
it("preserves document reading on snapshots; a new explicit request can reveal again", () => {
  const request=destination(), view=render(<View request={request}/>);
  view.rerender(<View request={request}/>); expect(window.scrollBy).toHaveBeenCalledTimes(1);
  view.rerender(<View request={destination()}/>); expect(window.scrollBy).toHaveBeenCalledTimes(2);
});
it.each([{enabled:false},{sessionKey:"two"},{sessionKey:null},{target:false}])("consumes a blocked/missing target rather than replaying on recovery: %j", props => {
  const request=destination(), view=render(<View request={request} {...props}/>);
  expect(window.scrollBy).not.toHaveBeenCalled();
  view.rerender(<View request={request}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("foregrounding does not replay hidden navigation", () => {
  Object.defineProperty(document,"hidden",{configurable:true,value:true});
  const request=destination(), view=render(<View request={request}/>);
  Object.defineProperty(document,"hidden",{configurable:true,value:false});
  view.rerender(<View request={request}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it.each([{top:12,height:100,width:200},{top:-400,height:0,width:200},{top:-400,height:100,width:0}])("leaves already visible/unlaid-out content alone: %j", box => {
  ({top,height,width}=box); render(<View request={destination()}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
it("no initial request means no automatic reading jump", () => {
  render(<View request={null}/>); expect(window.scrollBy).not.toHaveBeenCalled();
});
