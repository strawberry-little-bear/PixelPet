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
    const broken = { ...pet(), createdAt: 0 };
    expect(lifeSummary(broken, created).daysTogether).toBeNull();
    render(<LifeSummary pet={broken} now={created} />);
    expect(document.querySelector(".life-summary-grid")?.textContent).toContain("—");
  });

  it("never shows a negative day count when the clock runs behind the save", () => {
    expect(lifeSummary(pet(), created - 5 * day).daysTogether).toBe(1);
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
