import { RequestFailure } from "./requestFailure";
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
import { emptyGrowth, growthPageCount } from "./growth";

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
  // The default choice in the play selector remains the star game.
  if (menuIndex === 1) { await key("b"); await key("b"); }
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
    api.mockRejectedValueOnce(new RequestFailure("保存失败，请重试", "rejected"));
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
    await key("b");
    expect(
      document.querySelector(".growth-panel")?.getAttribute("data-growth-page"),
    ).toBe("1");
    expect(document.querySelectorAll("[data-preview-stage]")).toHaveLength(0);
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("2");
    expect(document.querySelector(".form-guide")?.textContent).toContain("成年时按上方顺序确定");
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("3");
    expect(document.querySelector(".companion-panel")).not.toBeNull();
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("4");
    expect(document.querySelector(".growth-time-guide")?.textContent).toContain("每次结算有上限");
    expect(document.querySelector(".growth-time-guide")?.textContent).toContain("多次读取可能累计更多");
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("5");
    expect(document.querySelector(".growth-look-guide")?.textContent).toContain("草莓兔的三阶段");
    await key("b");
    expect(document.querySelector(".growth-panel")?.getAttribute("data-growth-page")).toBe("0");
    expect(document.querySelectorAll("[data-preview-stage]")).toHaveLength(3);
    for (let i = 0; i < growthPageCount; i++) await key("b");
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
    expect(document.querySelector(".growth-feedback")?.textContent).toContain("记录时同类习惯仍在间隔内");
    expect(document.querySelector(".growth-feedback")?.textContent).not.toContain("成长 +");
    await key("c");
    api.mockRejectedValueOnce(new RequestFailure("保存失败", "rejected"));
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
    await key("b");
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
    api.mockRejectedValueOnce(new RequestFailure("保存失败，请重试", "rejected"));
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
  it("A/B browse collected memories in opposite directions, wrap, C returns via directory, reopening resets without mutations", async () => {
    saved.schema=3;
    saved.album={since:saved.createdAt,legacy:false,entries:[
      {kind:"hatch",at:saved.hatchedAt,source:"shared"},
      {kind:"meal",at:saved.lastTick,source:"shared"},
    ]};
    await mount();
    await choose(8);
    expect(document.querySelector("[data-album-directory]")?.getAttribute("data-album-directory")).toBe("all");
    await key("b");
    const panel=()=>document.querySelector(".album-panel");
    expect(panel()?.getAttribute("data-album-page")).toBe("0");
    expect(screen.getByText("我们的纪念册")).toBeTruthy();
    await key("a");expect(panel()?.getAttribute("data-album-page")).toBe("2");
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("0");
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("1");
    expect(screen.getByText("小小的初次相遇")).toBeTruthy();
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("2");
    expect(screen.getByText("一份暖暖的小饭团")).toBeTruthy();
    await key("b");expect(panel()?.getAttribute("data-album-page")).toBe("0");
    await key("c");expect(document.querySelector("[data-album-directory]")).toBeTruthy();
    await key("c");expect(panel()).toBeNull();expect(scene()).toBe("idle");
    await choose(8);expect(document.querySelector("[data-album-directory]")?.getAttribute("data-album-directory")).toBe("all");
    expect(document.querySelector(".lcd button")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(api.mock.calls.filter(([path])=>!["state","visit"].includes(path))).toHaveLength(0);
  });
  it("uses A to select each category, B to enter and C to return without changing locked adulthood", async () => {
    saved.growth=emptyGrowth("adult");saved.growth.form="gentle";
    saved.album={since:saved.createdAt,legacy:true,entries:[
      {kind:"hatch",at:saved.hatchedAt,source:"saved"},
      {kind:"meal",at:saved.lastTick,source:"shared"},
    ]};
    const before=structuredClone(saved);
    await mount();await choose(8);
    for (const category of ["all","growth","care","play","home","days","scenery"]) {
      expect(document.querySelector("[data-album-directory]")?.getAttribute("data-album-directory")).toBe(category);
      expect(document.querySelector('.album-directory [aria-current="true"]')).toBeTruthy();
      await key("b");
      expect(document.querySelector("[data-album-category]")?.getAttribute("data-album-category")).toBe(category);
      expect(document.querySelector("[data-album-page]")?.getAttribute("data-album-page")).toBe("0");
      await key("a");
      if(category==="growth") expect(screen.getByText(/沿用旧存档的相遇日期/)).toBeTruthy();
      if(category==="care") expect(screen.getByText("一份暖暖的小饭团")).toBeTruthy();
      if(["play","home","days"].includes(category)) {
        expect(screen.getByText(/这里还没有留下回忆/)).toBeTruthy();
        expect(document.querySelector("[data-album-page]")?.getAttribute("data-album-page")).toBe("0");
      }
      await key("c");await key("a");
    }
    expect(document.querySelector("[data-album-directory]")?.getAttribute("data-album-directory")).toBe("all");
    await key("c");expect(scene()).toBe("idle");
    expect(saved).toEqual(before);
    expect(api.mock.calls.some(([path])=>!["state","visit"].includes(path))).toBe(false);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  });
  it("reading while asleep does not wake the pet or generate actions",async()=>{
    saved.sleeping=true;saved.album={since:saved.createdAt,legacy:false,entries:[{kind:"hatch",at:saved.hatchedAt,source:"shared"}]};
    await mount();await choose(8);await key("b");await key("c");await key("c");
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

describe("sakura cat stays articulated across the three-button lifecycle", () => {
  it.each(["baby", "growing", "adult"] as const)("keeps %s anatomy through care, sleep, reload and a game", async stage => {
    saved.species = 7;
    saved.name = "樱花喵";
    saved.growth = emptyGrowth(stage);
    saved.growth.points = stage === "baby" ? 12 : stage === "growing" ? 40 : 72;
    if (stage === "adult") saved.growth.form = "gentle";
    saved.needs.hunger = 40;
    await mount();
    expect(document.querySelector(`.pet-scene .cat-${stage}`)).not.toBeNull();
    expect(document.querySelector(".pet-scene")?.getAttribute("data-rig")).toBe("cat");
    expect(document.querySelectorAll(".pet-scene .need-paw")).toHaveLength(2);
    await choose(0);
    expect(document.querySelector(`.cat-${stage}.rig-motion-eating.expression-chewing`)).not.toBeNull();
    expect(document.querySelector(".pet-scene .need-gesture")).toBeNull();
    await key("c");
    await choose(3);
    expect(document.querySelector(`.cat-${stage}.rig-motion-sleeping.expression-asleep`)).not.toBeNull();
    cleanup();
    await mount();
    expect(scene()).toBe("sleeping");
    expect(document.querySelector(".pet-scene .need-gesture")).toBeNull();
    await choose(3);
    expect(document.querySelector(`.cat-${stage}.rig-motion-waking`)).not.toBeNull();
    await key("c");
    await choose(1);
    expect(document.querySelector(`.game-lane .cat-${stage}`)).not.toBeNull();
    expect(document.querySelector(".content-game .need-gesture")).toBeNull();
    cleanup();
    await mount();
    expect(document.querySelector(`.game-lane .cat-${stage}`)).not.toBeNull();
    expect(saved.growth.stage).toBe(stage);
    expect(saved.growth.form).toBe(stage === "adult" ? "gentle" : "");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
  });

  it("reads the same cat stage art in handbook and permanent memories without care requests", async () => {
    saved.species = 7;
    saved.name = "樱花喵";
    saved.schema = 3;
    saved.growth = { ...emptyGrowth("adult"), points: 72, form: "gentle" };
    saved.album = { since: saved.hatchedAt, legacy: false, entries: [
      { kind: "hatch", at: saved.hatchedAt, source: "shared" },
      { kind: "growing", at: saved.hatchedAt + 1000, source: "shared" },
      { kind: "adult", at: saved.hatchedAt + 2000, source: "shared", form: "gentle" },
    ] };
    const before = structuredClone(saved);
    await mount();
    await choose(6);
    for (const stage of ["baby", "growing", "adult"]) {
      expect(document.querySelector(`.growth-preview.growth-${stage} .has-cat-rig .cat-${stage}`)).not.toBeNull();
    }
    await key("c");
    await choose(8);await key("b");
    expect(document.querySelector(".album-panel .cat-adult")).not.toBeNull();
    for (const stage of ["baby", "growing", "adult"]) {
      await key("b");
      expect(document.querySelector(`.album-panel .cat-${stage}`)).not.toBeNull();
    }
    await key("c");await key("c");
    expect(scene()).toBe("idle");
    expect(saved).toEqual(before);
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button")).toBeNull();
  });
});

describe("three-key shop and persistent equipment", () => {
  const shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [
    { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory" as const, price: 12, description: "把春天别在胸前。" },
    { id: "clover-pot", name: "四叶草盆栽", slot: "room" as const, price: 16, description: "一起回家。" },
    { id: "meadow-wall", name: "小叶墙纸", slot: "wallpaper" as const, price: 18, description: "独立的墙纸。" },
    { id: "mint-floor", name: "薄荷方砖", slot: "floor" as const, price: 22, description: "独立的地板。" },
  ] };
  function setup(coins = 30) {
    saved.schema = 4;
    saved.economy = { coins, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } };
    saved.album = { since: saved.createdAt, legacy: false, entries: [{ kind: "hatch", at: saved.hatchedAt, source: "shared" }] };
    api.mockImplementation(async (path, body) => {
      if (path === "action") {
        const action = body as { kind: string; item?: string };
        const e = saved.economy!;
        if (action.kind === "play") saved.game = { id: "0123456789abcdef0123456789abcdef", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
        if (action.kind === "daily") { e.coins += 10; e.lastDailyAt = Date.now(); }
        if (action.kind === "buy") { const item = shop.catalog.find(i => i.id === action.item)!; e.coins -= item.price; e.owned.push(item.id); }
        if (action.kind === "equip") { const item = shop.catalog.find(i => i.id === action.item)!; e.equipped[item.slot] = e.equipped[item.slot] === item.id ? "" : item.id; }
        saved.revision++;
      }
      return { ...state(), shop };
    });
  }
  const mutations = () => api.mock.calls.filter(([p]) => p === "action");
  it("reaches the appended menu item, claims once, and does not auto-claim on reload", async () => {
    setup(0);
    await mount();
    await choose(9);
    expect(document.querySelector(".care-menu")).toBeNull();
    expect(screen.getByLabelText("小窝商店")).toBeTruthy();
    expect(document.querySelector(".lcd button")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(mutations()).toHaveLength(0);
    await key("b");
    expect(saved.economy!.coins).toBe(10);
    expect(screen.getByText("今日已领取 · 不必连续来")).toBeTruthy();
    await key("b");
    expect(mutations()).toHaveLength(1);
    cleanup();
    await mount();
    await choose(9);
    expect(screen.getByText("今日已领取 · 不必连续来")).toBeTruthy();
    expect(mutations()).toHaveLength(1);
  });
  it("previews without a write, requires confirmation, A/C cancel in place, B buys once", async () => {
    setup(); await mount(); await choose(9); await key("a"); await key("b");
    expect(document.querySelector('.shop-preview [data-item="leaf-pin"]')).not.toBeNull();
    expect(saved.economy!.equipped.accessory).toBe("");
    expect(mutations()).toHaveLength(0);
    await key("b");
    expect(screen.getByText("确认花 12 金币购买「嫩叶胸针」？")).toBeTruthy();
    await key("a");
    expect(document.querySelector('.shop-panel')?.getAttribute('data-shop-page')).toBe("0");
    await key("b"); await key("c");
    expect(document.querySelector('.shop-panel')?.getAttribute('data-confirm')).toBe("false");
    expect(mutations()).toHaveLength(0);
    await key("b"); await key("b");
    expect(saved.economy!.coins).toBe(18);
    expect(saved.economy!.owned).toEqual(["leaf-pin"]);
    expect(saved.economy!.equipped.accessory).toBe("");
    expect(mutations()).toHaveLength(1);
    expect((mutations()[0][1] as { item: string }).item).toBe("leaf-pin");
    expect(document.querySelector('.shop-panel')?.getAttribute('data-confirm')).toBe("false");
    await key("b"); // Equip, not repurchase.
    expect(saved.economy!.equipped.accessory).toBe("leaf-pin");
    expect(saved.economy!.coins).toBe(18);
    await key("c"); await key("c");
    expect(document.querySelector('.pet-scene .equipped-accessory[data-item="leaf-pin"]')).not.toBeNull();
    expect(document.querySelector('.pet-scene .growth-outfit')).toBeNull();
    cleanup(); await mount();
    expect(document.querySelector('.pet-scene .equipped-accessory[data-item="leaf-pin"]')).not.toBeNull();
    await choose(9); await key("a"); await key("b"); await key("b"); await key("c"); await key("c");
    expect(saved.economy!.equipped.accessory).toBe("");
    expect(document.querySelector('.pet-scene .growth-outfit')).not.toBeNull();
  });
  it("places owned home items without a second charge and keeps equipment in the star game", async () => {
    setup();
    saved.economy!.owned = ["leaf-pin", "clover-pot"];
    saved.economy!.equipped.accessory = "leaf-pin";
    await mount(); await choose(9); await key("a"); await key("b"); await key("a"); await key("b");
    expect(saved.economy!.equipped.room).toBe("clover-pot");
    expect(saved.economy!.coins).toBe(30);
    await key("c"); await key("c");
    expect(document.querySelector('.pet-scene .room-decoration[data-item="clover-pot"]')).not.toBeNull();
    await choose(1);
    // The action response persists the session before entering the game.
    await advance(15000);
    expect(document.querySelector('.game-lane .equipped-accessory[data-item="leaf-pin"]')).not.toBeNull();
  });
  it("does not offer a purchase or send an action when coins are insufficient", async () => {
    setup(0); await mount(); await choose(9); await key("a"); await key("b"); await key("b");
    expect(screen.getByText("还差 12 金币，慢慢来。")).toBeTruthy();
    expect(document.querySelector('.shop-panel')?.getAttribute('data-confirm')).toBe("false");
    expect(mutations()).toHaveLength(0);
  });
  it("allows only read-only browsing during sleep, with no wake or game interruption", async () => {
    setup(); saved.sleeping = true; await mount(); await choose(9);
    await key("b"); await key("a"); await key("b");
    expect(saved.sleeping).toBe(true);
    expect(mutations()).toHaveLength(0);
    expect(document.querySelector('.shop-panel')?.getAttribute('data-confirm')).toBe("false");
    await key("b"); await key("c"); await key("c"); expect(scene()).toBe("sleeping");
  });
  it("keeps a failed purchase on its confirmation screen without pretending ownership", async () => {
    setup(); await mount(); await choose(9); await key("a"); await key("b"); await key("b");
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (path, body) => {
      if (path === "action") throw new RequestFailure("金币还不够，慢慢来，不着急", "rejected");
      return original(path, body);
    });
    await key("b");
    expect(saved.economy!.owned).toEqual([]);
    expect(saved.economy!.coins).toBe(30);
    expect(document.querySelector('.shop-panel')?.getAttribute('data-confirm')).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("金币还不够");
    await key("c"); await key("c"); await key("c"); expect(scene()).toBe("idle");
  });
  it("navigates an empty owned filter using only three keys and C returns to its category", async () => {
    setup(); await mount(); await choose(9);
    for (let i = 0; i < 7; i++) await key("a");
    await key("b");
    expect(screen.getByText("这里还空着呢")).toBeTruthy();
    await key("a"); await key("b");
    expect(mutations()).toHaveLength(0);
    expect(document.querySelector('.shop-panel')?.getAttribute('data-shop-category')).toBe("owned");
    await key("c");
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("已拥有");
    await key("a");
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("今日问候");
    await key("c"); expect(scene()).toBe("idle");
  });
  it("buys and toggles independent surfaces from categories/owned, preserving other gear through reload", async () => {
    setup(100); saved.economy!.owned = ["leaf-pin", "clover-pot"];
    saved.economy!.equipped = { accessory: "leaf-pin", room: "clover-pot" };
    const growth = structuredClone(saved.growth);
    await mount(); await choose(9);
    for (let i = 0; i < 5; i++) await key("a");
    await key("b");
    expect(document.querySelector('.shop-preview [data-item="meadow-wall"]')).not.toBeNull();
    expect(saved.economy!.equipped.wallpaper).toBeUndefined();
    expect(mutations()).toHaveLength(0);
    await key("b"); await key("b");
    expect(saved.economy!.coins).toBe(82);
    expect(saved.economy!.equipped.wallpaper).toBeUndefined();
    await key("b");
    expect(saved.economy!.equipped.wallpaper).toBe("meadow-wall");
    await key("c"); await key("a"); await key("b");
    expect(document.querySelector('.shop-preview [data-item="meadow-wall"]')).not.toBeNull();
    expect(document.querySelector('.shop-preview [data-item="mint-floor"]')).not.toBeNull();
    await key("b"); await key("b"); await key("b");
    expect(saved.economy!.coins).toBe(60);
    expect(saved.economy!.equipped).toEqual({ accessory: "leaf-pin", room: "clover-pot", wallpaper: "meadow-wall", floor: "mint-floor" });
    await key("c"); await key("a"); await key("b");
    expect(document.querySelector('.shop-panel')?.getAttribute('data-shop-category')).toBe("owned");
    await key("a"); await key("a"); await key("b");
    expect(saved.economy!.equipped.wallpaper).toBe("");
    expect(saved.economy!.equipped.floor).toBe("mint-floor");
    expect(saved.economy!.coins).toBe(60);
    expect(saved.growth).toEqual(growth);
    await key("c"); await key("c"); cleanup(); await mount();
    expect(document.querySelector('.pet-scene .surface-mint-floor')).not.toBeNull();
    expect(document.querySelector('.pet-scene .surface-meadow-wall')).toBeNull();
    expect(document.querySelector('.pet-scene .room-decoration')).not.toBeNull();
    expect(document.querySelectorAll('.physical-button')).toHaveLength(3);
    expect(document.querySelectorAll('.lcd button, .lcd [role="button"]')).toHaveLength(0);
  });
  it("does not break older service responses or silently fabricate a wallet", async () => {
    await mount(); await choose(9);
    expect(screen.getByText("小店还没开门，请更新服务后再来看看。")).toBeTruthy();
    await key("b");
    expect(mutations()).toHaveLength(0);
    await key("c"); expect(scene()).toBe("idle");
  });
});

describe("shop event precedence", () => {
  it("defers a newly settled evolution and pending return recap until after leaving the shop", async () => {
    const shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [] };
    saved.schema = 4;
    saved.economy = { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } };
    api.mockImplementation(async () => ({ ...state(), shop }));
    await mount(); await choose(9);
    const before = saved.revision;
    saved.growth = emptyGrowth("growing"); saved.growth.points = 24; saved.growth.growingAt = Date.now(); saved.revision++;
    const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 23, rest: 0, trackedHours: 0 };
    const recap = { id: "shop-return", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: { ...snapshot, stage: "growing" as const, points: 24 } };
    api.mockImplementation(async (path) => ({ ...state(), shop, returnRecap: recap, recapPending: path !== "recap/read", recapClaimed: path === "recap/read" }));
    await advance(15000);
    expect(saved.revision).toBeGreaterThan(before);
    expect(document.querySelector(".shop-panel")).not.toBeNull();
    expect(api.mock.calls.some(([p]) => p === "recap/read")).toBe(false);
    await key("c");
    expect(scene()).toBe("celebrating");
    expect(document.querySelector(".return-panel")).toBeNull();
    await key("c");
    expect(api.mock.calls.filter(([p]) => p === "recap/read")).toHaveLength(1);
    expect(document.querySelector(".return-panel")).not.toBeNull();
  });
});

