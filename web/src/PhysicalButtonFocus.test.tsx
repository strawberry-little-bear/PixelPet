import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePhysicalButtonFocus } from "./usePhysicalButtonFocus";
type Props = { disabled?: boolean; blocked?: boolean; scope?: string; show?: boolean };
function View({ disabled = false, blocked = false, scope = "pet/session", show = true }: Props) {
  usePhysicalButtonFocus(scope, blocked);
  return <>{show && <button className="physical-button" disabled={disabled}>B</button>}<button className="other">Tools</button></>;
}
beforeEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(strict = false) {
  const wrap = (props: Props) => strict ? <StrictMode><View {...props}/></StrictMode> : <View {...props}/>;
  const view = render(wrap({}));
  const button = view.container.querySelector<HTMLButtonElement>(".physical-button")!;
  button.focus();
  const update = (props: Props) => view.rerender(wrap(props));
  const lost = () => {
    // jsdom does NOT implement Chrome's native disabled-button blur; model that
    // observed event explicitly. check-physical-focus.mjs covers real behavior.
    act(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute("tabindex"); fireEvent.focusOut(button, { relatedTarget: null }); });
  };
  const wait = () => { update({ disabled: true }); lost(); expect(document.activeElement).toBe(document.body); };
  return { ...view, button, update, lost, wait };
}
it.each([false, true])("recovers exactly once after native disable/re-enable (StrictMode %s)", strict => {
  const f = fixture(strict); f.wait();
  const focus = vi.spyOn(f.button, "focus"); f.update({});
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(document.activeElement).toBe(f.button);
  f.button.blur(); f.update({}); expect(focus).toHaveBeenCalledTimes(1);
});
it("waits through multiple disabled renders without trying to focus disabled keys", () => {
  const f = fixture(); f.wait(); const focus = vi.spyOn(f.button, "focus");
  f.update({ disabled: true }); f.update({ disabled: true }); expect(focus).not.toHaveBeenCalled();
  f.update({}); expect(document.activeElement).toBe(f.button);
});
it("never restores a normal intentional blur", () => {
  const f = fixture(); f.button.blur(); f.update({}); expect(document.activeElement).toBe(document.body);
});
it.each(["tab", "shift-tab", "pointer", "focus", "blur", "hidden"])('cancels on %s, even if focus returns to body before the reply', reason => {
  const f = fixture(); f.wait();
  act(() => {
    if (reason.includes("tab")) fireEvent.keyDown(document.body, { key: "Tab", shiftKey: reason === "shift-tab" });
    if (reason === "pointer") fireEvent.pointerDown(document.body);
    if (reason === "focus") { (f.container.querySelector(".other") as HTMLButtonElement).focus(); (document.activeElement as HTMLElement).blur(); }
    if (reason === "blur") { fireEvent(window, new Event("blur")); fireEvent(window, new Event("focus")); }
    if (reason === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: true }); fireEvent(document, new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, value: false }); fireEvent(document, new Event("visibilitychange"));
    }
  });
  f.update({}); expect(document.activeElement).toBe(document.body);
});
it.each([{ blocked: true }, { scope: "new-pet" }, { show: false }])("discards obsolete context without replay after returning: %j", props => {
  const f = fixture(); f.wait(); f.update({ disabled: true, ...props }); f.update({});
  expect(document.activeElement).toBe(document.body);
});
it("does not override the focus on an available C key", () => {
  const f = fixture(); f.wait(); const other = f.container.querySelector<HTMLButtonElement>(".other")!;
  other.focus(); f.update({}); expect(document.activeElement).toBe(other);
});
it("does not capture focus loss while recovery or a modal is already active", () => {
  const f = fixture(); f.update({ disabled: true, blocked: true }); f.lost(); f.update({});
  expect(document.activeElement).toBe(document.body);
});
it("does not refocus in the background even if no visibility event was delivered", () => {
  const f = fixture(); f.wait(); vi.mocked(document.hasFocus).mockReturnValue(false); f.update({});
  vi.mocked(document.hasFocus).mockReturnValue(true); f.update({}); expect(document.activeElement).toBe(document.body);
});
it("removes capture listeners on unmount", () => {
  const f = fixture(); f.wait(); const focus = vi.spyOn(f.button, "focus"); f.unmount();
  fireEvent.focusOut(f.button); fireEvent(window, new Event("focus")); expect(focus).not.toHaveBeenCalled();
});
