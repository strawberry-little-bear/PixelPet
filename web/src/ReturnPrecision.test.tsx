import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReturnPanel } from "./ReturnPanel";
import type { ReturnRecap } from "./types";

const recap: ReturnRecap = { id: "precision", from: 1, to: 3600001,
  before: { needs: { hunger: .001, mood: 40, clean: .02, energy: 99.999 }, stage: "growing", form: "", points: 71.999, rest: 1, trackedHours: 1 },
  after: { needs: { hunger: 0, mood: 40, clean: 0, energy: 100 }, stage: "adult", form: "gentle", points: 72, rest: 1.00001, trackedHours: 2 } };
afterEach(cleanup);
const row = (name: string) => screen.getByText(name).parentElement!.textContent;

describe("nonzero return changes at display precision", () => {
  it("does not turn tiny clamped need changes into signed zero", () => {
    render(<ReturnPanel recap={recap} page={0} />);
    expect(row("饱食")).toContain("−<0.1");
    expect(row("清洁")).toContain("−<0.1");
    expect(row("体力")).toContain("+<0.1");
    expect(row("心情")).toContain("+0.0");
  });
  it("retains tiny growth up to adulthood and the actual rest habit gain", () => {
    render(<ReturnPanel recap={recap} page={1} />);
    expect(row("成长")).toContain("+<0.01 点");
    expect(row("有效休息")).toContain("+<0.01 习惯");
    expect(row("结算时长")).toContain("1.00 小时");
    expect(screen.getByLabelText("回访小结").textContent).toContain("成长期 → 成年期");
  });
  it.each([.00000001, .001, .0049])("does not round positive growth %s to zero", gain => {
    render(<ReturnPanel recap={{ ...recap, before: { ...recap.before, points: 72 - gain } }} page={1} />);
    expect(row("成长")).toContain("+<0.01 点");
  });
  it("preserves the ordinary rounded amounts at and above the zero-rounding boundary", () => {
    render(<ReturnPanel recap={{ ...recap, before: { ...recap.before, points: 0, rest: 0, trackedHours: 0 },
      after: { ...recap.after, points: .005, rest: .01, trackedHours: 12 } }} page={1} />);
    expect(row("成长")).toContain("+0.01 点");
    expect(row("有效休息")).toContain("+0.01 习惯");
    expect(row("结算时长")).toContain("12.00 小时");
  });
  it("keeps exact zeros distinct from small nonzero changes", () => {
    render(<ReturnPanel recap={{ ...recap, after: recap.before }} page={1} />);
    expect(row("成长")).toContain("+0.00 点");
    expect(row("有效休息")).toContain("+0.00 习惯");
    expect(row("结算时长")).toContain("0.00 小时");
    expect(screen.getByLabelText("回访小结").textContent).not.toContain("<0.");
  });
  it("keeps a same-ID saved receipt unchanged when rerendered", () => {
    const { rerender } = render(<ReturnPanel recap={recap} page={0} />);
    const original = screen.getByLabelText("回访小结").textContent;
    rerender(<ReturnPanel recap={structuredClone(recap)} page={1} />);
    rerender(<ReturnPanel recap={structuredClone(recap)} page={0} />);
    expect(screen.getByLabelText("回访小结").textContent).toBe(original);
    expect(document.querySelector("button,a,input")).toBeNull();
  });
});
