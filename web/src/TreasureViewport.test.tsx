import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTreasureViewport, type TreasureDestination } from "./useTreasureViewport";

type Props = { request: TreasureDestination | null; sessionKey?: string | null; enabled?: boolean; target?: boolean };
function View({request, sessionKey = "one", enabled = true, target = true}: Props) {
  const root = useRef<HTMLDivElement>(null);
  useTreasureViewport(root, request, sessionKey, enabled);
  return <div className="device-stage"><div ref={root} className="lcd-content">{target && <><div className="treasure-grid"><span aria-selected="true"/></div><p className="treasure-result"/><p className="treasure-status"/></>}</div><div className="device-buttons"/></div>;
}
const destination = (target: TreasureDestination["target"] = "selection"): TreasureDestination => ({sessionKey:"one", target});
let top: number, height: number, width: number, dockTop: number, containerTop: number, rootScrollHeight: number, rootClientHeight: number;
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeEach(() => {
  top = -400; height = 100; width = 200; dockTop = 600; containerTop = 100; rootScrollHeight = 0; rootClientHeight = 0;
  Object.defineProperty(document, "hidden", {configurable:true,value:false});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.matches(".device-buttons")) {
      const y = dockTop;
      return {top:y,bottom:y+height,width,height,left:0,right:width,x:0,y,toJSON:()=>({})};
    }
    if (this.matches(".lcd-content")) {
      const y = containerTop;
      return {top:y,bottom:y+rootClientHeight,width,height:rootClientHeight,left:0,right:width,x:0,y,toJSON:()=>({})};
    }
    const scrollTop = this.closest(".lcd-content")?.scrollTop ?? 0;
    const y = top - scrollTop;
    return {top:y,bottom:y+height,width,height,left:0,right:width,x:0,y,toJSON:()=>({})};
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() {
    return this.matches(".lcd-content") ? rootScrollHeight : 0;
  }});
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() {
    return this.matches(".lcd-content") ? rootClientHeight : 0;
  }});
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});
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
it("uses the LCD scroll position for a tall treasure panel before moving the document", () => {
  rootScrollHeight = 800; rootClientHeight = 300; top = 350; height = 80; dockTop = 600;
  render(<View request={destination()}/>);
  expect(document.querySelector(".lcd-content")?.scrollTop).toBe(42);
  expect(window.scrollBy).not.toHaveBeenCalled();
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
