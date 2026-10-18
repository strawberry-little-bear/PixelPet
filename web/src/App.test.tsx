import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import App from "./App";
import { request } from "./api";
import type { AdultForm, PetState } from "./types";
import { emptyGrowth } from "./growth";

vi.mock("./api", () => ({ request: vi.fn() }));

let saved: PetState;
const api = vi.mocked(request);
const state = () => ({
  state: structuredClone(saved),
  message: "照顾成功",
  serverTime: Date.now(),
});
const scene = () =>
  document.querySelector(".pet-scene")?.getAttribute("data-motion");
async function key(value: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: value });
  });
}
async function choose(menuIndex: number) {
  await key("a");
  for (let i = 0; i < menuIndex; i++) await key("a");
  await key("b");
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function mount() {
  await act(async () => {
    render(<App />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api.mockReset();
  saved = {
    schema: 2,
    revision: 1,
    species: 2,
    name: "草莓兔",
    createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000,
    lastTick: Date.now(),
    sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 60, energy: 80 },
    careCount: 0,
    growth: emptyGrowth("baby"),
    logs: [{ at: Date.now(), text: "你好，小伙伴。" }],
  };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const action = body as { kind: string };
      if (action.kind === "feed") {
        saved.needs.hunger += 20;
        saved.careCount++;
      }
      if (action.kind === "clean") {
        saved.needs.clean = 95;
        saved.careCount++;
      }
      if (action.kind === "sleep") saved.sleeping = !saved.sleeping;
      if (action.kind === "play")
        saved.game = {
          startedAt: Date.now(),
          round: 0,
          score: 0,
          lastBeat: -1,
        };
      saved.revision++;
    }
    return state();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("three-button pet animation lifecycle", () => {
  it("plays a saved meal once and returns to idle without another API mutation", async () => {
    await mount();
    expect(scene()).toBe("idle");
    expect(document.querySelector(".lcd button")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    await choose(0);
    expect(scene()).toBe("eating");
    expect(document.querySelectorAll(".rice-bite")).toHaveLength(2);
    expect(
      (screen.getByRole("button", { name: "A 选择" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "C 返回" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await key("b"); // Keyboard cannot feed twice while the clip is playing.
    expect(saved.careCount).toBe(1);
    await advance(2999);
    expect(scene()).toBe("eating");
    await advance(1);
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(
      1,
    );
  });

  it("C skips only the picture; an old meal timeout cannot cut off the next bath", async () => {
    await mount();
    await choose(0);
    await advance(500);
    await key("c");
    expect(scene()).toBe("idle");
    expect(saved.needs.hunger).toBe(80);
    await choose(2);
    expect(scene()).toBe("bathing");
    expect(document.querySelector(".bath-tub")).not.toBeNull();
    expect(document.querySelectorAll(".bath-bubbles i")).toHaveLength(6);
    await advance(2500);
    expect(scene()).toBe("bathing");
    await advance(1499);
    expect(scene()).toBe("bathing");
    await advance(1);
    expect(scene()).toBe("idle");
    expect(saved.careCount).toBe(2);
  });

  it("restores closed-eye sleep after remount and wakes through the same three keys", async () => {
    await mount();
    await choose(3);
    expect(scene()).toBe("sleeping");
    expect(document.querySelector(".expression-asleep")).not.toBeNull();
    expect(document.querySelector(".sleep-blanket")).not.toBeNull();
    await advance(30000);
    expect(scene()).toBe("sleeping");
    cleanup();
    await mount();
    expect(scene()).toBe("sleeping");
    await choose(3);
    expect(scene()).toBe("waking");
    expect(saved.sleeping).toBe(false);
    await advance(1400);
    expect(scene()).toBe("idle");
    expect(document.querySelector(".sleep-blanket")).toBeNull();
  });

  it("does not show a successful care animation when saving fails", async () => {
    await mount();
    api.mockRejectedValueOnce(new Error("保存失败，请重试"));
    await choose(0);
    expect(scene()).toBeUndefined(); // Still in the menu, awaiting a successful save.
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    expect(saved.careCount).toBe(0);
    expect(
      (screen.getByRole("button", { name: "B 确认" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await key("c");
    expect(scene()).toBe("idle");
  });

  it("does not let a celebration lock the controls when a mini game starts", async () => {
    await mount();
    await choose(1);
    expect(document.querySelector(".star-game")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "A 选择" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("uses saved growth rather than wall age and opens all handbook pages with A/B/C", async () => {
    saved.hatchedAt = Date.now() - 80 * 3600000;
    saved.growth!.points = 12;
    await mount();
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-stage"),
    ).toBe("baby");
    await choose(6);
    expect(
      document.querySelector(".growth-panel")?.getAttribute("data-growth-page"),
    ).toBe("0");
    expect(document.querySelector(".growth-score")?.textContent).toContain(
      "12.0",
    );
    await key("a");
    expect(
      document.querySelector(".growth-panel")?.getAttribute("data-growth-page"),
    ).toBe("1");
    expect(document.querySelectorAll("[data-preview-stage]")).toHaveLength(0);
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("2");
    expect(document.querySelector(".form-guide")?.textContent).toContain("成年时按上方顺序确定");
    await key("a");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("0");
    expect(document.querySelectorAll("[data-preview-stage]")).toHaveLength(3);
    await key("b");
    await key("b");
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("0");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
    await key("c");
    expect(scene()).toBe("idle");
    await choose(6);
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("0");
  });

  it("does not display 100 percent before the next growth stage is reached", async () => {
    saved.growth!.points = 23.9;
    await mount();
    expect(document.querySelector(".companion-growth")?.textContent).toContain(
      "99%",
    );
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-stage"),
    ).toBe("baby");
  });

  it("queues one evolution after care and C cannot undo the new stage", async () => {
    await mount();
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      const response = await normal(path, body);
      if (path === "action" && (body as { kind: string }).kind === "feed") {
        saved.growth = {
          ...emptyGrowth("growing"),
          points: 24.1,
          growingAt: Date.now(),
        };
        return state();
      }
      return response;
    });
    await choose(0);
    expect(scene()).toBe("eating");
    await advance(3000);
    expect(scene()).toBe("celebrating");
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-stage"),
    ).toBe("growing");
    await key("c");
    expect(scene()).toBe("idle");
    await advance(15000);
    expect(scene()).toBe("idle");
    expect(saved.growth!.stage).toBe("growing");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(
      1,
    );
  });

  it("renders a saved adult form after reload without replaying evolution", async () => {
    saved.growth = {
      ...emptyGrowth("adult"),
      points: 72,
      form: "lively",
      growingAt: Date.now() - 1000,
      adultAt: Date.now(),
    };
    await mount();
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-stage"),
    ).toBe("adult");
    expect(
      document.querySelector(".pet-scene")?.getAttribute("data-form"),
    ).toBe("lively");
    expect(document.querySelector(".growth-form-emblem")).not.toBeNull();
    expect(scene()).toBe("idle");
  });

  it("shows stage-relative points consistently with the growing progress bar", async () => {
    saved.growth = {
      ...emptyGrowth("growing"),
      points: 36,
      growingAt: Date.now() - 1000,
    };
    await mount();
    await choose(6);
    expect(document.querySelector(".growth-score")?.textContent).toContain(
      "12.0 / 48",
    );
    expect(
      (document.querySelector(".growth-panel .growth-track i") as HTMLElement)
        .style.width,
    ).toBe("25%");
  });
});


describe("evolution while resting", () => {
  it("keeps sleeping usable, then celebrates after waking exactly once", async () => {
    saved.sleeping = true;
    await mount();
    saved.revision++;
    saved.growth = {
      ...emptyGrowth("growing"),
      points: 24.1,
      growingAt: Date.now(),
    };
    await advance(15000);
    expect(scene()).toBe("sleeping");
    expect((screen.getByRole("button", { name: "A 选择" }) as HTMLButtonElement).disabled).toBe(false);
    await advance(3000); // Must not consume the celebration invisibly in sleep.
    await choose(3);
    expect(scene()).toBe("waking");
    await advance(1400);
    expect(scene()).toBe("celebrating");
    await advance(2400);
    expect(scene()).toBe("idle");
    await advance(15000);
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(1);
  });
});

describe("saved care feedback with three buttons", () => {
  function rewardNextMeal() {
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      const response = await normal(path, body);
      if (path === "action" && (body as { kind: string }).kind === "feed") {
        saved.growth!.points += .25;
        saved.growth!.care.nutrition++;
        return { ...state(), careFeedback: {
          kind: "feed", points: .25, habit: "nutrition", habitGain: 1, reason: "credited",
        } };
      }
      return response;
    });
  }

  it("shows only saved credit, survives C, and expires after the care clip", async () => {
    await mount();
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("距成长期还差 24.00 点");
    rewardNextMeal();
    await choose(0);
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("成长 +0.25 · 喂食习惯 +1");
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("23.75 点");
    await advance(2999);
    await key("c");
    await advance(7999);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("credited");
    await advance(1);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
    await advance(15000);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
    expect(saved.growth!.points).toBe(.25);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
  });

  it("keeps capped feedback readable after evolution, and reload does not replay it", async () => {
    saved.growth = { ...emptyGrowth("growing"), points: 71.9, growingAt: Date.now() - 1000 };
    await mount();
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      const response = await normal(path, body);
      if (path !== "action") return response;
      saved.growth = { ...saved.growth!, stage: "adult", points: 72, form: "balanced", adultAt: Date.now() };
      return { ...state(), careFeedback: {
        kind: "feed", points: .1, habit: "nutrition", habitGain: 1, reason: "credited",
      } };
    });
    await choose(0);
    await advance(3000);
    expect(scene()).toBe("celebrating");
    await advance(2400);
    expect(scene()).toBe("idle");
    await advance(7999);
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("成长 +0.10");
    await advance(1);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
    cleanup();
    await mount();
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("均衡型已定型");
  });

  it("explains reward cooldown but never shows a success receipt after failure", async () => {
    await mount();
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => ({ ...await normal(path, body),
      ...(path === "action" ? { careFeedback: {
        kind: "feed", points: 0, habit: "nutrition", habitGain: 0,
        reason: "cooldown", retryAt: Date.now() + 20 * 60000,
      } } : {}),
    }));
    await choose(0);
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("同类奖励还需 20 分钟");
    expect(document.querySelector(".growth-feedback")?.textContent).not.toContain("成长 +");
    await key("c");
    api.mockRejectedValueOnce(new Error("保存失败"));
    await choose(0);
    expect(document.querySelector(".growth-feedback")).toBeNull(); // Still in the menu after failure.
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    await key("c");
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
  });

  it("an old feedback timer cannot clear the next care result", async () => {
    await mount();
    rewardNextMeal();
    await choose(0);
    await key("c");
    await advance(7000);
    await choose(0);
    await key("c");
    await advance(1000);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("credited");
    await advance(7000);
    expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
  });
});

describe("durable three-button return recap", () => {
  function enableRecap() {
    let pending = true;
    const snapshot = {
      needs: { ...saved.needs }, stage: saved.growth!.stage,
      form: saved.growth!.form, points: saved.growth!.points,
      rest: 0, trackedHours: 0,
    };
    const recap = {
      id: "return-test", from: Date.now() - 3600000, to: Date.now(),
      before: { ...snapshot, needs: { ...snapshot.needs, energy: 52 } },
      after: { ...snapshot, trackedHours: 1, rest: 1 },
    };
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      const result = await normal(path, body);
      const claimed = path === "recap/read" && pending && !saved.sleeping && !saved.game;
      if (claimed) pending = false;
      return { ...result, returnRecap: recap, recapPending: pending, recapClaimed: claimed };
    });
    return recap;
  }

  it("automatically shows actual changes, uses A/B/C, and reload never replays", async () => {
    enableRecap();
    await mount();
    expect(screen.getByLabelText("回访小结").textContent).toContain("52.0 → 80.0");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
    await key("a");
    expect(screen.getByLabelText("回访小结").textContent).toContain("+1.00 习惯");
    expect(screen.getByLabelText("回访小结").textContent).toContain("无额外奖励");
    await key("b");
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    cleanup(); await mount();
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    await choose(7); // Deliberate menu review, without another claim/action.
    expect(screen.getByLabelText("回访小结")).toBeTruthy();
    await key("c");
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "recap/read")).toHaveLength(1);
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
  });

  it("waits for waking and its clip before consuming the pending recap", async () => {
    saved.sleeping = true;
    enableRecap();
    await mount();
    expect(scene()).toBe("sleeping");
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    expect(api.mock.calls.some(([path]) => path === "recap/read")).toBe(false);
    await choose(3);
    expect(scene()).toBe("waking");
    await advance(1399);
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    await advance(1);
    expect(screen.getByLabelText("回访小结")).toBeTruthy();
    await key("c");
    expect(scene()).toBe("idle");
  });

  it("does not interrupt an active game", async () => {
    saved.game = { startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
    enableRecap();
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      if (path === "action" && (body as { kind: string }).kind === "cancel-play") delete saved.game;
      return normal(path, body);
    });
    await mount();
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    await advance(30000);
    expect(api.mock.calls.some(([path]) => path === "recap/read")).toBe(false);
    await key("c");
    expect(screen.getByLabelText("回访小结")).toBeTruthy();
  });

  it("queues the recap after, not during, an online evolution celebration", async () => {
    await mount();
    enableRecap();
    saved.revision++;
    saved.growth = { ...saved.growth!, stage: "growing", points: 24, growingAt: Date.now() };
    await advance(15000);
    expect(scene()).toBe("celebrating");
    expect(screen.queryByLabelText("回访小结")).toBeNull();
    await advance(2399);
    expect(api.mock.calls.some(([path]) => path === "recap/read")).toBe(false);
    await advance(1);
    expect(screen.getByLabelText("回访小结")).toBeTruthy();
  });

  it("does not record hidden-tab heartbeats as active visits", async () => {
    await mount();
    api.mockClear();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await advance(45000);
    expect(api).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(api).toHaveBeenCalledWith("visit", {});
    hidden.mockRestore();
  });
});

