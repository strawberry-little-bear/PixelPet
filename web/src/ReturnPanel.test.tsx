import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { absenceLabel, ReturnPanel } from "./ReturnPanel";
import type { ReturnRecap } from "./types";

afterEach(cleanup);
const recap: ReturnRecap = {
  id: "test", from: 1, to: 48 * 3600000 + 1,
  before: { needs: { hunger: 70, mood: 80, clean: 65, energy: 52 }, stage: "baby", form: "", points: 23.9, rest: 0, trackedHours: 0 },
  after: { needs: { hunger: 34, mood: 80, clean: 41, energy: 100 }, stage: "adult", form: "gentle", points: 72, rest: 48 / 28, trackedHours: 12 },
};
describe("truthful return summary", () => {
  it("keeps real absence separate from capped settlement and shows both stage crossings", () => {
    render(<ReturnPanel recap={recap} page={0} />);
    expect(screen.getByLabelText("回访小结").textContent).toContain("离开了 48 小时");
    expect(screen.getByLabelText("回访小结").textContent).toContain("52.0 → 100.0+48.0");
    cleanup();
    render(<ReturnPanel recap={recap} page={1} />);
    const text = screen.getByLabelText("回访小结").textContent;
    expect(text).toContain("幼年期 → 成年期");
    expect(text).toContain("期间也走过了成长期");
    expect(text).toContain("恬静型已定型，不会改写");
    expect(text).toContain("+48.10 点");
    expect(text).toContain("+1.71 习惯");
    expect(text).toContain("12.00 小时");
    expect(text).toContain("无额外奖励");
  });
  it("does not invent adult growth or rest when no recovery occurred", () => {
    const adult = { ...recap.after };
    render(<ReturnPanel recap={{ ...recap, before: adult, after: adult }} page={1} />);
    const text = screen.getByLabelText("回访小结").textContent;
    expect(text).toContain("仍在成年期");
    expect(text).toContain("+0.00 点");
    expect(text).toContain("+0.00 习惯");
    expect(text).not.toContain("走过了");
  });
  it("formats minutes and days without hiding the elapsed time", () => {
    expect(absenceLabel(15 * 60000)).toBe("15 分钟");
    expect(absenceLabel(125 * 60000)).toBe("2 小时 5 分钟");
    expect(absenceLabel(72 * 3600000)).toBe("72 小时");
  });
});

describe("saved return record period", () => {
  it.each([0, 1])("page %s shows both saved timestamps, not the current clock", page => {
    render(<ReturnPanel recap={recap} page={page} />);
    const period = screen.getByLabelText("记录时段（本地时间）");
    const times = period.querySelectorAll('time');
    expect(times).toHaveLength(2);
    expect(times[0].dateTime).toBe(new Date(recap.from).toISOString());
    expect(times[1].dateTime).toBe(new Date(recap.to).toISOString());
    expect(times[0].textContent).toContain(new Date(recap.from).getFullYear().toString());
    expect(screen.queryByRole('status')).toBeNull();
  });
  it("announces synchronization separately from the saved record data", () => {
    render(<ReturnPanel recap={recap} page={0} updated />);
    expect(screen.getByRole('status').textContent).toContain('已更新为最新回访记录');
    expect(screen.getByLabelText('回访小结').textContent).toContain('52.0 → 100.0+48.0');
    expect(document.querySelector('button,a,input')).toBeNull();
  });
  it("formats local periods correctly across a date boundary", () => {
    const from = new Date(2026, 9, 18, 23, 50).getTime(), to = new Date(2026, 9, 19, 0, 20).getTime();
    render(<ReturnPanel recap={{ ...recap, from, to }} page={0} />);
    const times = screen.getByLabelText('记录时段（本地时间）').querySelectorAll('time');
    expect(times[0].textContent).toContain('2026/10/18'); expect(times[0].textContent).toContain('23:50');
    expect(times[1].textContent).toContain('2026/10/19'); expect(times[1].textContent).toContain('00:20');
    expect(screen.getByLabelText('回访小结').textContent).toContain('离开了 30 分钟');
  });
});
