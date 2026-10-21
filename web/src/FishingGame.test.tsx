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
        if (a.kind === "fish-reel") { if (n.phase === "bite") { n.catches!.push(n.candidate); n.lastFish = n.candidate; n.outcome = "caught"; saved.pond!.fish = [{ id: n.candidate, count: n.catches!.length, firstAt: Date.now(), lastAt: Date.now() }]; } else n.outcome = "early"; n.phase = n.casts === 3 ? "done" : "result"; n.elapsedMs = 0; }
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

describe("home response after a newly discovered fish", () => {
  it("shows a one-shot discovery echo after collecting the session", async () => {
    Object.assign(saved.game!.fishing!, { phase: "done", casts: 3, catches: [], paused: true });
    saved.pond!.fish = [];
    api.mockImplementation(async (path, body) => {
      if (path === "action") {
        const a = body as { kind: string };
        if (a.kind === "fish-finish") {
          saved.pond!.fish = [{ id: "sun-carp", count: 1, firstAt: Date.now(), lastAt: Date.now() }];
          delete saved.game;
          saved.revision++;
        }
      }
      return result();
    });
    await mount();
    await key("b");
    expect(document.querySelector('[data-echo="fish-discovery"]')).toBeTruthy();
    expect(screen.getByText("新发现 · 小鱼")).toBeTruthy();
    await clock(12000);
    expect(document.querySelector("[data-echo]")).toBeNull();
    expect(calls()).toHaveLength(1);
  });
});

