import { RequestFailure } from "./requestFailure";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { FishAlbum, FishingGame } from "./FishingGame";
import { fishingCompanions, fishCatalog } from "./fishing";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { Fishing, PetState } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const id = "0123456789abcdef0123456789abcdef";
let saved: PetState, failure: string;
const baseFishing = (): Fishing => ({ spot: 0, casts: 0, catches: [], phase: "ready", step: 0, waitMs: 0, elapsedMs: 0, candidate: "", lastPulseAt: Date.now(), paused: false });
const fixture = (): PetState => ({ schema: 8, revision: 1, species: 3, name: "海豚宝", createdAt: Date.now() - 10000, hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [], pond: { since: Date.now() - 10000, fish: [] }, game: { id, kind: "fishing", fishing: baseFishing(), startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 } });
const calls = () => api.mock.calls.filter(c => c[0] === "action").map(c => c[1] as { kind: string; gameId?: string; step?: number; });
const result = () => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function clock(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T10:00:00Z")); localStorage.clear(); api.mockReset(); failure = ""; saved = fixture();
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const a = body as { kind: string; step: number; }; if (a.kind === failure) throw new RequestFailure("本次钓鱼没有保存", "rejected");
      const n = saved.game?.fishing;
      if (n) {
        if (a.kind === "fish-spot") n.spot = (n.spot + 1) % 3;
        if (a.kind === "fish-cast") { n.phase = "wait"; n.casts++; n.waitMs = 32000; n.candidate = "reed-minnow"; n.elapsedMs = 0; n.lastPulseAt = Date.now(); }
        if (a.kind === "fish-pause") n.paused = true;
        if (a.kind === "fish-resume") { n.paused = false; n.lastPulseAt = Date.now(); }
        if (a.kind === "fish-step") { n.elapsedMs += 1050; n.lastPulseAt = Date.now(); if (n.elapsedMs >= n.waitMs) { n.phase = "bite"; n.elapsedMs = 0; } }
        if (a.kind === "fish-reel") { if (n.phase === "bite") { n.catches.push(n.candidate); n.lastFish = n.candidate; n.outcome = "caught"; saved.pond!.fish = [{ id: n.candidate, count: n.catches.length, firstAt: Date.now(), lastAt: Date.now() }]; } else n.outcome = "early"; n.phase = n.casts === 3 ? "done" : "result"; n.elapsedMs = 0; }
        n.step++;
      }
      if (a.kind === "cancel-play" || a.kind === "fish-finish") delete saved.game;
      saved.revision++;
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("three-key pond and explicit pause", () => {
  it("changes spots, casts, waits for server bite, reels, and records only real fish", async () => {
    await mount(); expect(screen.getByText("POND TOGETHER")).toBeTruthy(); await key("a"); expect(saved.game!.fishing!.spot).toBe(1);
    await key("b"); expect(calls()[1]).toEqual(expect.objectContaining({ kind: "fish-cast", gameId: id, step: 1 }));
    expect(saved.pond!.fish).toHaveLength(0); await key("a"); expect(calls()).toHaveLength(2);
    for (let i = 0;i < 31;i++)await clock(1050); expect(screen.getByText("咬钩啦！按 B 提竿")).toBeTruthy();
    await key("b"); expect(saved.game!.fishing!.outcome).toBe("caught"); expect(saved.pond!.fish).toHaveLength(1); expect(screen.getByText(/初次发现，已记入图鉴/)).toBeTruthy();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelectorAll(".lcd button,.lcd [role=button],.lcd a")).toHaveLength(0);
  });
  it("reloads in-flight fishing paused without a pulse, requires manual resume, and C pauses", async () => {
    Object.assign(saved.game!.fishing!, { phase: "bite", casts: 1, waitMs: 32000, elapsedMs: 2000, candidate: "reed-minnow" });
    await mount(); await clock(20000); expect(calls()).toHaveLength(0); expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await key("c"); await clock(1100); expect(calls().map(a => a.kind)).toEqual(["fish-resume", "fish-step"]);
    await key("c"); const count = calls().length; await clock(12000); expect(calls()).toHaveLength(count); expect(calls().at(-1)?.kind).toBe("fish-pause");
  });
  it("opens the permanent fish album from pause and returns without automatically resuming", async () => {
    saved.game!.fishing!.paused = true; await mount(); await key("a"); await key("b"); expect(document.querySelector(".fish-album")).toBeTruthy();
    for (let i = 0;i < 6;i++)await key("a"); expect(calls()).toHaveLength(0);
    await key("c"); expect(screen.getByText("池塘已暂停")).toBeTruthy(); await clock(10000); expect(calls()).toHaveLength(0);
  });
  it("confirms abandoning, cancel stays paused, and actual discoveries remain", async () => {
    saved.game!.fishing!.paused = true; saved.pond!.fish = [{ id: "reed-minnow", count: 1, firstAt: Date.now(), lastAt: Date.now() }]; await mount();
    await key("a"); await key("a"); await key("b"); expect(screen.getByText(/实际钓到的鱼仍保留/)).toBeTruthy(); await key("c");
    expect(calls()).toHaveLength(0); expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await key("a"); await key("a"); await key("b"); await key("b"); expect(calls()).toEqual([expect.objectContaining({ kind: "cancel-play", gameId: id })]); expect(saved.pond!.fish).toHaveLength(1);
  });
  it("does not restore automatic fishing after backgrounding or opening help", async () => {
    await mount(); await key("b"); await clock(1100); let count = calls().length;
    let hidden = true; vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await clock(5000); expect(calls()).toHaveLength(count);
    hidden = false; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); await clock(2000); expect(calls()).toHaveLength(count);
    await key("c"); await clock(1100); count = calls().length;
    fireEvent.click(screen.getByRole("button", { name: "玩法说明" })); await clock(5000); fireEvent.click(screen.getByRole("button", { name: "关闭" })); await clock(2000); expect(calls()).toHaveLength(count);
  });
  it("stops after a rejected automatic pulse rather than repeatedly sending the same step", async () => {
    await mount(); await key("b");
    const normal = api.getMockImplementation()!;
    let rejectStep!: (error: unknown) => void;
    api.mockImplementation((...args) => args[0] === "action" && (args[1] as { kind: string }).kind === "fish-step"
      ? new Promise((_, reject) => { rejectStep = reject; }) : normal(...args));
    await clock(1100);
    await act(async () => { rejectStep(new RequestFailure("本次钓鱼没有保存", "rejected")); });
    expect(calls().filter(a => a.kind === "fish-step")).toHaveLength(1);
    await clock(100);
    expect(calls().filter(a => a.kind === "fish-step")).toHaveLength(1);
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    api.mockImplementation(normal); await key("c"); await clock(1100);
    expect(calls().filter(a => a.kind === "fish-step")).toHaveLength(2);
  });
  it("never auto-starts a cast that failed to save and lets B retry", async () => {
    failure = "fish-cast"; await mount(); await key("b"); await clock(5000); expect(calls().map(a => a.kind)).toEqual(["fish-cast"]); expect(screen.getByText("本次钓鱼没有保存")).toBeTruthy(); failure = ""; await key("b"); await clock(1100); expect(calls().at(-1)?.kind).toBe("fish-step");
  });
  it("finishes only on B/C, never another cast or abandonment", async () => {
    Object.assign(saved.game!.fishing!, { phase: "done", casts: 3, catches: ["reed-minnow"], outcome: "missed" }); await mount(); await clock(3000); await key("a"); expect(calls()).toHaveLength(0); await key("c"); expect(calls()).toEqual([expect.objectContaining({ kind: "fish-finish", gameId: id, step: 0 })]);
  });
  it("opens fish records directly from home through the same three keys", async () => {
    delete saved.game; await mount(); await key("a"); for (let i = 0;i < 10;i++)await key("a"); await key("b"); expect(document.querySelector(".fish-album")).toBeTruthy(); await key("b"); expect(document.querySelector('[aria-current="true"] .fish-art')?.classList.contains("fish-round")).toBe(true); await key("c"); expect(document.querySelector(".content-home")).toBeTruthy(); expect(calls()).toHaveLength(0);
  });
});

