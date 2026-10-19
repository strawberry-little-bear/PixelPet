import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now(), saveGeneration: "a".repeat(32) });
const key = async (key: string) => act(async () => { fireEvent.keyDown(window, { key }); });
const mount = async () => act(async () => { render(<App />); });
const writes = () => api.mock.calls.filter(([p]) => p === "action");
async function selectSleep() { await key("a"); for (let i = 0; i < 3; i++) await key("a"); }
beforeEach(() => {
 vi.useFakeTimers(); localStorage.clear(); api.mockReset();
 saved = { schema: 12, revision: 1, species: 2, name: "睡眠伙伴", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
  lastTick: Date.now(), sleeping: false, growth: emptyGrowth(), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
 api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sleep intent follows the read menu, never a blind toggle", () => {
 it.each([false,true])("guards the actual %s menu selection and leaves portable JSON unchanged", async sleeping => {
  saved.sleeping=sleeping; await mount(); await selectSleep();
  expect(document.querySelector(".care-item.selected")?.textContent).toContain(sleeping?"起床啦":"睡个好觉");
  expect(writes()).toHaveLength(0); await key("b");
  expect(writes()).toHaveLength(1); expect(writes()[0]).toEqual(["action",expect.objectContaining({kind:"sleep"}),"a".repeat(32),sleeping]);
  expect(writes()[0][1]).not.toHaveProperty("expectedSleeping");
 });
 it.each([false,true])("refuses stale %s sleep intent, reads on B and waits for explicit reselection", async sleeping => {
  saved.sleeping=sleeping; await mount(); await selectSleep();
  saved.sleeping=!sleeping; saved.revision++; api.mockRejectedValueOnce(new RequestFailure("sleep changed","rejected","sleep_changed"));
  await key("b"); expect(document.querySelector(".save-recovery")?.textContent).toContain("本次入睡或起床未执行");
  expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 读取存档");
  expect(document.querySelector(".lcd-bottom")?.textContent).not.toContain("A 选择");
  expect(document.querySelector('.care-outcome,.pet-scene[data-motion="waking"]')).toBeNull();
  await key("a"); await key("c"); expect(writes()).toHaveLength(1);
  await key("b"); expect(api.mock.calls.at(-1)?.[0]).toBe("state"); expect(document.querySelector(".content-home")).not.toBeNull();
  expect(writes()).toHaveLength(1); await selectSleep();await key("b");
  expect(writes()).toHaveLength(2); expect(writes()[1][3]).toBe(!sleeping);
 });
 it("keeps a known refusal while its recovery read fails, with no retry or claim", async () => {
  await mount();await selectSleep();api.mockRejectedValueOnce(new RequestFailure("sleep changed","rejected","sleep_changed"));await key("b");
  api.mockRejectedValueOnce(new RequestFailure("offline","unavailable"));await key("b");
  expect(document.querySelector(".save-recovery")?.textContent).toContain("本次入睡或起床未执行");
  expect(writes()).toHaveLength(1); expect(api.mock.calls.filter(([p])=>p==="recap/read")).toHaveLength(0);
  saved.sleeping=true;saved.revision++;await key("b"); expect(writes()).toHaveLength(1);
 });
 it("keeps response loss unknown, never claims a known refusal or retries", async () => {
  await mount();await selectSleep();saved.sleeping=true;saved.revision++;
  api.mockRejectedValueOnce(new RequestFailure("lost","unknown"));await key("b");
  expect(document.querySelector(".save-recovery")?.textContent).toContain("可能已经保存");await key("b");
  expect(writes()).toHaveLength(1);expect(document.querySelector('.care-outcome,.pet-scene[data-motion="waking"]')).toBeNull();
 });
 it("uses a newer authoritative sleep state when the menu remains open", async () => {
  await mount();await selectSleep();saved.sleeping=true;saved.revision++;
  await act(async()=>{vi.advanceTimersByTime(15000)});
  expect(document.querySelector(".care-item.selected")?.textContent).toContain("起床啦");await key("b");expect(writes()[0][3]).toBe(true);
 });
});
