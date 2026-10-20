import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const reply = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path));
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const now = Date.now();
  saved = { schema: 17, revision: 2, species: 2, name: "恢复阅读", createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0,
    growth: emptyGrowth("baby"), needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, logs: [] };
  api.mockImplementation(async () => reply());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const cases = ["offline", "clock", "corrupt", "uncommitted", "committed", "save_changed", "sleep_changed", "game_finished"] as const;
it.each(cases)("keeps %s details in document flow before the device, without changing recovery", async kind => {
  let failed = true;
  const initial = ["offline", "clock", "corrupt"].includes(kind);
  const failure = () => kind === "clock" ? new RequestFailure("时钟夹具", "rejected", "clock_ahead")
    : kind === "corrupt" ? new RequestFailure("坏档夹具", "rejected", "save_corrupt")
    : kind === "save_changed" || kind === "sleep_changed" || kind === "game_finished" ? new RequestFailure("冲突夹具", "rejected", kind)
    : new RequestFailure("连接夹具", kind === "offline" ? "unavailable" : "unknown");
  api.mockImplementation(async path => {
    if (failed && (initial || path === "action" || path === "state")) {
      if (path === "action" && kind === "committed") { saved.careCount++; saved.revision++; }
      throw failure();
    }
    return reply();
  });
  await mount();
  if (!initial) { await key("a"); await key("b"); }
  expect(document.querySelector(".save-recovery")).not.toBeNull();
  const notice = screen.getByRole("alert");
  expect(notice.closest("main")).not.toBeNull();
  expect(notice.classList.contains("recovery-notice")).toBe(true);
  expect(notice.compareDocumentPosition(document.querySelector(".device-stage")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector(".app > .toast")).toBeNull();
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  const count = writes().length, calls = api.mock.calls.length;
  await key("a"); await key("c"); expect(writes()).toHaveLength(count);
  expect(api.mock.calls).toHaveLength(calls);
  await key("b"); expect(document.querySelector(".save-recovery")).not.toBeNull();
  expect(api.mock.calls.at(-1)?.[0]).toBe(kind === "offline" ? "visit" : "state");
  failed = false; await key("b");
  expect(document.querySelector(".save-recovery,.recovery-notice")).toBeNull();
  expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
  expect(writes()).toHaveLength(count);
  expect(saved.careCount).toBe(kind === "committed" ? 1 : 0);
});

it("dismissing the external notice does not unlock an unknown write or retry it", async () => {
  await mount();
  api.mockRejectedValue(new RequestFailure("回复未确认", "unknown"));
  await key("a"); await key("b");
  expect(document.querySelector("main .recovery-notice")).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "关闭提示" })); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector(".save-recovery")).not.toBeNull();
  expect(screen.getByRole("button", { name: "A 选择" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "C 返回" })).toHaveProperty("disabled", true);
  await key("a"); await key("c"); expect(writes()).toHaveLength(1);
});

it("leaves ordinary rejected-action notices outside the main reading flow", async () => {
  await mount();
  api.mockRejectedValue(new RequestFailure("本次照顾未执行", "rejected"));
  await key("a"); await key("b");
  expect(document.querySelector(".save-recovery,.recovery-notice")).toBeNull();
  expect(screen.getByRole("alert").closest("main")).toBeNull();
  expect(document.querySelector(".app > .toast.error")?.textContent).toContain("本次照顾未执行");
  expect(writes()).toHaveLength(1);
});