describe("actual discoveries and anatomical companions", () => {
  it("shows only known silhouettes, real first dates/counts, and no fabricated legacy fish", () => {
    render(<FishAlbum pet={saved} page={0} />); expect(document.querySelectorAll(".fish-album text")).toHaveLength(6); expect(screen.getByText("还未遇见的小鱼")).toBeTruthy(); cleanup();
    saved.pond!.fish = [{ id: "reed-minnow", count: 2, firstAt: Date.parse("2026-10-18T08:00:00Z"), lastAt: Date.now() }]; render(<FishAlbum pet={saved} page={0} />); expect(screen.getByText("青苇小鲦")).toBeTruthy(); expect(screen.getByText(/2026\/10\/18.*2 次/)).toBeTruthy(); expect(document.querySelectorAll(".fish-album text")).toHaveLength(5);
  });
  it.each(fishCatalog)("renders a distinct $shape fish shape", fish => {
    saved.schema = 15; saved.pond!.fish = [{ id: fish.id, count: 1, firstAt: Date.now(), lastAt: Date.now() }]; render(<FishAlbum pet={saved} page={fishCatalog.indexOf(fish)} />); expect(screen.getByText(fish.name)).toBeTruthy(); expect(document.querySelector(`.fish-${fish.shape}`)).toBeTruthy();
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

describe("used and remaining casts", () => {
  it("starts with zero used casts and three available casts, not an ordinal zero", () => {
    render(<FishingGame pet={fixture()} active choice={0} />);
    expect(document.querySelector(".fishing-game header span")?.textContent).toBe("已抛 0 / 3 竿 · 0 鱼");
    expect(document.querySelector(".fishing-rule")?.textContent).toBe("还可抛 3 竿 · A 换钓点 · B 抛竿 · C 暂停");
  });
  it.each(["early", "missed", "caught"] as const)("keeps used and remaining counts after %s results", outcome => {
    const pet = fixture(); const n = pet.game!.fishing!;
    Object.assign(n, { phase: "result", outcome, casts: 1 });
    if (outcome === "caught") { n.catches = ["reed-minnow"]; n.lastFish = "reed-minnow"; }
    const { rerender } = render(<FishingGame pet={pet} active choice={0} />);
    for (const casts of [1, 2]) {
      n.casts = casts; rerender(<FishingGame pet={pet} active choice={0} />);
      expect(document.querySelector(".fishing-game header span")?.textContent).toBe(`已抛 ${casts} / 3 竿 · ${outcome === "caught" ? 1 : 0} 鱼`);
      expect(document.querySelector(".fishing-rule")?.textContent).toContain(`还可抛 ${3 - casts} 竿`);
      if (outcome === "early") expect(document.querySelector(".fishing-status")?.textContent).toContain("这一竿已用掉");
    }
  });
  it.each(["wait", "bite"] as const)("does not confuse the third active %s cast with zero chances to reel", phase => {
    const pet = fixture(); const n = pet.game!.fishing!;
    Object.assign(n, { phase, casts: 3, waitMs: 40000, candidate: "sun-carp" });
    const { rerender } = render(<FishingGame pet={pet} active choice={0} />);
    for (const paused of [false, true]) {
      n.paused = paused; rerender(<FishingGame pet={pet} active choice={0} />);
      expect(document.querySelector(".fishing-game header span")?.textContent).toBe("已抛 3 / 3 竿 · 0 鱼");
      expect(document.querySelector(".fishing-rule")?.textContent).not.toContain("还可抛");
      expect(document.querySelector(".fishing-game")?.textContent).not.toMatch(/40000|sun-carp|暖阳小鲤/);
      if (!paused && phase === "bite") expect(screen.getByText("咬钩啦！按 B 提竿")).toBeTruthy();
    }
  });
  it("does not show a remaining-cast invitation on a ready/result pause menu", () => {
    const pet = fixture(); const n = pet.game!.fishing!;
    const { rerender } = render(<FishingGame pet={pet} active choice={0} />);
    for (const phase of ["ready", "result"] as const) {
      Object.assign(n, { phase, paused: true, casts: phase === "ready" ? 0 : 1, outcome: phase === "ready" ? undefined : "early" });
      rerender(<FishingGame pet={pet} active choice={0} />);
      expect(screen.getByText("池塘已暂停")).toBeTruthy();
      expect(document.querySelector(".fishing-rule")?.textContent).not.toContain("还可抛");
    }
  });
  it.each([false, true])("keeps explicit collection qualification at three used casts (caught %s)", caught => {
    const pet = fixture(); Object.assign(pet.game!.fishing!, { phase: "done", casts: 3, outcome: "early", catches: caught ? ["reed-minnow"] : [] });
    render(<FishingGame pet={pet} active choice={0} />);
    expect(document.querySelector(".fishing-game header span")?.textContent).toBe(`已抛 3 / 3 竿 · ${caught ? 1 : 0} 鱼`);
    expect(document.querySelector(".fishing-status")?.textContent).toContain("B / C 收好");
    expect(document.querySelector(".fishing-status")?.textContent).toContain("这一竿已用掉");
    expect(document.querySelector(".fishing-rule")?.textContent).toBe(caught ? "完成可计陪伴 · 3–6 币（共用今日额度）" : "至少钓到一条并完成三竿才计陪伴 / 金币");
    expect(document.querySelector(".fishing-rule")?.textContent).not.toContain("还可抛");
  });
  it("does not restore a consumed early cast through pause, resume or App reload", async () => {
    await mount(); await key("b"); await key("b");
    expect(saved.game!.fishing!.outcome).toBe("early");
    expect(document.querySelector(".fishing-rule")?.textContent).toContain("还可抛 2 竿");
    await key("c"); await key("c");
    expect(document.querySelector(".fishing-rule")?.textContent).toContain("还可抛 2 竿");
    cleanup(); await mount();
    expect(document.querySelector(".fishing-game header span")?.textContent).toContain("已抛 1 / 3 竿");
    await key("b"); // The next explicit cast, not a restored first cast.
    expect(saved.game!.fishing!.casts).toBe(2);
    expect(calls().filter(a => a.kind === "fish-cast")).toHaveLength(2);
  });
});

// Atmosphere follows confirmed elapsed time, never a local countdown or fish RNG.
describe("quiet waiting feedback without false bites", () => {
  it.each([
    [0, fishingCompanions[3].waiting], [7999, fishingCompanions[3].waiting],
    [8000, "水纹一圈圈散开，不急着提竿。"], [15999, "水纹一圈圈散开，不急着提竿。"],
    [16000, "风掠过水面，小伙伴还在陪你等。"], [23999, "风掠过水面，小伙伴还在陪你等。"],
    [24000, "静静听一会儿水声，等明确的咬钩提示。"], [31999, "静静听一会儿水声，等明确的咬钩提示。"],
    [32000, fishingCompanions[3].waiting], [40000, "水纹一圈圈散开，不急着提竿。"],
  ])("shows an unhurried note at %i confirmed milliseconds", (elapsedMs, note) => {
    const pet = fixture(); Object.assign(pet.game!.fishing!, { phase: "wait", casts: 1, waitMs: 40000, elapsedMs });
    render(<FishingGame pet={pet} active={true} choice={0} />);
    expect(document.querySelector('.fishing-wait-note')?.textContent).toBe(note);
    expect(document.querySelector('.fishing-status')?.textContent).toBe('还没咬钩；鱼影只是风景，等「咬钩啦」再按 B。');
    expect(document.querySelector('.fishing-bite')).toBeNull();
    expect(document.querySelectorAll('.fishing-ripple')).toHaveLength(2);
    expect(document.querySelector('.fishing-ripples')?.closest('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.fishing-wait-note')?.closest('[aria-live],[role="status"]')).toBeNull();
  });
  it.each([true, false])("keeps saved or local pauses free of active waiting cues (saved pause %s)", paused => {
    const pet = fixture(); Object.assign(pet.game!.fishing!, { phase: 'wait', paused, elapsedMs: 16000 });
    render(<FishingGame pet={pet} active={paused} choice={0} />);
    expect(document.querySelector('.pond-scene')?.getAttribute('data-motion')).toBe('paused');
    expect(document.querySelector('.fishing-wait-note')).toBeNull();
    expect(screen.getByText('池塘已暂停')).toBeTruthy();
  });
  it.each(['bite', 'result', 'done', 'ready'] as const)("does not mix waiting notes into %s", phase => {
    const pet = fixture(); Object.assign(pet.game!.fishing!, { phase, elapsedMs: 16000 });
    render(<FishingGame pet={pet} active={true} choice={0} />);
    expect(document.querySelector('.fishing-wait-note')).toBeNull();
    if (phase === 'bite') expect(screen.getByText('咬钩啦！按 B 提竿')).toBeTruthy();
    if (phase === 'ready' || phase === 'result' || phase === 'done') expect(document.querySelector('.fishing-ripples')).toBeNull();
  });
  it("does not advance flavor, save, reveal the candidate or shorten a wait on its own", async () => {
    const pet = fixture(); Object.assign(pet.game!.fishing!, { phase: 'wait', casts: 1, waitMs: 40000, elapsedMs: 16000, candidate: 'moon-perch' });
    const before = structuredClone(pet);
    const { rerender } = render(<FishingGame pet={pet} active={true} choice={0} />);
    await clock(60000);
    expect(document.querySelector('.fishing-wait-note')?.textContent).toBe('风掠过水面，小伙伴还在陪你等。');
    pet.game!.fishing!.candidate = 'sun-carp'; pet.game!.fishing!.waitMs = 32000;
    rerender(<FishingGame pet={pet} active={true} choice={0} />);
    expect(document.querySelector('.fishing-wait-note')?.textContent).toBe('风掠过水面，小伙伴还在陪你等。');
    pet.game!.fishing!.candidate = before.game!.fishing!.candidate; pet.game!.fishing!.waitMs = before.game!.fishing!.waitMs;
    expect(pet).toEqual(before); expect(api).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.fishing-game button,.fishing-game a,.fishing-game input')).toHaveLength(0);
  });
});

describe("rain fish catalogue compatibility", () => {
  it.each([8, 14, 15])("wraps the schema %i catalogue with A/B and returns to the unchanged pause", async schema => {
    saved.schema = schema; saved.game!.fishing!.paused = true;
    await mount(); await key("a"); await key("b");
    const count = schema >= 15 ? 7 : 6;
    expect(document.querySelectorAll(".fish-album-grid > div")).toHaveLength(count);
    expect(screen.getByText(`已发现 0 / ${count}`)).toBeTruthy();
    for (let i = 1; i < count; i++) await key("b");
    if (schema >= 15) {
      expect(screen.getByText(/每竿 1\/8/)).toBeTruthy();
      expect(screen.getByText(/不看现实天气/)).toBeTruthy();
      expect(screen.queryByText("雨珠小鲤")).toBeNull();
    }
    await key("b");
    expect(document.querySelector(".fish-album-grid > div:first-child")?.getAttribute("aria-current")).toBe("true");
    await key("c"); expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(calls()).toHaveLength(0); expect(saved.game!.fishing!.casts).toBe(0);
  });
  it.each([false, true])("shows the rain fish only after a saved discovery (%s)", discovered => {
    saved.schema = 15; saved.game!.fishing!.candidate = "rain-koi";
    if (discovered) saved.pond!.fish = [{id:"rain-koi",count:2,firstAt:Date.now()-1000,lastAt:Date.now()}];
    render(<FishAlbum pet={saved} page={6} />);
    expect(screen.queryByText("雨珠小鲤") !== null).toBe(discovered);
    expect(document.querySelectorAll(".fish-album text")).toHaveLength(discovered ? 6 : 7);
    expect(screen.getByText(discovered ? /共遇见 2 次/ : "真实钓到以后，才会留下模样和发现日期。")).toBeTruthy();
    expect(screen.getByText(/每竿 1\/8/)).toBeTruthy();
    expect(document.querySelectorAll(".fish-album button,.fish-album a,.fish-album input")).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });
  it("keeps a selected entry highlighted if an old server replaces a newer state", () => {
    saved.schema=14; render(<FishAlbum pet={saved} page={6} />);
    expect(document.querySelector(".fish-album-grid > div:first-child")?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll('.fish-album-grid > div')).toHaveLength(6);
    expect(screen.queryByText(/每竿 1\/8/)).toBeNull();
  });
  it.each(["wait", "bite"])("never reveals the rain candidate in %s", phase => {
    saved.schema=15; Object.assign(saved.game!.fishing!, {phase,candidate:"rain-koi",casts:1});
    render(<FishingGame pet={saved} active choice={0} />);
    expect(screen.queryByText(/雨珠小鲤/)).toBeNull();
    expect(document.querySelector(".fishing-catch")).toBeNull();
  });
  it("uses ordinary completion copy and saved first-discovery feedback for a caught rain fish", () => {
    saved.schema=15;
    Object.assign(saved.game!.fishing!, {phase:"result",candidate:"rain-koi",lastFish:"rain-koi",catches:["rain-koi"],outcome:"caught",casts:1});
    saved.pond!.fish=[{id:"rain-koi",count:1,firstAt:Date.now(),lastAt:Date.now()}];
    render(<FishingGame pet={saved} active choice={0} />);
    expect(screen.getByText("雨珠小鲤！初次发现，已记入图鉴。")).toBeTruthy();
    expect(document.querySelector(".fishing-catch .fish-rain")).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});

describe("native reading of this fishing session", () => {
  const region = () => screen.getByRole("region", { name: "本次钓到的小鱼" });
  function caughtSession(phase: "result" | "done" = "result") {
    Object.assign(saved.game!.fishing!, { phase, casts: phase === "done" ? 3 : 2,
      paused: true, waitMs: 32000, candidate: "moon-perch", outcome: "missed",
      catches: ["reed-minnow"], lastFish: "" });
    saved.pond!.fish = [{ id: "reed-minnow", count: 5, firstAt: Date.now(), lastAt: Date.now() }];
  }
  it.each(["result", "done"] as const)("reading keys do not resume or collect in %s; explicit controls still work", async phase => {
    caughtSession(phase); await mount();
    const area = region(); area.focus();
    for (const k of ["ArrowDown", "ArrowUp", " ", "Enter"]) {
      await act(async () => { fireEvent.keyDown(area, { key: k }); });
    }
    await clock(16000);
    expect(calls()).toHaveLength(0);
    expect(document.activeElement).toBe(area);
    expect(region().textContent).toContain("青苇小鲦");
    await key(phase === "done" ? "b" : "c");
    expect(calls().map(a => a.kind)).toEqual([phase === "done" ? "fish-finish" : "fish-resume"]);
    expect(screen.queryByRole("region", { name: "本次钓到的小鱼" })).toBeNull();
  });
  it("returns from the cumulative album still paused, and keeps the saved list after remount", async () => {
    caughtSession(); await mount();
    expect(region().textContent).toContain("1 条");
    await key("a"); await key("b");
    expect(screen.getByLabelText("池塘鱼图鉴")).toBeTruthy();
    await key("c"); expect(region().textContent).toContain("青苇小鲦");
    expect(calls()).toHaveLength(0);
    cleanup(); await mount();
    expect(region().textContent).toContain("青苇小鲦");
    expect(saved.game!.fishing!.paused).toBe(true);
    expect(calls()).toHaveLength(0);
  });
  it("does not reuse a previous session's list after abandon and a fresh start", async () => {
    caughtSession(); await mount();
    await key("a"); await key("a"); await key("b"); await key("b");
    expect(calls().map(a => a.kind)).toEqual(["cancel-play"]);
    expect(screen.queryByRole("region", { name: "本次钓到的小鱼" })).toBeNull();
    cleanup(); saved.game = { id: "fedcba9876543210fedcba9876543210", kind: "fishing",
      startedAt: Date.now(), round: 0, score: 0, lastBeat: -1,
      fishing: { ...baseFishing(), paused: true } };
    await mount();
    expect(region().textContent).toContain("还没有钓到小鱼");
    expect(region().textContent).not.toContain("青苇小鲦");
    expect(saved.pond!.fish![0].count).toBe(5);
  });
});


describe("pause while a fishing pulse is in flight", () => {
  async function pendingPulse() {
    await mount(); await key("b");
    const normal = api.getMockImplementation()!;
    let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
    let reject!: (error: unknown) => void;
    api.mockImplementation((...args) => args[0] === "action" && (args[1] as { kind: string }).kind === "fish-step"
      ? new Promise((yes, no) => { resolve = yes; reject = no; }) : normal(...args));
    await clock(1100);
    return { normal, resolve, reject };
  }
  it("accepts C during an automatic write, stops locally, then saves once with the acknowledged step", async () => {
    const pulse = await pendingPulse();
    expect(screen.getByRole("button", { name: "C 返回" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "B 确认" }).hasAttribute("disabled")).toBe(true);
    await key("c"); await key("c");
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step"]);
    await clock(5000);
    await act(async () => { pulse.resolve(await pulse.normal("action", calls()[1])); });
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step", "fish-pause"]);
    expect(calls()[2]).toMatchObject({ gameId: id, step: 2 });
    expect(saved.game!.fishing!.paused).toBe(true);
    await clock(5000); expect(calls()).toHaveLength(3);
  });
  it("keeps a wait-to-bite reply paused instead of restoring local run permission", async () => {
    const pulse = await pendingPulse(); await key("c");
    saved.game!.fishing!.elapsedMs = 31000;
    await act(async () => { pulse.resolve(await pulse.normal("action", calls()[1])); });
    expect(saved.game!.fishing!.phase).toBe("bite");
    expect(saved.game!.fishing!.paused).toBe(true);
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(screen.queryByText("咬钩啦！按 B 提竿")).toBeNull();
    await clock(12000); expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step", "fish-pause"]);
  });
  it("handles a physical click in the gap before React paints the automatic busy state", async () => {
    await mount(); await key("b");
    const normal = api.getMockImplementation()!;
    let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
    api.mockImplementation((...args) => args[0] === "action" && (args[1] as { kind: string }).kind === "fish-step"
      ? new Promise(yes => { resolve = yes; }) : normal(...args));
    const button = screen.getByRole("button", { name: "C 返回" });
    await act(async () => {
      vi.advanceTimersByTime(1050);
      // No React flush between the pulse taking the ref lock and this click.
      expect(button.hasAttribute("disabled")).toBe(false);
      fireEvent.click(button);
    });
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await act(async () => { resolve(await normal("action", calls()[1])); });
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step", "fish-pause"]);
  });
  it("does not queue C behind an explicitly requested cast", async () => {
    await mount(); const normal = api.getMockImplementation()!;
    let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
    api.mockImplementation((...args) => args[0] === "action" ? new Promise(yes => { resolve = yes; }) : normal(...args));
    await key("b"); await key("c");
    expect(screen.getByRole("button", { name: "C 返回" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { resolve(await normal("action", calls()[0])); });
    expect(calls().map(a => a.kind)).toEqual(["fish-cast"]);
  });
  it.each(["generation", "session", "already-paused", "unmount"])("discards deferred pause when %s changes", async change => {
    const pulse = await pendingPulse(); await key("c");
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await act(async () => {
      const reply = await pulse.normal("action", calls()[1]);
      if (change === "generation") reply.saveGeneration = "fedcba9876543210fedcba9876543210";
      if (change === "session") reply.state.game!.id = "fedcba9876543210fedcba9876543210";
      if (change === "already-paused") reply.state.game!.fishing!.paused = true;
      if (change === "unmount") cleanup();
      pulse.resolve(reply);
    });
    await clock(5000);
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step"]);
  });
  it.each(["rejected", "unknown"] as const)("does not send a deferred pause after a %s pulse", async outcome => {
    const pulse = await pendingPulse(); await key("c");
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await act(async () => { pulse.reject(new RequestFailure("步进未确认", outcome)); });
    await clock(5000);
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step"]);
  });
  it.each(["blur", "help", "hidden"])("does not send a deferred pause after %s interrupts the pending pulse", async interruption => {
    const pulse = await pendingPulse(); await key("c");
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    await act(async () => {
      if (interruption === "blur") window.dispatchEvent(new Event("blur"));
      else if (interruption === "help") fireEvent.click(screen.getByRole("button", { name: "玩法说明" }));
      else { vi.spyOn(document, "hidden", "get").mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); }
    });
    await act(async () => { pulse.resolve(await pulse.normal("action", calls()[1])); });
    await clock(5000);
    expect(calls().map(a => a.kind)).toEqual(["fish-cast", "fish-step"]);
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
  });
});


describe("paused fishing instructions match the selected operation", () => {
  it.each([
    ["ready", true, true, "继续后 A 换钓点、B 抛竿；不会自动抛竿。"],
    ["result", true, true, "继续后 A 换钓点、B 抛竿；不会自动抛竿。"],
    ["wait", true, true, "继续后接着等咬钩，看到提示再按 B；提前提竿也会用掉一竿。"],
    ["bite", true, true, "继续后仍在咬钩阶段，按 B 提竿；不会重抛或补跑。"],
    ["wait", false, false, "继续后接着等咬钩，看到提示再按 B；提前提竿也会用掉一竿。"],
    ["bite", false, false, "继续后仍在咬钩阶段，按 B 提竿；不会重抛或补跑。"],
  ] as const)("explains explicit resume for %s (saved pause %s, active %s)", (phase, paused, active, expected) => {
    Object.assign(saved.game!.fishing!, { phase, paused, casts: phase === "ready" ? 0 : 1 });
    render(<FishingGame pet={saved} active={active} choice={0} />);
    expect(document.querySelector(".fishing-rule")?.textContent).toBe(expected);
    expect(screen.getByText("A 选择 · B 确认 · C 继续")).toBeTruthy();
    expect(document.querySelector(".fishing-rule")?.textContent).not.toContain("C 暂停");
  });
  it.each([
    [1, "查看累计鱼图鉴，C 返回暂停；不会继续本局。"],
    [2, "先打开确认页；确认放弃不计陪伴或金币，已钓到的鱼仍留在图鉴。"],
    [3, "查看风景手记，C 返回暂停；不会继续本局。"],
    [4, "查看玩法说明，C 返回暂停；不会继续本局。"],
  ] as const)("explains the consequence of pause choice %s", (choice, expected) => {
    saved.game!.fishing!.paused = true;
    render(<FishingGame pet={saved} active={false} choice={choice} />);
    expect(document.querySelector(".fishing-rule")?.textContent).toBe(expected);
    expect(document.querySelectorAll(".fishing-game :is(button,a,input,[role=button])")).toHaveLength(0);
  });
  it("updates advice through A/B/C without casting, reeling, resuming or saving while browsing", async () => {
    saved.game!.fishing!.paused = true; await mount();
    const rule = () => document.querySelector(".fishing-rule")?.textContent;
    expect(rule()).toContain("不会自动抛竿");
    await key("a"); expect(rule()).toContain("累计鱼图鉴");
    await key("b"); expect(document.querySelector(".fish-album")).toBeTruthy();
    await key("c"); expect(rule()).toContain("不会自动抛竿");
    await key("a"); await key("a"); expect(rule()).toContain("先打开确认页");
    await key("b"); expect(screen.getByText(/实际钓到的鱼仍保留/)).toBeTruthy();
    await key("c"); expect(rule()).toContain("不会自动抛竿");
    await clock(10000); expect(calls()).toHaveLength(0);
    expect(saved.game!.fishing!.casts).toBe(0);
    await key("b"); expect(calls().map(a => a.kind)).toEqual(["fish-resume"]);
    expect(rule()).toContain("还可抛 3 竿");
  });
});
