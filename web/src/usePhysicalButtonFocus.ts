import { useLayoutEffect, useRef } from "react";

/** Recover only the focus the browser dropped when a native key was disabled.
 * Never remove native disabled semantics, queue input, or override a new focus. */
export function usePhysicalButtonFocus(scope: string, blocked: boolean) {
  const policy = useRef({ scope, blocked });
  policy.current = { scope, blocked };
  const pending = useRef<{ button: HTMLButtonElement; scope: string } | null>(null);
  useLayoutEffect(() => {
    const cancel = () => { pending.current = null; };
    const lost = (event: FocusEvent) => {
      const button = event.target;
      if (button instanceof HTMLButtonElement && button.matches(".physical-button") &&
        button.disabled && !event.relatedTarget && !policy.current.blocked &&
        !document.hidden && document.hasFocus()) {
        pending.current = { button, scope: policy.current.scope };
      } else cancel();
    };
    const tab = (event: KeyboardEvent) => { if (event.key === "Tab") cancel(); };
    const left = (event: Event) => { if (event.target === event.currentTarget) cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener("focusout", lost, true);
    document.addEventListener("focusin", cancel, true);
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", tab, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", left);
    return () => {
      cancel();
      document.removeEventListener("focusout", lost, true);
      document.removeEventListener("focusin", cancel, true);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", tab, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", left);
    };
  }, []);
  // Capture the native blur rather than guessing focus before a DOM update;
  // Chrome may deliver it during the update or the next rendering pass.
  // Keep the request through additional disabled renders (e.g. a care animation),
  // but consume/cancel it before focusing, so no later render can replay it.
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (blocked || request.scope !== scope || !request.button.isConnected ||
      document.hidden || !document.hasFocus() || document.activeElement !== document.body) {
      pending.current = null;
      return;
    }
    if (request.button.disabled) return;
    pending.current = null;
    request.button.focus({ preventScroll: true });
  });
}