describe("saved-state proactive expression", () => {
  const need = () => document.querySelector(".pet-scene")?.getAttribute("data-need");

  it("gives the lowest critical body need priority and only recomputes on saved state", async () => {
    saved.needs = { hunger: 20, energy: 10, clean: 15, mood: 0 };
    await mount();
    expect(need()).toBe("tired");
    saved.needs.energy = 80;
    saved.revision++;
    await advance(15000);
    expect(need()).toBe("dirty");
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
  });

  it("stops asking for food after a saved meal, without replay on heartbeat or remount", async () => {
    saved.needs.hunger = 50;
    await mount();
    expect(need()).toBe("hungry");
    await choose(0);
    expect(scene()).toBe("eating");
    expect(need()).toBe("none");
    expect(document.querySelector(".need-gesture")).toBeNull();
    await advance(3000);
    expect(need()).toBe("content");
    await advance(15000);
    expect(scene()).toBe("idle");
    expect(need()).toBe("content");
    cleanup();
    await mount();
    expect(scene()).toBe("idle");
    expect(need()).toBe("content");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(1);
  });

  it("does not falsely satisfy a need when the care save fails", async () => {
    saved.needs.hunger = 40;
    await mount();
    api.mockRejectedValueOnce(new Error("保存失败，请重试"));
    await choose(0);
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    await key("c");
    expect(scene()).toBe("idle");
    expect(need()).toBe("hungry");
    expect(saved.needs.hunger).toBe(40);
    expect(saved.careCount).toBe(0);
  });

  it("hides requests during bath, sleep and wake, then resumes the actual remaining need", async () => {
    saved.needs.clean = 20;
    saved.needs.mood = 30;
    await mount();
    expect(need()).toBe("dirty");
    await choose(2);
    expect(need()).toBe("none");
    await key("c");
    expect(need()).toBe("playful");
    await choose(3);
    expect(scene()).toBe("sleeping");
    expect(need()).toBe("none");
    await advance(30000);
    expect(document.querySelector(".need-gesture")).toBeNull();
    cleanup();
    await mount();
    expect(scene()).toBe("sleeping");
    expect(need()).toBe("none");
    await choose(3);
    expect(scene()).toBe("waking");
    expect(need()).toBe("none");
    await advance(1400);
    expect(need()).toBe("playful");
  });

  it("never interrupts a running game with an invitation, including after reload", async () => {
    saved.needs.mood = 0;
    await mount();
    expect(need()).toBe("playful");
    await choose(1);
    expect(document.querySelector(".star-game")).not.toBeNull();
    expect(document.querySelector(".need-gesture")).toBeNull();
    expect(document.querySelector(".game-lane .rabbit-rig")?.getAttribute("data-rig-stage")).toBe("baby");
    await advance(15000);
    cleanup();
    await mount();
    expect(document.querySelector(".star-game")).not.toBeNull();
    expect(document.querySelector(".need-gesture")).toBeNull();
  });

  it("lets an evolution finish before expressing the current need, keeping the new anatomy", async () => {
    saved.needs.hunger = 20;
    await mount();
    saved.revision++;
    saved.growth = { ...emptyGrowth("growing"), points: 24, growingAt: Date.now() };
    await advance(15000);
    expect(scene()).toBe("celebrating");
    expect(need()).toBe("none");
    expect(document.querySelector(".pet-scene .rabbit-rig")?.getAttribute("data-rig-stage")).toBe("growing");
    await advance(2400);
    expect(need()).toBe("hungry");
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
  });

  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("keeps the saved %s adult form through care and need changes", async form => {
    saved.growth = { ...emptyGrowth("adult"), points: 72, form,
      growingAt: Date.now() - 1000, adultAt: Date.now() };
    saved.needs.hunger = 50;
    await mount();
    expect(need()).toBe("hungry");
    await choose(0);
    await key("c");
    expect(need()).toBe("content");
    saved.needs.mood = 20;
    saved.revision++;
    await advance(15000);
    expect(need()).toBe("playful");
    expect(scene()).toBe("idle");
    expect(document.querySelector(".pet-scene")?.getAttribute("data-form")).toBe(form);
    expect(saved.growth!.form).toBe(form);
    expect(saved.growth!.points).toBe(72);
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(1);
  });

  it("supports old saves without growth metadata without inventing a care action", async () => {
    delete saved.growth;
    saved.needs.energy = 35;
    await mount();
    expect(need()).toBe("tired");
    expect(document.querySelector(".pet-scene .rabbit-rig")?.getAttribute("data-rig-stage")).toBe("baby");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
  });
});

