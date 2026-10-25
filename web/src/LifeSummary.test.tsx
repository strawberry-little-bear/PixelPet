import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LifeSummary, lifeSummary } from "./LifeSummary";
import { emptyGrowth } from "./growth";
import type { PetState } from "./types";

afterEach(cleanup);

const created = Date.UTC(2026, 9, 20, 4);
const day = 86400000;
const pet = (): PetState => ({
  schema: 18, revision: 1, species: 2, name: "草莓兔",
  createdAt: created, hatchedAt: created, lastTick: created,
  needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
  sleeping: false, careCount: 2, logs: [], growth: emptyGrowth("baby"),
});

describe("shared life summary", () => {
  // The live clock is the saved server epoch plus a fractional performance.now()
  // delta, so "now" is almost never an integer. It is still a real instant and
  // has to count days; requiring a safe integer here silently erased the count.
  it("counts days from a fractional live clock", () => {
    expect(lifeSummary(pet(), created + 0.5).daysTogether).toBe(1);
    expect(lifeSummary(pet(), created + day + 0.4).daysTogether).toBe(2);
    expect(lifeSummary(pet(), created + 9 * day + 0.999).daysTogether).toBe(10);
  });

  it("shows the day count instead of the placeholder for a live clock", () => {
    render(<LifeSummary pet={pet()} now={created + 2 * day + 0.75} />);
    const first = document.querySelector(".life-summary-grid > div > strong");
    expect(first?.textContent).toBe("3");
    expect(document.querySelector(".life-summary-grid")?.textContent).not.toContain("—");
  });

  it("still falls back when the saved start time is unusable", () => {
    const broken = { ...pet(), hatchedAt: 0 };
    expect(lifeSummary(broken, created).daysTogether).toBeNull();
    render(<LifeSummary pet={broken} now={created} />);
    expect(document.querySelector(".life-summary-grid")?.textContent).toContain("—");
  });

  it("never shows a negative day count when the clock runs behind the save", () => {
    expect(lifeSummary(pet(), created - 5 * day).daysTogether).toBe(1);
  });

  it.each([0.5, day - 0.5, day + 0.5, 9 * day + 0.5])(
    "counts from hatching even when the egg waited a week (%s ms)", elapsed => {
      const current = { ...pet(), hatchedAt: created + 7 * day };
      const before = structuredClone(current);
      expect(lifeSummary(current, current.hatchedAt + elapsed).daysTogether)
        .toBe(Math.floor(elapsed / day) + 1);
      expect(current).toEqual(before);
    },
  );

  it("renders the first shared day after a delayed hatch", () => {
    const current = { ...pet(), hatchedAt: created + 7 * day };
    render(<LifeSummary pet={current} now={current.hatchedAt + 0.75} />);
    expect(document.querySelector(".life-summary-grid > div > strong")?.textContent).toBe("1");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, created + 0.5, 8.64e15 + 1])(
    "does not substitute the egg creation date for an unusable hatch time (%s)", hatchedAt => {
      expect(lifeSummary({ ...pet(), hatchedAt }, created + day).daysTogether).toBeNull();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 8.64e15 + 1])(
    "does not invent shared days from an unusable live clock (%s)", now => {
      expect(lifeSummary(pet(), now).daysTogether).toBeNull();
    },
  );

  it("shows the most familiar game as a read-only adult-life thread", () => {
    const current = {
      ...pet(),
      companion: {
        since: created,
        interests: [
          { kind: "fishing" as const, points: 3, lastAt: created },
          { kind: "walk" as const, points: 1, lastAt: created },
        ],
      },
    };
    const before = structuredClone(current);
    const summary = lifeSummary(current, created + day);
    expect(summary.interestProgress).toEqual({ titles: ["池塘钓鱼"], points: 3 });
    const { container } = render(<LifeSummary pet={current} now={created + day} />);
    expect(container.querySelector(".life-summary-interest")?.textContent).toContain("池塘钓鱼 · 熟悉度 3 / 5");
    expect(container.querySelector(".life-summary-interest")?.textContent).toContain("只读记录");
    expect(current).toEqual(before);
  });

  it("describes tied familiar games without picking one", () => {
    const current = {
      ...pet(),
      companion: {
        since: created,
        interests: [
          { kind: "fishing" as const, points: 4, lastAt: created },
          { kind: "walk" as const, points: 4, lastAt: created },
        ],
      },
    };
    const { container } = render(<LifeSummary pet={current} now={created + day} />);
    expect(container.querySelector(".life-summary-interest")?.textContent).toContain("熟悉的游戏不止一种");
    expect(container.querySelector(".life-summary-interest")?.textContent).toContain("最高熟悉度 4 / 5");
  });

  it("does not turn low or invalid interests into a false preference", () => {
    const current = {
      ...pet(),
      companion: {
        since: created,
        interests: [
          { kind: "fishing" as const, points: 1, lastAt: created },
          { kind: "walk" as const, points: -1, lastAt: created },
          { kind: "tiles" as const, points: 6, lastAt: created },
          { kind: "snake" as const, points: 2.5, lastAt: created },
          { kind: "unknown" as "tiles", points: 5, lastAt: created },
        ],
      },
    };
    const summary = lifeSummary(current, created + day);
    expect(summary.interestProgress).toBeNull();
    const { container } = render(<LifeSummary pet={current} now={created + day} />);
    expect(container.querySelector(".life-summary-interest")).toBeNull();
    expect(container.textContent).not.toContain("NaN");
  });

  it("shows current comfort as a read-only snapshot", () => {
    const current = pet();
    current.needs = { hunger: 100, mood: 80, clean: 60, energy: 40 };
    const before = structuredClone(current);
    expect(lifeSummary(current, created).currentComfort).toBe(70);
    const { container } = render(<LifeSummary pet={current} now={created} />);
    expect(container.querySelector("[data-current-comfort]")?.textContent).toBe("70.0%");
    expect(container.querySelector(".life-summary-comfort")?.textContent).toContain("不是任务、成长点或奖励目标");
    expect(current).toEqual(before);
  });

  it.each([
    { hunger: 0, mood: 0, clean: 100, energy: 100 },
    { hunger: 0.01, mood: 0, clean: 0, energy: 0 },
  ])("keeps comfort within the accepted 0–100 range", needs => {
    const current = { ...pet(), needs };
    expect(lifeSummary(current, created).currentComfort).toBe(
      (needs.hunger + needs.mood + needs.clean + needs.energy) / 4,
    );
  });

  it.each([
    { hunger: Number.NaN, mood: 80, clean: 80, energy: 80 },
    { hunger: 101, mood: 80, clean: 80, energy: 80 },
    { hunger: 80, mood: 80, clean: 80 } as unknown as PetState["needs"],
  ])("does not invent comfort for an invalid live state", needs => {
    const current = { ...pet(), needs };
    expect(lifeSummary(current, created).currentComfort).toBeNull();
    const { container } = render(<LifeSummary pet={current} now={created} />);
    expect(container.querySelector("[data-current-comfort]")?.textContent).toBe("当前状态暂未读到");
    expect(container.querySelector("[data-current-comfort]")?.textContent).not.toContain("NaN");
  });
});

