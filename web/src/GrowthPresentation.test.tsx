import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { clipDurations } from "./motion";
import type { PetState, Result, ReturnRecap } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, recap: ReturnRecap, pending: boolean;
let reply: (r: Result) => void;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: "a".repeat(32), serverTime: Date.now(), message: "", returnRecap: structuredClone(recap), recapPending: pending });
const claims = () => api.mock.calls.filter(([path]) => path === "recap/read");
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset"].includes(path));
const celebrating = () => document.querySelector(".content-home .motion-celebrating");
const returning = () => document.querySelector(".return-panel");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function grow(stage: "growing" | "adult") {
  saved.revision++;
  saved.growth = { ...emptyGrowth(stage), points: stage === "adult" ? 72 : 24, form: stage === "adult" ? "lively" : "" };
}
async function complete() {
  pending = false;
  await act(async () => { reply({ ...result(), recapClaimed: true }); });
}
async function review() { await key("a"); for (let i = 0; i < 7; i++) await key("a"); await key("b"); }

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); pending = true;
  saved = { schema: 11, revision: 10, species: 2, name: "长大衔接", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000,
    lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"), needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
  recap = { id: "growth-during-return", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot };
  api.mockImplementation(async path => path === "recap/read" ? new Promise<Result>(resolve => { reply = resolve; }) : result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("growth and return presentation order", () => {
  it.each(["growing", "adult"] as const)("shows %s before an already accepted recap, then returns without another write", async stage => {
    await mount(); grow(stage); await complete();
    expect(celebrating()).toBeTruthy(); expect(returning()).toBeNull();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("长大啦");
    await tick(clipDurations.evolve - 1); expect(celebrating()).toBeTruthy(); expect(returning()).toBeNull();
    await tick(1); expect(returning()).toBeTruthy();
    expect(document.querySelector(".return-panel header span")?.textContent).toBe("1 / 2");
    await key("b"); await key("b"); await tick(15000);
    expect(celebrating()).toBeNull(); expect(returning()).toBeNull();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it.each(["growing", "adult"] as const)("C skips the %s animation, not the saved growth or queued recap", async stage => {
    await mount(); grow(stage); await complete(); expect(celebrating()).toBeTruthy();
    await key("c"); expect(returning()).toBeTruthy(); expect(saved.growth?.stage).toBe(stage);
    await key("c"); await tick(15000); expect(celebrating()).toBeNull(); expect(returning()).toBeNull();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it.each(["help", "tools"] as const)("does not consume queued growth behind %s, and does not revive canceled automatic recap", async panel => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: panel === "help" ? "玩法说明" : /存档盒/ }));
    grow("growing"); await complete();
    expect(celebrating()).toBeNull(); expect(returning()).toBeNull(); await tick(5000);
    fireEvent.click(screen.getByRole("button", { name: panel === "help" ? /^关闭$/ : /存档盒/ }));
    expect(celebrating()).toBeTruthy(); await tick(clipDurations.evolve);
    expect(returning()).toBeNull(); await review(); expect(returning()).toBeTruthy();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it("does not start growth in the background and keeps the acknowledged recap manually available", async () => {
    await mount(); const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    grow("adult"); await complete(); expect(celebrating()).toBeNull(); await tick(5000);
    hidden.mockReturnValue(false); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(celebrating()).toBeTruthy(); await tick(clipDurations.evolve); expect(returning()).toBeNull();
    await review(); expect(returning()).toBeTruthy(); expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it.each(["help", "tools", "hidden"] as const)("cancels only queued recap if %s opens after celebration starts", async panel => {
    await mount(); grow("growing"); await complete(); expect(celebrating()).toBeTruthy();
    let hidden: ReturnType<typeof vi.spyOn> | undefined;
    if (panel === "hidden") {
      hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    } else fireEvent.click(screen.getByRole("button", { name: panel === "help" ? "玩法说明" : /存档盒/ }));
    await tick(5000); expect(returning()).toBeNull();
    if (hidden) { hidden.mockReturnValue(false); await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
    else fireEvent.click(screen.getByRole("button", { name: panel === "help" ? /^关闭$/ : /存档盒/ }));
    expect(returning()).toBeNull(); await review(); expect(returning()).toBeTruthy();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it("a replacement while presentation is queued clears the old growth and recap", async () => {
    await mount(); grow("growing"); await complete(); expect(celebrating()).toBeTruthy();
    api.mockImplementation(async () => ({ ...result(), saveGeneration: "b".repeat(32), returnRecap: undefined, recapPending: false, state: { ...saved, revision: 1, growth: emptyGrowth("baby") } }));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(5000); expect(celebrating()).toBeNull(); expect(returning()).toBeNull();
    await review(); expect(returning()).toBeNull(); expect(writes()).toHaveLength(0);
  });
  it.each(["game", "sleep", "cleared"] as const)("a fresh %s update cancels queued presentation before the animation finishes", async change => {
    await mount(); grow("growing"); await complete(); expect(celebrating()).toBeTruthy();
    saved.revision++;
    if (change === "game") saved.game = { id: "1".repeat(32), startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
    if (change === "sleep") saved.sleeping = true;
    if (change === "cleared") api.mockImplementation(async () => ({ ...result(), returnRecap: undefined }));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(5000); expect(returning()).toBeNull();
    if (change === "game") expect(document.querySelector(".content-game")).toBeTruthy();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it("growth from a visit finishes before the recap is claimed at all", async () => {
    pending = false; await mount(); pending = true; grow("growing"); await tick(15000);
    expect(celebrating()).toBeTruthy(); expect(claims()).toHaveLength(0);
    await tick(clipDurations.evolve); expect(claims()).toHaveLength(1); await complete();
    expect(returning()).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it("a sleep-guarded growth waits for waking, then celebrates before the deferred claim", async () => {
    await mount(); saved.sleeping = true; grow("growing");
    await act(async () => { reply({ ...result(), recapClaimed: false }); });
    await tick(5000); expect(celebrating()).toBeNull(); expect(returning()).toBeNull();
    saved.sleeping = false; saved.revision++; await tick(15000);
    expect(celebrating()).toBeTruthy(); expect(claims()).toHaveLength(1);
    await tick(clipDurations.evolve); expect(claims()).toHaveLength(2); await complete();
    expect(returning()).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it("a failed refresh cancels old presentation without replaying it when the connection recovers", async () => {
    await mount(); grow("growing"); await complete();
    api.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(5000); expect(returning()).toBeNull(); expect(celebrating()).toBeNull();
    await key("b"); expect(returning()).toBeNull(); expect(celebrating()).toBeNull();
    await review(); expect(returning()).toBeTruthy(); expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it("only celebrates the latest accepted stage if growth advances again while help is open", async () => {
    await mount(); fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
    grow("growing"); await complete(); grow("adult");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(celebrating()).toBeNull(); fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    expect(celebrating()).toBeTruthy(); expect(document.querySelector(".toast")?.textContent).toContain("活力型");
    await key("c"); await tick(5000); expect(celebrating()).toBeNull(); expect(returning()).toBeNull();
    expect(claims()).toHaveLength(1); expect(writes()).toHaveLength(0);
  });
  it("initial adult loads do not invent a celebration", async () => {
    pending = false; grow("adult"); await mount(); await tick(15000);
    expect(celebrating()).toBeNull(); expect(claims()).toHaveLength(0); expect(writes()).toHaveLength(0);
  });
});