describe("three-button permanent album", () => {
  it("A/B browse collected memories, wrap, C returns, reopening starts at cover without mutations", async () => {
    saved.schema=3;
    saved.album={since:saved.createdAt,legacy:false,entries:[
      {kind:"hatch",at:saved.hatchedAt,source:"shared"},
      {kind:"meal",at:saved.lastTick,source:"shared"},
    ]};
    await mount();
    await choose(8);
    const panel=()=>document.querySelector(".album-panel");
    expect(panel()?.getAttribute("data-album-page")).toBe("0");
    expect(screen.getByText("我们的纪念册")).toBeTruthy();
    await key("a");expect(panel()?.getAttribute("data-album-page")).toBe("1");
    expect(screen.getByText("小小的初次相遇")).toBeTruthy();
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("2");
    expect(screen.getByText("一份暖暖的小饭团")).toBeTruthy();
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("0");
    await key("c");expect(panel()).toBeNull();expect(scene()).toBe("idle");
    await choose(8);expect(panel()?.getAttribute("data-album-page")).toBe("0");
    expect(document.querySelector(".lcd button")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(api.mock.calls.filter(([path])=>!["state","visit"].includes(path))).toHaveLength(0);
  });
  it("reading while asleep does not wake the pet or generate actions",async()=>{
    saved.sleeping=true;saved.album={since:saved.createdAt,legacy:false,entries:[{kind:"hatch",at:saved.hatchedAt,source:"shared"}]};
    await mount();await choose(8);await key("b");await key("c");
    expect(scene()).toBe("sleeping");expect(saved.sleeping).toBe(true);
    expect(api.mock.calls.some(([path])=>path==="action")).toBe(false);
  });
  it("defers a newly received recap until the album is closed", async () => {
    saved.album={since:saved.createdAt,legacy:false,entries:[{kind:"hatch",at:saved.hatchedAt,source:"shared"}]};
    await mount();await choose(8);
    const snapshot={needs:{...saved.needs},stage:saved.growth!.stage,form:saved.growth!.form,points:0,rest:0,trackedHours:0};
    const recap={id:"after-album",from:Date.now()-3600000,to:Date.now(),before:snapshot,after:snapshot};
    const normal=api.getMockImplementation()!;
    api.mockImplementation(async(path,body)=>({ ...await normal(path,body),returnRecap:recap,recapPending:path!=="recap/read",recapClaimed:path==="recap/read" }));
    await advance(15000);
    expect(document.querySelector(".album-panel")).toBeTruthy();
    expect(api.mock.calls.some(([path])=>path==="recap/read")).toBe(false);
    await key("c");
    expect(screen.getByLabelText("回访小结")).toBeTruthy();
    expect(api.mock.calls.filter(([path])=>path==="recap/read")).toHaveLength(1);
  });
  it("does not auto-open memories on refresh and falls back safely for old servers",async()=>{
    await mount();expect(document.querySelector(".album-panel")).toBeNull();
    await choose(8);expect(screen.getByText(/纪念册尚未开启/)).toBeTruthy();
    await key("a");await key("b");expect(document.querySelector(".album-panel")?.getAttribute("data-album-page")).toBe("0");
    expect(api.mock.calls.some(([path])=>path==="action")).toBe(false);
  });
});
