import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), server = Date.parse("2026-10-21T12:00:00Z");
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: server, message: "" });
const reacting = () => !!document.querySelector(".star-game .rig-motion-celebrating.expression-content");
const writes = () => api.mock.calls.filter(([path]) => path === "action");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function catchReply(hit = true) {
  saved.game!.round++; saved.game!.lastBeat++;
  if (hit) saved.game!.score++;
  saved.revision++;
  return { ...result(), message: hit ? "接住了！★" : "差一点！再试一次。" };
}
async function catchStar() { api.mockImplementationOnce(async () => catchReply()); await key("b"); }
async function interrupt(reason: string, returning = false) {
  await act(async () => {
    if (reason === "hidden") {
      Object.defineProperty(document, "hidden", { configurable: true, value: !returning });
      fireEvent(document, new Event("visibilitychange"));
    } else if (reason === "blur") { returning ? fireEvent.focus(window) : fireEvent.blur(window); }
    else fireEvent.click(screen.getByRole("button", { name: reason === "help" ? (returning ? "关闭" : "玩法说明") : "存档盒" }));
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(server); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  saved = { schema: 17, revision: 10, species: 2, name: "接星伙伴", createdAt: server - 3600000,
    hatchedAt: server - 3600000, lastTick: server, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(),
    game: { id: "stars-reaction", startedAt: server - 1350, round: 1, score: 1, lastBeat: 0 } };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("reacts to the acknowledged catch, not the pending press, then returns to idle", async () => {
  await mount(); let release!: (r: Result) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await key("b"); await key("b"); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ kind: "catch", lane: 1, gameId: "stars-reaction" });
  await act(async () => release(catchReply())); expect(reacting()).toBe(true);
  expect(screen.getByText("已接住 2 颗")).toBeTruthy();
  await clock(899); expect(reacting()).toBe(true);
  await clock(1); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
});
it("does not replay saved catches on mount, polling, or reload", async () => {
  await mount(); expect(reacting()).toBe(false);
  saved.game!.round++; saved.game!.score++; saved.game!.lastBeat++; saved.revision++;
  await clock(60000); expect(reacting()).toBe(false);
  cleanup(); await mount(); expect(reacting()).toBe(false); expect(writes()).toHaveLength(0);
});
it("does not celebrate a miss or rejected catch", async () => {
  await mount(); api.mockImplementationOnce(async () => catchReply(false)); await key("b");
  expect(reacting()).toBe(false); expect(document.querySelector(".game-message")?.textContent).toBe("差一点！再试一次。");
  api.mockRejectedValueOnce(new RequestFailure("等下一颗星星落下再接哦", "rejected")); await key("b");
  expect(reacting()).toBe(false); expect(writes()).toHaveLength(2);
});
it("does not celebrate an uncertain save even after confirming the saved catch", async () => {
  await mount(); api.mockImplementationOnce(async () => { catchReply(); throw new RequestFailure("lost", "unknown"); });
  await key("b"); expect(reacting()).toBe(false); expect(document.querySelector(".save-recovery")).toBeTruthy();
  await key("b"); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
});
it("does not celebrate a response older than two seconds", async () => {
  await mount(); let release!: (r: Result) => void;
  const mono = vi.spyOn(performance, "now").mockReturnValue(0);
  api.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await key("b");
  mono.mockReturnValue(2001); await act(async () => release(catchReply()));
  expect(reacting()).toBe(false); expect(screen.getByText("已接住 2 颗")).toBeTruthy();
});
it.each(["hidden", "blur", "help", "tools"])("%s stops the reaction without replaying", async reason => {
  await mount(); await catchStar(); expect(reacting()).toBe(true);
  await interrupt(reason); expect(reacting()).toBe(false);
  await interrupt(reason, true); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
});
it.each(["hidden", "blur", "help", "tools"])("%s during a catch suppresses the late acknowledged reaction", async reason => {
  await mount(); let release!: (r: Result) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await key("b");
  await interrupt(reason); await interrupt(reason, true);
  await act(async () => release(catchReply()));
  expect(reacting()).toBe(false); expect(screen.getByText("已接住 2 颗")).toBeTruthy();
  expect(writes()).toHaveLength(1);
});
it("moving cancels the reaction and returning to that lane cannot replay it", async () => {
  await mount(); await catchStar(); expect(reacting()).toBe(true);
  for (let i = 0; i < 3; i++) { await key("a"); expect(reacting()).toBe(false); }
  expect(writes()).toHaveLength(1);
});
it("abandon confirmation clears the reaction, cancellation does not replay", async () => {
  await mount(); await catchStar(); expect(reacting()).toBe(true); await key("c");
  expect(document.querySelector(".game-abandon")).toBeTruthy();
  await key("a"); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
});
it("a final catch uses the existing home celebration only", async () => {
  saved.game!.round = 4; saved.game!.score = 3;
  await mount(); api.mockImplementationOnce(async () => { saved.game = undefined; saved.revision++; return result(); });
  await key("b"); expect(document.querySelector(".star-game")).toBeNull();
  expect(document.querySelector('.pet-scene[data-motion="celebrating"]')).toBeTruthy(); expect(writes()).toHaveLength(1);
});
it("the next confirmed catch gets its own full timer, not the previous timer", async () => {
  await mount(); await catchStar(); await clock(500); await key("a");
  await catchStar(); expect(reacting()).toBe(true);
  await clock(400); expect(reacting()).toBe(true);
  await clock(500); expect(reacting()).toBe(false); expect(writes()).toHaveLength(2);
});
it("an acknowledged changed session is not this catch's celebration", async () => {
  await mount(); api.mockImplementationOnce(async () => {
    const r = catchReply(); r.state.game!.id = "remote-game"; return r;
  });
  await key("b"); expect(reacting()).toBe(false); expect(writes()).toHaveLength(1);
});
