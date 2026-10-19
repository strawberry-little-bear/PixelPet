import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GrowthPanel } from "./GrowthPanel";
import { emptyGrowth } from "./growth";
import type { AdultForm, FormRecord, Growth } from "./types";
afterEach(cleanup);
const at = Date.parse("2026-10-19T01:00:00Z");
function grown(form: AdultForm): Growth {
  const g = emptyGrowth("adult");
  g.points = 72; g.form = form; g.adultAt = at;
  g.trackedHours = 40; g.wellbeing = 32;
  g.care = { ...g.care, nutrition: 11, play: 99, clean: 90, rest: 90 };
  g.formRecord = { trackedHours: 12, wellbeing: form === "easygoing" ? 2.4 : 9.6, nutrition: 3,
    play: form === "lively" ? 8 : 2, clean: form === "gentle" ? 4 : 2, rest: form === "gentle" ? 4 : 2 };
  return g;
}

describe("adult threshold evidence, not current habits", () => {
  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("shows the saved %s form's decision-time evidence", form => {
    const g = grown(form), before = structuredClone(g), r = g.formRecord!;
    const { container } = render(<GrowthPanel growth={g} index={2} page={2} />);
    expect(container.textContent).toContain("定型时 · 形态依据");
    expect(container.textContent).toContain(`定型时陪玩 ${r.play.toFixed(1)} · 恬静分 ${((r.clean + r.rest) / 2).toFixed(1)}`);
    expect(container.textContent).toContain("记录 12.0h");
    expect(container.textContent).toContain(`平均舒适约 ${Math.round(r.wellbeing / r.trackedHours * 100)}%`);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(new Date(at).toISOString());
    expect(container.textContent).toContain("定型时保存的记录，不按当前习惯重算");
    expect(container.textContent).not.toContain("不代表成年时的记录");
    expect(container.textContent).not.toContain("当前陪玩 99.0");
    expect(container.querySelector('[data-selected="true"]')?.getAttribute("data-rule-form")).toBe(form);
    expect(container.querySelector("button,a,input")).toBeNull(); expect(g).toEqual(before);
  });
  it("adult care changes current habits, not the frozen explanation", () => {
    const g = grown("lively"), r = structuredClone(g.formRecord);
    const { container, rerender } = render(<GrowthPanel growth={g} index={3} page={2} />);
    const original = container.textContent;
    const later = structuredClone(g); later.care.play += 10; later.care.rest += 50; later.trackedHours += 10;
    rerender(<GrowthPanel growth={later} index={3} page={2} />);
    expect(container.textContent).toBe(original); expect(later.formRecord).toEqual(r);
    rerender(<GrowthPanel growth={later} index={3} page={1} />);
    expect(container.textContent).toContain("109.0"); expect(container.textContent).toContain("成年后不再加成长点");
  });
  it("does not fabricate threshold evidence for migrated or old-service adults", () => {
    const g = grown("gentle"); delete g.formRecord;
    const { container } = render(<GrowthPanel growth={g} index={0} page={2} />);
    expect(container.textContent).toContain("未保存定型时的依据，不倒推过去");
    expect(container.textContent).toContain("当前陪玩 99.0");
    expect(container.textContent).toContain("不代表成年时的记录"); expect(container.querySelector("time")).toBeNull();
  });
  it("keeps the provisional tendency on immature pets", () => {
    const g = emptyGrowth("growing"); g.care.play = 8;
    const { container } = render(<GrowthPanel growth={g} index={0} page={2} />);
    expect(container.textContent).toContain("当前倾向"); expect(container.textContent).toContain("现在仍会变化");
    expect(container.querySelector("time")).toBeNull(); expect(container.textContent).not.toContain("未保存定型时");
  });
  it("replaces records with another save and never keeps the previous threshold values", () => {
    const { container, rerender } = render(<GrowthPanel growth={grown("lively")} index={2} page={2} />);
    const next = grown("gentle"); next.adultAt += 3600000;
    rerender(<GrowthPanel growth={next} index={4} page={2} />);
    expect(container.textContent).toContain("定型时陪玩 2.0 · 恬静分 4.0");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(new Date(next.adultAt).toISOString());
    delete next.formRecord; rerender(<GrowthPanel growth={next} index={4} page={2} />);
    expect(container.textContent).toContain("未保存定型时的依据"); expect(container.querySelector("time")).toBeNull();
  });
  it.each([0, 11.999, 12])("uses saved tracking precision at %s hours", trackedHours => {
    const g = grown("balanced"); g.formRecord = { ...g.formRecord!, trackedHours, wellbeing: trackedHours * .8 } as FormRecord;
    const { container } = render(<GrowthPanel growth={g} index={2} page={2} />);
    expect(container.textContent).toContain(trackedHours ? `记录 ${(Math.floor(trackedHours * 10) / 10).toFixed(1)}h` : "尚无舒适度记录");
  });
});
