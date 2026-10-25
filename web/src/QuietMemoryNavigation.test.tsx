import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.UTC(2026, 9, 25, 8);
let saved: PetState;
const source = () => document.querySelector(".quiet-memory-source")?.textContent;
const reply = () => document.querySelector(".quiet-moment-copy > p")?.textContent;
const hint = () => document.querySelector(".lcd-bottom > span")?.textContent;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { saved.revision++; await act(async () => { window.dispatchEvent(new Event("focus")); }); }
async function open() {
  await act(async () => { render(<App />); });
  await key("a"); for (let n = 0; n < 12; n++) await key("a");
  await key("b"); await key("a"); await key("a");
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 23, revision: 1, species: 2, name: "记得陪伴", createdAt: at - 3600000, hatchedAt: at - 3600000,
    lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, energy: 80, clean: 80 }, careCount: 0, logs: [],
    album: { since: at - 3600000, legacy: false, entries: [
      { kind: "meal", at: at - 1000, source: "shared" },
      { kind: "bath", at: at - 2000, source: "shared" },
      { kind: "walk", at: at - 3000, source: "shared" },
    ] } };
  api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), serverTime: at, message: "" }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("browses both directions, wraps, then returns to company without saving an interaction", async () => {
  const before = structuredClone(saved); await open();
  expect(hint()).toContain("B 聊聊回忆");
  await key("b"); expect(source()).toContain("小饭团");
  expect(hint()).toBe("A 上一段　 B 下一段　 C 返回陪伴");
  expect(document.querySelector(".quiet-memory-position")?.textContent).toContain("1 / 3");
  await key("b"); expect(source()).toContain("泡泡");
  await key("a"); expect(source()).toContain("小饭团");
  await key("a"); expect(source()).toContain("小路");
  await key("b"); expect(source()).toContain("小饭团");
  await key("c"); expect(source()).toBeUndefined();
  expect(document.querySelector(".quiet-moment")).not.toBeNull();
  expect(hint()).toContain("B 聊聊回忆");
  await key("a"); expect(document.querySelector(".quiet-moment-copy > strong")?.textContent).toBe("摸摸它");
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(saved).toEqual(before);
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});
it("handles one memory in either direction and an empty ordinary greeting", async () => {
  saved.album!.entries = saved.album!.entries.slice(0, 1); await open(); await key("b");
  const first = source(); await key("a"); expect(source()).toBe(first);
  await key("b"); expect(source()).toBe(first);
  expect(document.querySelector(".quiet-memory-position")?.textContent).toContain("1 / 1");
  await key("c"); saved.album!.entries = []; await sync(); await key("b");
  expect(reply()).toContain("你好呀"); expect(hint()).toContain("A 换回应");
  await key("a"); expect(document.querySelector(".quiet-moment-copy > strong")?.textContent).toBe("摸摸它");
});
it("retains the selected identity on sync and navigates the updated saved order only on a key press", async () => {
  await open(); await key("b"); await key("b"); const selected = source();
  saved.album!.entries.push({ kind: "rested", at, source: "shared" }); await sync();
  expect(source()).toBe(selected);
  expect(document.querySelector(".quiet-memory-position")?.textContent).toContain("3 / 4");
  await key("a"); expect(source()).toContain("小饭团");
  await key("a"); expect(source()).toContain("伸展");
  await key("b"); expect(source()).toContain("小饭团");
});
it("explains a removed selection without substituting a different story or leaving the browser trapped", async () => {
  await open(); await key("b"); saved.album!.entries.shift(); await sync();
  expect(source()).toBeUndefined(); expect(reply()).toContain("已不在当前读取的记录里");
  expect(hint()).toContain("A 上一段");
  await key("a"); expect(source()).toContain("小路");
  saved.album!.entries = []; await sync();
  expect(reply()).toContain("当前没有可聊起的回忆");
  await key("b"); await key("a"); expect(source()).toBeUndefined();
  expect(reply()).toContain("当前没有可聊起的回忆");
  await key("c"); expect(document.querySelector(".quiet-moment")).not.toBeNull();
  expect(document.querySelector(".quiet-memory-navigation")).toBeNull();
  await key("c"); expect(document.querySelector(".home-caption")).not.toBeNull();
});
it("clears the conversation on sleep sync and refresh instead of restoring an old browsing intent", async () => {
  await open(); await key("b"); saved.sleeping = true; await sync();
  expect(source()).toBeUndefined(); expect(reply()).toContain("回忆等醒来再聊");
  expect(hint()).toContain("B 安静陪着"); await key("b"); expect(reply()).toContain("甜甜地睡着");
  saved.sleeping = false; await sync(); expect(hint()).toContain("B 聊聊回忆");
  await key("b"); expect(source()).toContain("小饭团");
  cleanup(); await act(async () => { render(<App />); });
  expect(document.querySelector(".home-caption")).not.toBeNull();
  expect(source()).toBeUndefined();
  expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
});