describe("server-owned game sessions", () => {
  it("sends the saved session identity with catches and cancellation", async () => {
    saved.game = { id: "saved-session-identity", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1 };
    await mount(); await key("b"); await key("c"); await key("b");
    const calls = api.mock.calls.filter(([p]) => p === "action").map(([, b]) => b as { kind: string; gameId: string });
    expect(calls.map(c => c.kind)).toEqual(["catch", "cancel-play"]);
    expect(calls.every(c => c.gameId === "saved-session-identity")).toBe(true);
  });
});

describe("real completed-game home echoes", () => {
  const id="0123456789abcdef0123456789abcdef";
  async function finalStar(options: {feedback?:boolean; mismatch?:boolean; hungry?:boolean; responseGate?:Promise<void>; failure?:boolean} = {}) {
    saved.game={id,startedAt:Date.now()-4500,round:4,score:3,lastBeat:3};
    if(options.hungry)saved.needs.hunger=20;
    saved.companion={since:saved.createdAt,interests:["stars","tiles","snake","tetris","fishing"].map(kind=>({kind:kind as "stars",points:0,lastAt:0}))};
    api.mockImplementation(async(path,body)=>{
      if(path==='action' && (body as {kind:string}).kind==='catch'){
        await options.responseGate;
        if (options.failure) throw new RequestFailure("network unavailable", "unknown");
        saved.game=undefined;saved.revision++;saved.careCount++;
        saved.companion!.interests[0]={kind:"stars",points:1,lastAt:Date.now()};
        saved.companion!.recent={kind:"stars",id:options.mismatch?'different-session':id,at:Date.now()};
        return {...state(),careFeedback:options.feedback===false?undefined:{kind:"catch" as const,points:.25,habit:"play" as const,habitGain:1,reason:"credited" as const}};
      }
      return state();
    });
    await mount();await key('b');
  }
  it("responds after a real local settlement, expires, and never replays on refresh",async()=>{
    await finalStar();expect(scene()).toBe('celebrating');
    expect(document.querySelector('.home-game-token')).toBeNull();
    await advance(1500);expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    expect(document.querySelectorAll('.physical-button')).toHaveLength(3);
    expect(document.querySelectorAll('.lcd button')).toHaveLength(0);
    const writes=api.mock.calls.filter(([p])=>p==='action').length;
    await advance(10500);expect(document.querySelector('.home-game-token')).toBeNull();
    cleanup();await mount();await advance(15000);
    expect(document.querySelector('.home-game-token')).toBeNull();
    expect(api.mock.calls.filter(([p])=>p==='action')).toHaveLength(writes);
    expect(saved.companion!.interests[0].points).toBe(1);
  });
  it.each(["baby", "growing", "adult"] as const)("keeps the %s home echo on its original monotonic deadline across local date changes", async stage => {
    saved.growth = emptyGrowth(stage);
    await finalStar();
    const recent = structuredClone(saved.companion!.recent);
    const wallStart = Date.now();
    const writes = () => api.mock.calls.filter(([path]) => path === "action").length;
    expect(writes()).toBe(1);
    await advance(1500);
    expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    // Wall-clock changes alone do not advance the local visual timeout.
    for (const days of [7, -7, 0]) {
      vi.setSystemTime(wallStart + days * 86400000);
      await advance(1000);
      expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    }
    await advance(7499); // 11,999ms since the acknowledged settlement, not since the clip ended.
    expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    await advance(1);
    expect(document.querySelector('.home-game-token')).toBeNull();
    vi.setSystemTime(wallStart - 7 * 86400000);
    await advance(1000);
    expect(document.querySelector('.home-game-token')).toBeNull();
    expect(saved.companion!.recent).toEqual(recent);
    expect(writes()).toBe(1);
  });
  it.each([-7, 7])("preserves the original echo deadline when the clock jumps %s days during celebration", async days => {
    await finalStar();
    const recent = structuredClone(saved.companion!.recent);
    vi.setSystemTime(Date.now() + days * 86400000);
    await advance(1500);
    expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    await advance(10499);
    expect(document.querySelector('[data-echo="stars"]')).not.toBeNull();
    await advance(1);
    expect(document.querySelector('.home-game-token')).toBeNull();
    expect(saved.companion!.recent).toEqual(recent);
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(1);
  });
  it.each([{feedback:false},{mismatch:true},{hungry:true}])("does not fabricate an echo or cover needs: %j",async options=>{
    await finalStar(options);await advance(1500);expect(document.querySelector('.home-game-token')).toBeNull();
  });
  it("leaving home consumes the transient response without replay on return",async()=>{
    await finalStar();await advance(1500);expect(document.querySelector('.home-game-token')).not.toBeNull();
    await key('a');await key('c');expect(scene()).toBe('idle');expect(document.querySelector('.home-game-token')).toBeNull();
  });
  it("C skips both the celebration and its pending echo",async()=>{
    await finalStar();await key('c');expect(scene()).toBe('idle');expect(document.querySelector('.home-game-token')).toBeNull();
  });
  it.each([false, true])("does not queue an in-flight response across backgrounding (return first: %s)", async returnFirst => {
    let release!: () => void;
    const responseGate = new Promise<void>(resolve => { release = resolve; });
    await finalStar({ responseGate });
    const visibility = async (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    };
    try {
      await visibility(true);
      if (returnFirst) await visibility(false);
      await act(async () => { release(); });
      if (!returnFirst) await visibility(false);
      await advance(1500);
      expect(document.querySelector(".home-game-token")).toBeNull();
      expect(saved.companion!.interests[0].points).toBe(1);
    } finally {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
    }
  });
  it("a failed settlement cannot fabricate a saved experience or home response", async () => {
    await finalStar({ failure: true });
    await advance(1500);
    expect(saved.game?.id).toBe(id);
    expect(saved.companion!.recent).toBeUndefined();
    expect(saved.companion!.interests[0].points).toBe(0);
    expect(document.querySelector(".home-game-token")).toBeNull();
  });
  it("backgrounding discards rather than queues an echo",async()=>{
    await finalStar();await advance(1500);
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'))});
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'))});
    expect(document.querySelector('.home-game-token')).toBeNull();
  });
});

