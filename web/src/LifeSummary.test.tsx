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
});
