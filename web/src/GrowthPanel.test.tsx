import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth, formRules } from "./growth";
import type { AdultForm, GrowthStage } from "./types";

afterEach(cleanup);

describe("growth handbook previews and form guide", () => {
  it.each(["baby", "growing", "adult"] as GrowthStage[])("previews three stages without changing the saved %s stage", stage => {
    const g = emptyGrowth(stage);
    g.points = stage === "adult" ? 72 : stage === "growing" ? 30 : 12;
    if (stage === "adult") g.form = "gentle";
    const before = structuredClone(g);
    const { container } = render(<GrowthPanel growth={g} index={2} page={0} />);
    expect([...container.querySelectorAll("[data-preview-stage]")].map(el => el.getAttribute("data-preview-stage")))
      .toEqual(["baby", "growing", "adult"]);
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("data-preview-stage")).toBe(stage);
    expect(container.querySelectorAll(".growth-outfit")).toHaveLength(3);
    expect([...container.querySelectorAll(".growth-previews .rabbit-rig")].map(el => el.getAttribute("data-rig-stage")))
      .toEqual(["baby", "growing", "adult"]);
    expect(container.querySelector(".growth-previews image")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".growth-page-dots")?.textContent).toBe("1 / 6");
    expect(g).toEqual(before);
  });

  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("uses the current %s tendency for an explicitly provisional adult preview", form => {
    const g = emptyGrowth();
    if (form === "lively") g.care.play = 2;
    if (form === "gentle") g.care.clean = 4;
    if (form === "easygoing") { g.trackedHours = 12; g.wellbeing = 1; }
    const { container } = render(<GrowthPanel growth={g} index={9} page={0} />);
    expect(container.querySelector('[data-preview-stage="adult"]')?.getAttribute("data-preview-form")).toBe(form);
    expect(container.textContent).toContain("成年外观为当前倾向，尚未确定");
  });

  it("updates previews and evidence when polling changes habits, without advancing a stage", () => {
    const g = emptyGrowth();
    const { container, rerender } = render(<GrowthPanel growth={g} index={0} page={0} />);
    const changed = structuredClone(g);
    changed.care.play = 2;
    rerender(<GrowthPanel growth={changed} index={0} page={0} />);
    expect(container.querySelector('[data-preview-stage="adult"]')?.getAttribute("data-preview-form")).toBe("lively");
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("data-preview-stage")).toBe("baby");
    rerender(<GrowthPanel growth={changed} index={0} page={2} />);
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe("lively");
    expect(container.textContent).toContain("当前陪玩 2.0 · 恬静分 0.0");
    expect(container.textContent).toContain("现在仍会变化");
  });

  it("does not invent comfort history or round incomplete tracking up to 12 hours", () => {
    const g = emptyGrowth();
    const { container, rerender } = render(<GrowthPanel growth={g} index={0} page={2} />);
    expect(container.textContent).toContain("尚无舒适度记录");
    g.trackedHours = 11.999;
    g.wellbeing = 1;
    rerender(<GrowthPanel growth={g} index={0} page={2} />);
    expect(container.textContent).toContain("记录 11.9h");
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe("balanced");
  });

  it("shows comfort priority before habit rules and explains the calm-score formula", () => {
    const g = emptyGrowth();
    g.trackedHours = 12;
    g.wellbeing = 1;
    g.care.play = 100;
    const { container } = render(<GrowthPanel growth={g} index={0} page={2} />);
    expect([...container.querySelectorAll("[data-rule-form]")].map(el => el.getAttribute("data-rule-form")))
      .toEqual(formRules.map(rule => rule.form));
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe("easygoing");
    expect(container.textContent).toContain("恬静分 =（清洁习惯 + 休息习惯）÷ 2");
    expect(container.textContent).toContain("不必刻意追求形态");
  });

  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("preserves the fixed %s preview without claiming current habits caused it", form => {
    const g = emptyGrowth("adult");
    g.points = 72; g.form = form;
    g.care.play = 100;
    const { container, rerender } = render(<GrowthPanel growth={g} index={2} page={0} />);
    expect(container.querySelector('[data-preview-stage="adult"]')?.getAttribute("data-preview-form")).toBe(form);
    expect(container.textContent).not.toContain("尚未确定");
    rerender(<GrowthPanel growth={g} index={2} page={1} />);
    expect(container.textContent).toContain("不再加成长点");
    expect(container.textContent).not.toContain("+0.25");
    rerender(<GrowthPanel growth={g} index={2} page={2} />);
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe(form);
    expect(container.textContent).toContain("当前习惯不改写它");
    expect(container.textContent).toContain("不代表成年时的记录");
  });
});

describe("offline explanation", () => {
  it.each(["baby", "growing", "adult"] as const)("explains time without changing %s state", stage => {
    const g = emptyGrowth(stage), before = structuredClone(g);
    const { container } = render(<GrowthPanel growth={g} index={0} page={4} />);
    expect(container.textContent).toContain("每次结算有上限");
    expect(container.textContent).toContain("超出该次上限不补扣、不补长");
    expect(container.textContent).toContain("不等于成长点");
    expect(container.textContent).toContain("只按实际恢复量");
    expect(container.textContent).toContain("成年形态固定");
    expect(container.querySelector("button, a, input")).toBeNull();
    expect(g).toEqual(before);
  });
});