describe("quiet companion moments", () => {
  it("keeps all three bedside interactions asleep and read-only, including saved memories", async () => {
    saved.sleeping = true;
    saved.album = { since: saved.lastTick - 1000, legacy: false, entries: [
      { kind: "meal", at: saved.lastTick - 1000, source: "shared" },
    ] };
    const before = structuredClone(saved);
    await mount(); await choose(12);
    for (const title of ["轻轻摸摸", "守着它睡", "轻声道晚安"]) {
      expect(screen.getByText(title)).toBeTruthy();
      expect(document.querySelector(".quiet-moment .expression-asleep.rig-motion-sleeping")).toBeTruthy();
      expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 安静陪着");
      await key("b"); await key("b");
      expect(document.querySelector(".quiet-memory-source")).toBeNull();
      expect(document.querySelector(".quiet-moment .expression-asleep.rig-motion-sleeping")).toBeTruthy();
      expect(document.querySelector(".quiet-moment")?.textContent).not.toMatch(/抬起头|你好呀|眨了眨眼/);
      expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
      expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
      await key("a");
    }
    await key("c");
    expect(scene()).toBe("sleeping");
    expect(saved).toEqual(before);
    expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  });

  it("clears a conversation on synchronized sleep/wake without replaying its old reply", async () => {
    saved.album = { since: saved.lastTick - 1000, legacy: false, entries: [
      { kind: "meal", at: saved.lastTick - 1000, source: "shared" },
    ] };
    await mount(); await choose(12); await key("a"); await key("a"); await key("b");
    expect(document.querySelector(".quiet-memory-source")).not.toBeNull();
    const syncSleep = async (sleeping: boolean) => {
      saved.sleeping = sleeping; saved.revision++;
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    };
    await syncSleep(true);
    expect(screen.getByText("轻声道晚安")).toBeTruthy();
    expect(document.querySelector(".quiet-moment")?.getAttribute("data-replied")).toBe("false");
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    await key("b");
    const reading = screen.getByRole("region", { name: "无目的互动阅读区" });
    reading.focus();
    await syncSleep(true);
    expect(document.querySelector(".quiet-moment")?.getAttribute("data-replied")).toBe("true");
    await syncSleep(false);
    expect(screen.getByText("说声你好")).toBeTruthy();
    expect(document.querySelector(".quiet-moment")?.getAttribute("data-replied")).toBe("false");
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 聊聊回忆");
    await act(async () => { fireEvent.keyDown(reading, { key: "Enter" }); });
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("一份暖暖的小饭团");
    expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  });

  it("offers a no-pressure A/B/C interaction without writing or changing the save", async () => {
    await mount();
    await choose(12);
    expect(document.querySelector(".quiet-moment")).toBeTruthy();
    expect(screen.getByText("摸摸它")).toBeTruthy();
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    const before = structuredClone(saved);
    await key("b");
    expect(screen.getByText("它眨了眨眼，把这份温柔收好了。")).toBeTruthy();
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    expect(saved).toEqual(before);
    await key("a");
    expect(screen.getByText("陪它发呆")).toBeTruthy();
    expect(screen.getByText("和它一起安静待一会儿，谁也不用急。")).toBeTruthy();
    await key("c");
    expect(document.querySelector(".content-home")).toBeTruthy();
  });
  it("chats in both directions, returns with C, and leaves the save untouched", async () => {
    const at = saved.lastTick - 3000;
    saved.album = { since: at, legacy: false, entries: [
      { kind: "hatch", at, source: "saved" },
      { kind: "meal", at: at + 1000, source: "shared" },
      { kind: "walk", at: at + 2000, source: "shared" },
    ] };
    const before = structuredClone(saved);
    await mount(); await choose(12); await key("a"); await key("a");
    expect(screen.getByText("说声你好")).toBeTruthy();
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 聊聊回忆");
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("公园里走过的第一条小路");
    expect(screen.getByText(/还记得一起走过的小路/)).toBeTruthy();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 下一段");
    const reading = screen.getByRole("region", { name: "无目的互动阅读区" });
    reading.focus();
    await act(async () => { fireEvent.keyDown(reading, { key: "Enter" }); });
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("公园里走过的第一条小路");
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("一份暖暖的小饭团");
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("公园里走过的第一条小路");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a")).toBeNull();
    await key("a");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("一份暖暖的小饭团");
    await key("c"); await key("a");
    expect(screen.getByText("摸摸它")).toBeTruthy();
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    await key("a"); await key("a"); await key("b"); await key("c"); await key("c");
    await choose(12);
    expect(screen.getByText("摸摸它")).toBeTruthy();
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(saved).toEqual(before);
    expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  });

  it("keeps the selected memory across synchronization, explains removal, and clears on pet replacement", async () => {
    const at = saved.lastTick - 3000;
    saved.album = { since: at, legacy: false, entries: [{ kind: "meal", at, source: "shared" }] };
    await mount(); await choose(12); await key("a"); await key("a"); await key("b");
    const sync = async () => {
      saved.revision++;
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    };
    saved.album.entries.push({ kind: "walk", at: at + 1000, source: "shared" });
    await sync();
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("一份暖暖的小饭团");
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("公园里走过的第一条小路");
    saved.album.entries = saved.album.entries.filter(m => m.kind !== "walk");
    await sync();
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(screen.getByText(/这段回忆已不在当前读取的记录里/)).toBeTruthy();
    await key("b");
    expect(document.querySelector(".quiet-memory-source")?.textContent).toContain("一份暖暖的小饭团");
    saved.createdAt--; saved.hatchedAt--; saved.album.entries = [];
    await sync();
    expect(document.querySelector(".content-home")).toBeTruthy();
    await choose(12); await key("a"); await key("a"); await key("b");
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(screen.getByText("它摇了摇身子：你好呀，我一直在这里。")).toBeTruthy();
    expect(api.mock.calls.every(([path]) => path === "state" || path === "visit")).toBe(true);
  });

  it("keeps the original greeting for old saves without shared album entries", async () => {
    saved.album = { since: saved.lastTick - 100, legacy: true, entries: [
      { kind: "hatch", at: saved.lastTick - 100, source: "saved" },
      { kind: "days", at: saved.lastTick, source: "elapsed", days: 7 },
    ] };
    await mount(); await choose(12); await key("a"); await key("a"); await key("b");
    expect(screen.getByText("它摇了摇身子：你好呀，我一直在这里。")).toBeTruthy();
    expect(document.querySelector(".quiet-memory-source")).toBeNull();
    expect(document.querySelector(".lcd-bottom")?.textContent).toContain("B 陪一会儿");
  });

});