describe("actual discoveries and anatomical companions", () => {
  it("shows only known silhouettes, real first dates/counts, and no fabricated legacy fish", () => {
    render(<FishAlbum pet={saved} page={0} />); expect(document.querySelectorAll(".fish-album text")).toHaveLength(6); expect(screen.getByText("还未遇见的小鱼")).toBeTruthy(); cleanup();
    saved.pond!.fish = [{ id: "reed-minnow", count: 2, firstAt: Date.parse("2026-10-18T08:00:00Z"), lastAt: Date.now() }]; render(<FishAlbum pet={saved} page={0} />); expect(screen.getByText("青苇小鲦")).toBeTruthy(); expect(screen.getByText(/2026\/10\/18.*2 次/)).toBeTruthy(); expect(document.querySelectorAll(".fish-album text")).toHaveLength(5);
  });
  it.each(fishCatalog)("renders a distinct $shape fish shape", fish => {
    saved.pond!.fish = [{ id: fish.id, count: 1, firstAt: Date.now(), lastAt: Date.now() }]; render(<FishAlbum pet={saved} page={fishCatalog.indexOf(fish)} />); expect(screen.getByText(fish.name)).toBeTruthy(); expect(document.querySelector(`.fish-${fish.shape}`)).toBeTruthy();
  });
  it.each(fishingCompanions.flatMap((companion, index) => ["baby", "growing", "adult"].map(stage => ({ companion, index, stage }))))("uses $companion.rig own $stage anatomy and handling method", ({ companion, index, stage }) => {
    saved.species = index; saved.growth!.stage = stage as "baby" | "growing" | "adult"; saved.game!.fishing!.phase = "wait"; render(<FishingGame pet={saved} active choice={0} />);
    expect(document.querySelector(`.pond-scene[data-rig="${companion.rig}"][data-method="${companion.method}"]`)).toBeTruthy(); expect(document.querySelector(`.${companion.rig}-rig[data-rig-stage="${stage}"]`)).toBeTruthy(); expect(document.querySelectorAll(".fishing-companion svg")).toHaveLength(1); expect(document.querySelector(".fishing-companion svg")?.classList.contains("rig-motion-fishing")).toBe(true); expect(document.querySelector(".fishing-companion svg")?.classList.contains("rig-motion-idle")).toBe(false); expect(screen.getByText(companion.waiting)).toBeTruthy();
  });
});

it.each([1, 2, 3])("explains that an early reel used cast %i, including the last cast", casts => {
  const pet = fixture(); Object.assign(pet.game!.fishing!, { casts, phase: casts === 3 ? "done" : "result", outcome: "early" });
  render(<FishingGame pet={pet} active={true} choice={0} />);
  expect(document.querySelector(".fishing-status")?.textContent).toContain("这一竿已用掉");
  expect(document.querySelector(".fishing-status")?.textContent).toContain(casts === 3 ? "三竿完成" : "下一竿等咬钩提示");
});
