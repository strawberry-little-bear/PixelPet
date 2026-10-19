import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { ReturnPanel } from "./ReturnPanel";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result, ReturnRecap } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap | undefined;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", returnRecap: structuredClone(recap), recapPending: false });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function review() { await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b"); }
const panel = () => screen.getByLabelText("回访小结");
const mode = () => document.querySelector(".device-stage.return-mode");
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); const now = Date.now();
  saved = { schema: 12, revision: 10, species: 2, name: "稳稳阅读", createdAt: now - 7200000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, careCount: 0, logs: [], growth: emptyGrowth(), needs: { hunger: 30, mood: 80, clean: 20, energy: 50 } };
  const snapshot = { needs: { ...saved.needs }, stage: "baby" as const, form: "" as const, points: 10, rest: 0, trackedHours: 1 };
  recap = { id: "one", from: now - 3600000, to: now, before: snapshot, after: { ...snapshot, points: 11, trackedHours: 2 } };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("page changes replace the native scroll target and transfer reading focus", () => {
  const view = render(<ReturnPanel recap={recap!} page={0} pet={saved} />); const section = panel();
  expect(section.getAttribute("tabindex")).toBe("0"); section.focus(); section.scrollTop = 200;
  view.rerender(<ReturnPanel recap={recap!} page={1} pet={saved} />);
  expect(panel()).not.toBe(section); expect(panel().scrollTop).toBe(0); expect(document.activeElement).toBe(panel());
  panel().scrollTop = 500; view.rerender(<ReturnPanel recap={recap!} page={0} pet={saved} />); expect(panel().scrollTop).toBe(0); expect(document.activeElement).toBe(panel());
});
it("new record IDs reset scrolling, ordinary same-ID snapshots preserve reading", () => {
  const view = render(<ReturnPanel recap={recap!} page={0} pet={saved} />); const section = panel(); section.scrollTop = 200;
  view.rerender(<ReturnPanel recap={structuredClone(recap!)} page={0} pet={{ ...saved, sleeping: true }} />); expect(panel()).toBe(section); expect(section.scrollTop).toBe(200);
  view.rerender(<ReturnPanel recap={{ ...recap!, id: "two" }} page={0} pet={saved} />); expect(panel()).not.toBe(section); expect(panel().scrollTop).toBe(0);
});
it("replacement respects physical-key focus and restores reading focus with preventScroll", () => {
  const view = render(<><button>A</button><ReturnPanel recap={recap!} page={0} pet={saved} /></>);
  const button = screen.getByRole("button"); button.focus();
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  view.rerender(<><button>A</button><ReturnPanel recap={{ ...recap!, id: "two" }} page={1} pet={saved} /></>);
  expect(document.activeElement).toBe(button); expect(focus).not.toHaveBeenCalled();
  panel().focus(); focus.mockClear();
  view.rerender(<><button>A</button><ReturnPanel recap={recap!} page={0} pet={saved} /></>);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(document.activeElement).toBe(panel());
  focus.mockRestore();
});
it("only an effective return page opts in; A/B/C navigation stays unchanged", async () => {
  await mount(); expect(mode()).toBeNull(); await review(); expect(mode()).not.toBeNull();
  panel().scrollTop = 200; panel().focus(); await key("a"); expect(panel().scrollTop).toBe(0); expect(panel().textContent).toContain("现在怎么照顾");
  expect(mode()).not.toBeNull(); await key("a"); expect(panel().textContent).toContain("离开了");
  await key("b"); expect(panel().textContent).toContain("现在怎么照顾"); await key("b"); expect(mode()).toBeNull();
  await review(); await key("c"); expect(mode()).toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
});
it.each(["offline", "corrupt", "clock"])("%s recovery never inherits bounded return layout", async failure => {
  await mount(); await review(); expect(mode()).not.toBeNull();
  api.mockRejectedValueOnce(failure === "offline" ? new Error("offline") : new RequestFailure("unavailable", "rejected", failure === "clock" ? "clock_ahead" : "save_corrupt"));
  await sync(); expect(mode()).toBeNull(); expect(document.querySelector(".save-recovery")).not.toBeNull(); expect(document.querySelector(".return-panel")).toBeNull();
  await key("b"); expect(document.querySelector(".save-recovery")).toBeNull();
});
it("same-record polling preserves scroll, replacement resets page and scroll, missing recap exits", async () => {
  await mount(); await review(); await key("a"); const section = panel(); section.scrollTop = 500;
  saved.revision++; await sync(); expect(panel().scrollTop).toBe(500);
  recap = { ...recap!, id: "two" }; saved.revision++; await sync(); expect(panel().scrollTop).toBe(0); expect(panel().querySelector("header span")?.textContent).toBe("1 / 2");
  recap = undefined; await sync(); expect(mode()).toBeNull(); expect(document.querySelector(".return-panel")).toBeNull();
  expect(api.mock.calls.some(([path]) => ["action", "import", "reset", "recap/read"].includes(path))).toBe(false);
});
