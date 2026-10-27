import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTreasureViewport, type TreasureDestination } from "./useTreasureViewport";

type Props = { request: TreasureDestination | null; sessionKey?: string | null; enabled?: boolean; target?: boolean; selection?: boolean };
function View({request, sessionKey = "one", enabled = true, target = true, selection = false}: Props) {
  const root = useRef<HTMLDivElement>(null);
  useTreasureViewport(root, request, sessionKey, enabled);
  return <div className="device-stage"><div ref={root} className="lcd-content">{target && <><div className="treasure-grid"><span aria-selected="true"/></div><p className="treasure-result"/><p className={`treasure-status${selection ? " treasure-selection" : ""}`}/></>}</div><div className="device-buttons"/></div>;
}
const destination = (target: TreasureDestination["target"] = "selection"): TreasureDestination => ({sessionKey:"one", target});
let top: number, height: number, width: number, dockTop: number, containerTop: number, rootScrollHeight: number, rootClientHeight: number, selectionOffset: number;
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeEach(() => {
  top = -400; height = 100; width = 200; dockTop = 600; containerTop = 100; rootScrollHeight = 0; rootClientHeight = 0; selectionOffset = 0;
  Object.defineProperty(document, "hidden", {configurable:true,value:false});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.matches(".treasure-selection")) {
      const y = containerTop + rootClientHeight - 60 + selectionOffset - (this.closest(".lcd-content")?.scrollTop ?? 0);
      return {top:y,bottom:y+60,width,height:60,left:0,right:width,x:0,y,toJSON:()=>({})};
    }
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
it("reveals the entire key dock even when the feedback is already visible", () => {
  top=308; height=75; dockTop=700;
  render(<View request={destination("result")}/>);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:19,behavior:"instant"});
});
it("moves feedback lower inside the LCD when a short viewport cannot fit it with the keys", () => {
  rootScrollHeight=900; rootClientHeight=380; top=250; height=60; dockTop=520;
  const view=render(<View request={null}/>);
  const lcd=view.container.querySelector<HTMLElement>(".lcd-content")!;
  lcd.scrollTop=130;
  vi.spyOn(window,"innerHeight","get").mockReturnValue(380);
  view.rerender(<View request={destination()}/>);
  expect(lcd.scrollTop).toBe(26);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({top:212,behavior:"instant"});
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

it("reserves the selection readout before revealing a cell in the LCD", () => {
  rootScrollHeight=900; rootClientHeight=300; top=350; height=80; dockTop=600;
  render(<View request={destination()} selection/>);
  expect(document.querySelector(".lcd-content")?.scrollTop).toBe(102);
  expect(window.scrollBy).not.toHaveBeenCalled();
});
it("keeps the selected cell inside the LCD when the readout cannot fully fit", () => {
  rootScrollHeight = 900; rootClientHeight = 300; top = 150; height = 80; dockTop = 500; selectionOffset = 50;
  render(<View request={destination()} selection/>);
  expect(document.querySelector(".lcd-content")?.scrollTop).toBe(38);
});
it("does not let the selection readout undo result positioning", () => {
  rootScrollHeight = 900; rootClientHeight = 300; top = 350; height = 80; dockTop = 600;
  render(<View request={destination("result")} selection/>);
  expect(document.querySelector(".lcd-content")?.scrollTop).toBe(102);
});
