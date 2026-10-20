import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const reply = (message = ""): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function sleep() { for (let i = 0; i < 4; i++) await key("a"); await key("b"); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const now = Date.now();
  saved = { schema: 17, revision: 10, species: 2, name: "慢慢读", createdAt: now - 7200000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 10, clean: 10, energy: 40, mood: 80 }, growth: emptyGrowth() };
  api.mockImplementation(async path => {
    if (path === "action") { saved.sleeping = true; saved.revision++; return reply("晚安，小伙伴。睡着时体力会慢慢恢复。"); }
    return reply();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("puts exactly one successful notice after the device but before the collection", async () => {
  await mount(); await sleep();
  const notice = screen.getByRole("status"), device = document.querySelector(".play-space")!, collection = document.querySelector(".collection")!;
  expect(notice.classList.contains("reading-notice")).toBe(true);
  expect(notice.parentElement?.tagName).toBe("MAIN");
  expect(device.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(notice.compareDocumentPosition(collection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector(".app > .toast,.recovery-notice")).toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,[role=button]")).toBeNull();
  expect(writes()).toHaveLength(1);
});
it("keeps the same announcement through reading navigation, without another write", async () => {
  await mount(); await sleep(); const notice = screen.getByRole("status");
  await key("a"); expect(document.querySelector(".care-menu")).toBeTruthy();
  expect(screen.getByRole("status")).toBe(notice);
  await key("c"); expect(document.querySelector(".sleep-home-guidance")).toBeTruthy();
  expect(screen.getByRole("status")).toBe(notice); expect(writes()).toHaveLength(1);
});
it("expires at the original duration without clearing advice or moving key focus", async () => {
  await mount(); await sleep();
  const button = screen.getByRole("button", { name: "A 选择" }); button.focus();
  await act(async () => { await vi.advanceTimersByTimeAsync(4199); });
  expect(screen.getByRole("status").textContent).toContain("晚安");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByRole("status")).toBeNull();
  expect(document.querySelector(".sleep-home-guidance")?.textContent).toContain("醒来后优先吃点东西");
  expect(document.activeElement).toBe(button); expect(writes()).toHaveLength(1);
});
it("dismisses only the notice, leaving saved care and advice intact", async () => {
  await mount(); await sleep(); const before = structuredClone(saved);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "关闭提示" })); });
  expect(screen.queryByRole("status")).toBeNull();
  expect(document.querySelector(".sleep-home-guidance")).toBeTruthy();
  expect(saved).toEqual(before); expect(writes()).toHaveLength(1);
});
it("does not reserve an empty notice slot before or after successful care", async () => {
  await mount(); expect(document.querySelector(".reading-notice")).toBeNull();
  await sleep(); await act(async () => { await vi.advanceTimersByTimeAsync(4200); });
  expect(document.querySelector(".reading-notice")).toBeNull();
});
it("leaves rejected-action errors in the existing layer and never treats them as success", async () => {
  await mount(); api.mockRejectedValueOnce(new RequestFailure("本次没有执行", "rejected"));
  await sleep();
  expect(document.querySelector(".app > .toast.error")?.textContent).toContain("本次没有执行");
  expect(document.querySelector(".reading-notice,.recovery-notice")).toBeNull(); expect(saved.sleeping).toBe(false);
});
it.each(["snake", "tetris", "fishing", "walk"] as const)("keeps running %s feedback in its old layer and moves paused feedback into flow", async kind => {
  const now = Date.now();
  const common = { id: "1".repeat(32), kind, startedAt: now, round: 0, score: 0, lastBeat: -1 };
  if (kind === "snake") saved.game = { ...common, snake: { body: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], food: { x: 9, y: 9 }, eaten: 0, step: 0, direction: 0, paused: true, lastMoveAt: now } };
  if (kind === "tetris") saved.game = { ...common, tetris: { board: Array<number>(96).fill(0), active: { kind: 3, rotation: 0, x: 2, y: 0 }, next: 1, bag: [4, 5, 6, 7], lines: 0, pieces: 0, step: 0, paused: true, lastFallAt: now } };
  if (kind === "fishing") saved.game = { ...common, fishing: { spot: 0, casts: 0, catches: [], phase: "ready", step: 0, waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: now, paused: true } };
  if (kind === "walk") saved.game = { ...common, walking: { route: Array<"rock">(12).fill("rock"), souvenirs: [], beat: 0, step: 0, cleared: 0, pose: "", poseUntil: 0, lastPulseAt: now, lastInputAt: 0, paused: true } };
  api.mockImplementation(async (path, body) => {
    if (path !== "action") return reply();
    const a = body as { kind: string };
    const g = saved.game!, n = g.snake ?? g.tetris ?? g.fishing ?? g.walking!;
    n.paused = a.kind.endsWith("-pause"); n.step++; saved.revision++;
    return reply(n.paused ? "已经暂停" : "继续陪玩");
  });
  await mount(); await key("c");
  expect(document.querySelector(".device-stage.reading-mode")).toBeNull();
  expect(document.querySelector(".app > .toast")?.textContent).toContain("继续陪玩");
  expect(document.querySelector(".reading-notice")).toBeNull();
  await key("c");
  expect(document.querySelector(".device-stage.reading-mode")).toBeTruthy();
  expect(document.querySelector("main > .reading-notice")?.textContent).toContain("已经暂停");
  expect(document.querySelector(".app > .toast")).toBeNull();
  expect(writes()).toHaveLength(2); expect(saved.careCount).toBe(0);
});
