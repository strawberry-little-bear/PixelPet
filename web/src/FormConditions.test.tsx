import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth } from "./growth";
import type { Growth } from "./types";

afterEach(cleanup);
const row = (container: HTMLElement, form: string) => container.querySelector(`[data-rule-form="${form}"]`)!;
const panel = (growth: Growth) => render(<GrowthPanel growth={growth} index={2} page={2} />);
const source = () => {
  const g = emptyGrowth("growing");
  g.trackedHours = 12;
  g.wellbeing = 12 * .8;
  return g;
};

describe("unrounded form conditions", () => {
  it.each([
    [.44999, true], [.45, false], [.45001, false],
  ] as const)("distinguishes comfort %s even when the display rounds to 45%%", (average, met) => {
    const g = source(); g.wellbeing = 12 * average;
    const { container } = panel(g);
    expect(container.textContent).toContain("平均舒适约 45%");
    expect(row(container, "easygoing").getAttribute("data-condition-met")).toBe(String(met));
    expect(row(container, "easygoing").textContent).toContain(met ? "满足 · 首项" : "未满足");
    expect(container.textContent).toContain("按未四舍五入的记录核对");
  });
  it.each([
    [1.99999, 0, false], [2, 0, true],
    [3, 2, false], [3.00001, 2, true],
  ] as const)("distinguishes play=%s, calm=%s without rounded comparison", (play, gentle, met) => {
    const g = source(); Object.assign(g.care, { play, clean: gentle, rest: gentle });
    const { container } = panel(g);
    expect(row(container, "lively").getAttribute("data-condition-met")).toBe(String(met));
    expect(row(container, "lively").textContent).toContain(met ? "满足 · 首项" : "未满足");
  });
  it("explains that a matching later rule cannot outrank comfort", () => {
    const g = source(); g.wellbeing = 1; g.care.play = 100;
    const { container } = panel(g);
    expect(row(container, "easygoing").textContent).toContain("满足 · 首项");
    expect(row(container, "lively").textContent).toContain("满足 · 前项优先");
    expect(row(container, "balanced").textContent).toContain("未满足");
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe("easygoing");
  });
  it("evaluates the frozen adult record instead of later care", () => {
    const g = source(); g.stage = "adult"; g.form = "easygoing"; g.points = 72;
    g.adultAt = Date.parse("2026-10-19T01:00:00Z");
    g.formRecord = { trackedHours: 12, wellbeing: 12 * .44999, nutrition: 0, play: 0, clean: 0, rest: 0 };
    g.care.play = 99;
    const { container, rerender } = panel(g);
    expect(container.textContent).toContain("定型时条件核对");
    expect(row(container, "easygoing").textContent).toContain("满足 · 首项");
    expect(row(container, "lively").textContent).toContain("未满足");
    const original = container.textContent;
    const later = structuredClone(g); later.care.play += 99; later.wellbeing += 10; later.trackedHours += 20;
    rerender(<GrowthPanel growth={later} index={2} page={2} />);
    expect(container.textContent).toBe(original);
  });
  it("marks old adult conditions as current reference, without reselecting its form", () => {
    const g = source(); g.stage = "adult"; g.form = "gentle"; g.points = 72; g.care.play = 99;
    const before = structuredClone(g), { container } = panel(g);
    expect(container.textContent).toContain("当前条件核对");
    expect(container.textContent).toContain("不代表成年时的记录");
    expect(row(container, "lively").textContent).toContain("满足 · 首项");
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe("gentle");
    expect(container.querySelector("button,a,input")).toBeNull(); expect(g).toEqual(before);
  });
});
