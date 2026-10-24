import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareFeedback as FeedbackToast, feedbackText } from "./CareFeedback";
import { CareOutcome } from "./CareOutcome";
import { emptyGrowth } from "./growth";
import type { CareFeedback } from "./types";

afterEach(cleanup);
const effect = { at: Date.now(), before: { hunger: 50, mood: 70, clean: 60, energy: 80 }, after: { hunger: 78, mood: 74, clean: 58, energy: 80 } };
describe("whole care credits from fractional legacy habit totals", () => {
  for (const [kind, habit, label] of [["feed", "nutrition", "喂食习惯"], ["clean", "clean", "清洁习惯"], ["catch", "play", "陪玩习惯"]] as const) {
    it.each([1.4 - .4, 2.2 - 1.2, 1.2 - .2])(`${kind} displays one credited action for raw gain %s`, habitGain => {
      const feedback: CareFeedback = { kind, habit, points: .25, habitGain, reason: "credited", effect };
      const before = structuredClone(feedback);
      expect(feedbackText(feedback, emptyGrowth()).title).toBe(`成长 +0.25 · ${label} +1`);
      const { container } = render(<CareOutcome feedback={feedback} />);
      expect(container.querySelector(".care-learning")?.textContent).toContain(`${label}：+1`);
      expect(feedback).toEqual(before);
    });
  }
});

describe("consistent growth amounts in the short and detailed care receipt", () => {
  it.each([
    [72 - 71.965, "0.04"],
    [72 - 71.995, "0.01"],
    [72 - 71.775, "0.23"],
    [.004, "<0.01"],
    [.0349, "0.03"],
    [.25, "0.25"],
  ] as const)("shows the same gain for %s points", (points, amount) => {
    const feedback: CareFeedback = { kind: "feed", habit: "nutrition", points, habitGain: 1, reason: "credited", effect };
    const before = structuredClone(feedback);
    const { container } = render(<>
      <FeedbackToast feedback={feedback} growth={emptyGrowth()} mood="" />
      <CareOutcome feedback={feedback} />
    </>);
    expect(container.querySelector(".growth-feedback strong")?.textContent).toBe(`成长 +${amount} · 喂食习惯 +1`);
    expect(container.querySelector(".care-learning")?.textContent).toContain(`本次成长：+${amount} 点`);
    expect(feedback).toEqual(before);
  });

  it("keeps adult habit credit without claiming extra growth", () => {
    const feedback: CareFeedback = { kind: "feed", habit: "nutrition", points: 0, habitGain: 1, reason: "credited", effect };
    const { container } = render(<>
      <FeedbackToast feedback={feedback} growth={emptyGrowth("adult")} mood="" />
      <CareOutcome feedback={feedback} />
    </>);
    expect(container.querySelector(".growth-feedback strong")?.textContent).toBe("喂食习惯 +1");
    expect(container.querySelector(".care-learning")?.textContent).toContain("本次没有新增成长点");
  });
});