describe("keyboard reading and focus safety", () => {
  it("prevents native repeated activation on the three physical keys", async () => {
    await mount();
    const button = screen.getByRole("button", { name: "B 确认" }); button.focus();
    for (const value of ["Enter", " ", "a", "b", "c", "ArrowDown"]) {
      const event = new KeyboardEvent("keydown", { key: value, repeat: true, bubbles: true, cancelable: true });
      await act(async () => { button.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    expect(document.querySelector(".care-menu")).toBeNull();
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    await key("b"); expect(document.querySelector(".care-menu")).not.toBeNull();
    expect(document.querySelector('[aria-current="true"].care-item')?.textContent).toContain("吃点东西");
  });
  it("keeps help focus inside its dialog and restores the machine C key on escape", async () => {
    await mount();
    const trigger = screen.getByRole("button", { name: "玩法说明" }); trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    const close = screen.getByRole("button", { name: /^关闭$/ });
    expect(document.activeElement).toBe(close);
    await act(async () => { fireEvent.keyDown(close, { key: "Tab", shiftKey: true }); });
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Tab" }); });
    expect(document.activeElement).toBe(close);
    await act(async () => { fireEvent.keyDown(close, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(document.querySelector(".physical-button.button-c"));
    expect(document.querySelector(".care-menu")).toBeNull();
  });
  it("opts reading pages into reflow without adding LCD buttons", async () => {
    await mount(); expect(document.querySelector(".device-stage.reading-mode")).not.toBeNull();
    await choose(6);
    expect(document.querySelector(".device-stage.reading-mode")).not.toBeNull();
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    await key("c"); expect(scene()).toBe("idle");
  });
});

describe("reset focus restoration", () => {
  it("returns to the machine C key after closing reset confirmation", async () => {
    await mount();
    const tools = screen.getByRole("button", { name: /存档盒/ });
    await act(async () => { fireEvent.click(tools); });
    const reset = screen.getByRole("button", { name: /重新开始/ }); reset.focus();
    await act(async () => { fireEvent.click(reset); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(document.querySelector(".physical-button.button-c"));
    expect(api.mock.calls.filter(([path]) => path === "reset")).toHaveLength(0);
  });

  it("shows the shared history that reset would remove before confirmation", async () => {
    const at = Date.now() - 2 * 86400000;
    saved.hatchedAt = at;
    saved.logs = [
      { at, text: "第一条" },
      { at: at + 1, text: "第二条" },
      { at: at + 2, text: "第三条" },
    ];
    saved.album = { since: at, legacy: false, entries: [
      { kind: "hatch", at, source: "shared" },
      { kind: "meal", at: at + 1, source: "shared" },
    ] };
    saved.pond = { since: at, fish: [{ id: "sun-carp", firstAt: at, lastAt: at, count: 2 }] };
    saved.park = { since: at, finds: [{ id: "leaf", firstAt: at, lastAt: at, count: 1 }], walks: 1, lastWalkAt: at };
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /重新开始/ })); });
    const summary = screen.getByRole("region", { name: "重新开始会清除的共同经历" });
    expect(summary.textContent).toContain("3 天");
    expect(summary.textContent).toContain("成长日记");
    expect(summary.textContent).toContain("3 条");
    expect(summary.textContent).toContain("永久纪念册");
    expect(summary.textContent).toContain("2 条");
    expect(summary.textContent).toContain("鱼图鉴");
    expect(summary.textContent).toContain("1 / 6");
    expect(summary.textContent).toContain("沿途发现");
    expect(summary.textContent).toContain("1 / 6");
    await key("c");
    expect(api.mock.calls.filter(([path]) => path === "reset")).toHaveLength(0);
  });

  it("keeps reset preview readable when a legacy album has a nil entries slice", async () => {
    saved.album = { since: Date.now(), legacy: false, entries: null } as unknown as PetState["album"];
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /重新开始/ })); });
    const summary = screen.getByRole("region", { name: "重新开始会清除的共同经历" });
    expect(summary.textContent).toContain("永久纪念册");
    expect(summary.textContent).toContain("0 条");
    expect(api.mock.calls.filter(([path]) => path === "reset")).toHaveLength(0);
  });

  it("lets C cancel reset confirmation without changing the save", async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /重新开始/ })); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await key("c");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.mock.calls.filter(([path]) => path === "reset")).toHaveLength(0);
    expect(saved.name).toBe("草莓兔");
  });

  it("keeps the hidden backup input out of the tab order while the save box is closed", async () => {
    await mount();
    const input = screen.getByLabelText("导入存档文件") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.tabIndex).toBe(-1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); });
    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(0);
  });

  it("keeps A/B/C shortcuts active while an ordinary external button has focus", async () => {
    await mount();
    await key("a");
    const tools = screen.getByRole("button", { name: /存档盒/ });
    tools.focus();
    await key("c");
    expect(document.querySelector(".care-menu")).toBeNull();
    expect(document.querySelector(".physical-button.button-c")).toBeTruthy();
  });
});
