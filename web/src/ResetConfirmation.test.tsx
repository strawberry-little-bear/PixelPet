import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, broken: boolean, generation: string;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", saveGeneration: generation });
const resets = () => api.mock.calls.filter(([path]) => path === "reset");
const confirm = () => screen.getByRole<HTMLButtonElement>("button", { name: "确认重新开始" });
const input = () => screen.getByRole<HTMLInputElement>("textbox", { name: "重新开始确认文字" });
async function click(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }
async function open() { await click(/存档盒/); await click("重新开始"); }
async function mount() { await act(async () => { render(<App />); }); await open(); }
async function type(text: string) { await act(async () => { fireEvent.change(input(), { target: { value: text } }); }); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); broken = false; generation = "a".repeat(32);
  saved = { schema: 11, revision: 1, species: 2, name: "ABC伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async path => {
    if (path === "reset") { broken = false; saved.hatchedAt = 0; saved.growth = emptyGrowth("egg"); saved.revision++; }
    if (broken) throw new RequestFailure("invalid save", "rejected", "save_corrupt");
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("requires the exact current companion name before replacing a hatched pet", async () => {
  await mount(); const before = structuredClone(saved);
  expect(confirm().disabled).toBe(true); await click("确认重新开始");
  await type("ABC"); expect(confirm().disabled).toBe(true);
  await type("abc伙伴"); expect(confirm().disabled).toBe(true);
  expect(saved).toEqual(before); expect(resets()).toHaveLength(0);
  await type(" ABC伙伴 "); expect(confirm().disabled).toBe(false);
  await click("确认重新开始"); expect(resets()).toHaveLength(1);
  expect(document.querySelector(".content-choose")).toBeTruthy();
  expect(document.querySelector(".modal")).toBeNull();
});
it.each(["egg", "corrupt"])("uses explicit restart words for %s without a readable companion name", async kind => {
  if (kind === "egg") { saved.hatchedAt = 0; saved.growth = emptyGrowth("egg"); } else broken = true;
  await mount(); await type("ABC伙伴"); expect(confirm().disabled).toBe(true);
  await type("重新开始"); expect(confirm().disabled).toBe(false);
  await click("确认重新开始"); expect(resets()).toHaveLength(1);
});
it("treats A/B/C and Enter as text input, while Escape cancels and restores physical focus", async () => {
  await mount(); input().focus();
  for (const key of ["a", "b", "c", "C", "Enter"]) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => { input().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(document.querySelector(".modal")).toBeTruthy(); expect(resets()).toHaveLength(0);
  await type("ABC伙伴"); expect(confirm().disabled).toBe(false);
  fireEvent.keyDown(input(), { key: "Escape", isComposing: true });
  expect(document.querySelector(".modal")).toBeTruthy();
  await act(async () => { fireEvent.keyDown(input(), { key: "Escape" }); });
  expect(document.querySelector(".modal")).toBeNull();
  expect(document.activeElement).toBe(document.querySelector(".physical-button.button-c"));
  expect(resets()).toHaveLength(0);
});
it("clears old confirmation on cancellation and requires it again after reopening", async () => {
  await mount(); await type("ABC伙伴"); await click("关闭"); await open();
  expect(input().value).toBe(""); expect(confirm().disabled).toBe(true); expect(resets()).toHaveLength(0);
});
it("keeps the text field inside the modal Tab cycle when destructive confirmation is disabled", async () => {
  await mount(); input().focus();
  const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => { input().dispatchEvent(forward); });
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" }));
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true }); });
  expect(document.activeElement).toBe(input());
});
it("invalidates typed consent when another page replaces even the same pet save", async () => {
  await mount(); await type("ABC伙伴"); generation = "b".repeat(32); saved.revision = 0;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".modal")).toBeNull(); await open();
  expect(input().value).toBe(""); expect(confirm().disabled).toBe(true); expect(resets()).toHaveLength(0);
});