describe("saved shared-game completion counts", () => {
  const kinds = ["stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure"] as const;
  const trackedPet = (): PetState => ({
    ...pet(), schema: 19, lastTick: created + day,
    companion: { since: created, interests: [], history: {
      since: created + 60000,
      completions: kinds.map((kind, i) => ({ kind, count: i + 1 })),
    } },
  });

  it("shows all seven saved counts separately from one-time memories and familiarity", () => {
    const current = trackedPet();
    current.companion!.interests = [{ kind: "stars", points: 5, lastAt: created }];
    const before = structuredClone(current);
    const { container } = render(<LifeSummary pet={current} now={created + day + 0.5} />);
    kinds.forEach((kind, i) => {
      expect(container.querySelector(`[data-completion-count=${kind}]`)?.textContent).toBe(`共同游戏 ${i + 1} 局`);
    });
    expect(container.querySelector("[data-game-stat=stars]")?.textContent).toContain("熟悉度 5 / 5");
    expect(container.querySelector(".life-summary-tracking")?.textContent).toContain("之前的局数未知，不补算");
    expect(container.querySelector(".life-summary-tracking time")?.getAttribute("datetime"))
      .toBe(new Date(created + 60000).toISOString());
    expect(current).toEqual(before);
  });

  it("does not backfill old counts from saved memories or capped interests", () => {
    const current = trackedPet();
    delete current.companion!.history;
    current.companion!.interests = [{ kind: "stars", points: 5, lastAt: created }];
    current.album = { since: created, legacy: false, entries: [{kind: "perfect-stars", source: "shared", at: created}] };
    const { container } = render(<LifeSummary pet={current} now={created + day} />);
    expect(container.querySelectorAll("[data-completion-count]")).toHaveLength(7);
    expect(container.querySelector("[data-completion-count=stars]")?.textContent).toBe("局数未记录");
    expect(container.querySelector("[data-game-stat=stars]")?.textContent).toContain("留过");
    expect(lifeSummary(current, created).gameStats.every(game => game.completions === null)).toBe(true);
  });

  it("shows known zeroes as zero, and the numeric limit as a lower bound", () => {
    const current = trackedPet();
    current.companion!.history!.completions[0].count = 0;
    current.companion!.history!.completions[1].count = Number.MAX_SAFE_INTEGER;
    const { container } = render(<LifeSummary pet={current} now={created + day} />);
    expect(container.querySelector("[data-completion-count=stars]")?.textContent).toBe("共同游戏 0 局");
    expect(container.querySelector("[data-completion-count=tiles]")?.textContent).toBe(`共同游戏 ≥${Number.MAX_SAFE_INTEGER} 局`);
  });

  it.each(["negative", "fraction", "unsafe", "duplicate", "missing", "future", "before", "invalid time"])(
    "keeps malformed %s history unknown instead of showing fabricated totals", problem => {
      const current = trackedPet(), history = current.companion!.history!;
      if (problem === "negative") history.completions[0].count = -1;
      if (problem === "fraction") history.completions[0].count = 1.5;
      if (problem === "unsafe") history.completions[0].count = Number.MAX_SAFE_INTEGER + 1;
      if (problem === "duplicate") history.completions[0].kind = "tiles";
      if (problem === "missing") history.completions.pop();
      if (problem === "future") history.since = current.lastTick + 1;
      if (problem === "before") history.since = current.createdAt - 1;
      if (problem === "invalid time") history.since = Number.NaN;
      expect(lifeSummary(current, created + day).gameHistorySince).toBeNull();
      expect(lifeSummary(current, created + day).gameStats.every(game => game.completions === null)).toBe(true);
    },
  );
});


describe("adult-life suggestions from saved experiences", () => {
  function adult(): PetState {
    return { ...pet(), lastTick: created + 3 * day,
      growth: { ...emptyGrowth("adult"), points: 72, form: "gentle" },
      companion: { since: created, interests: [
        { kind: "fishing", points: 5, lastAt: created + day },
        { kind: "walk", points: 1, lastAt: created + 2 * day },
      ], recent: { kind: "walk", id: "saved-walk-session", at: created + 2 * day } },
    };
  }

  it("shows three soft adult directions from saved memories, discoveries, and games", () => {
    const current = adult();
    current.album = { since: created, legacy: false, entries: [{ kind: "walk", at: created + day, source: "shared" }] };
    current.pond = { since: created, fish: [{ id: "reed-minnow", firstAt: created, lastAt: created, count: 2 }] };
    current.park = { since: created, finds: [{ id: "leaf", firstAt: created, lastAt: created, count: 1 }], walks: 1, lastWalkAt: created };
    const before = structuredClone(current);
    const summary = lifeSummary(current, current.lastTick);
    expect(summary.adultDirections?.map(direction => direction.id)).toEqual(["review", "explore", "together"]);
    expect(summary.adultDirections?.[0].text).toContain("公园里走过的第一条小路");
    expect(summary.adultDirections?.[1].text).toContain("2 种真实发现");
    expect(summary.adultDirections?.[2].text).toContain("公园散步");
    const { container } = render(<LifeSummary pet={current} now={current.lastTick} />);
    expect(container.querySelectorAll("[data-adult-directions] li")).toHaveLength(3);
    expect(container.querySelector(".life-summary-next")?.textContent).toContain("可以继续的方向");
    expect(current).toEqual(before);
  });

  it("carries the precise saved game total into the adult play direction", () => {
    const current = adult();
    current.schema = 19;
    current.companion!.history = {
      since: created,
      completions: [
        { kind: "stars", count: 1 },
        { kind: "tiles", count: 2 },
        { kind: "snake", count: 3 },
        { kind: "tetris", count: 4 },
        { kind: "fishing", count: 5 },
        { kind: "walk", count: 6 },
        { kind: "treasure", count: 7 },
      ],
    };
    const text = lifeSummary(current, current.lastTick).adultDirections?.[2].text;
    expect(text).toContain("最近一起玩的是「公园散步」");
    expect(text).toContain("已经一起收好 28 局共同游戏");
  });

  it("does not turn legacy or partial history into an adult total", () => {
    const current = adult();
    current.companion!.history = {
      since: created,
      completions: [
        { kind: "stars", count: 28 },
        { kind: "tiles", count: 0 },
        { kind: "snake", count: 0 },
        { kind: "tetris", count: 0 },
        { kind: "fishing", count: 0 },
        { kind: "walk", count: 0 },
      ],
    };
    const text = lifeSummary(current, current.lastTick).adultDirections?.[2].text;
    expect(text).not.toContain("已经一起收好");
  });

  it("keeps an adult with no saved experiences open without inventing a history", () => {
    const current = adult();
    delete current.companion;
    const summary = lifeSummary(current, current.lastTick);
    expect(summary.adultDirections).toHaveLength(3);
    expect(summary.adultDirections?.[0].text).toContain("真正想留下的时刻");
    expect(summary.adultDirections?.[1].text).toContain("想探索时");
    expect(summary.adultDirections?.[2].text).toContain("按心情");
    expect(summary.adultDirections?.[0].text).not.toContain("最近");
    const { container } = render(<LifeSummary pet={current} now={current.lastTick} />);
    expect(container.querySelectorAll("[data-adult-directions] li")).toHaveLength(3);
    expect(container.textContent).not.toContain("最近一次一起玩过");
  });

  it.each(["baby", "growing"] as const)("does not show adult directions during %s", stage => {
    const current = adult();
    current.growth = emptyGrowth(stage);
    expect(lifeSummary(current, current.lastTick).adultDirections).toBeNull();
    const { container } = render(<LifeSummary pet={current} now={current.lastTick} />);
    expect(container.querySelector("[data-adult-directions]")).toBeNull();
  });

  it("separates the last completed game from a capped lifetime interest", () => {
    const current = adult(), before = structuredClone(current);
    const { container } = render(<LifeSummary pet={current} now={current.lastTick} />);
    const next = container.querySelector(".life-summary-next")?.textContent;
    expect(next).toContain("最近一次一起玩过的是「公园散步」");
    expect(next).toContain("目前更熟悉的是「池塘钓鱼」");
    expect(next).not.toContain("最近常一起玩");
    expect(next).toContain("不是任务");
    expect(current).toEqual(before);
    expect(container.querySelector("button,a,input,[tabindex]")).toBeNull();
  });

  it("updates the suggestion after another completion even when interests do not change", () => {
    const current = adult();
    const { container, rerender } = render(<LifeSummary pet={current} now={current.lastTick} />);
    const next = structuredClone(current);
    next.companion!.recent = { kind: "fishing", id: "another-saved-session", at: next.lastTick };
    rerender(<LifeSummary pet={next} now={next.lastTick} />);
    expect(container.querySelector(".life-summary-next")?.textContent).toContain("最近一次一起玩过的是「池塘钓鱼」");
    expect(container.querySelector(".life-summary-next")?.textContent).not.toContain("公园散步");
    expect(next.companion!.interests).toEqual(current.companion!.interests);
    expect(next.growth).toEqual(current.growth);
  });

  it("retains saved memories when a legacy response has no recent game", () => {
    const current = adult(); delete current.companion!.recent;
    current.album = { since: created, legacy: false, entries: [{kind: "walk", at: created + day, source: "shared"}] };
    const text = lifeSummary(current, current.lastTick).nextStep;
    expect(text).toContain("最近留下的是「公园里走过的第一条小路」");
    expect(text).toContain("目前更熟悉的是「池塘钓鱼」");
    expect(text).not.toContain("最近一次一起玩过");
    expect(text).not.toContain("最近常一起玩");
  });

  it("keeps tied familiarity separate from the most recent game", () => {
    const current = adult(); current.companion!.interests[1].points = 5;
    const text = lifeSummary(current, current.lastTick).nextStep;
    expect(text).toContain("最近一次一起玩过的是「公园散步」");
    expect(text).toContain("目前更熟悉的是「池塘钓鱼」和「公园散步」");
  });

  it.each(["baby", "growing"] as const)("keeps %s care advice instead of an adult-life suggestion", stage => {
    const current = adult(); current.growth = emptyGrowth(stage);
    const text = lifeSummary(current, current.lastTick).nextStep;
    expect(text).toContain("按它当下的需要慢慢照顾");
    expect(text).not.toContain("最近一次一起玩过");
  });

  it.each([created - 1, created + 4 * day, Number.NaN])("does not infer a recent game from invalid saved time %s", at => {
    const current = adult(); current.companion!.recent!.at = at;
    expect(lifeSummary(current, current.lastTick).nextStep).not.toContain("最近一次一起玩过");
  });
});
