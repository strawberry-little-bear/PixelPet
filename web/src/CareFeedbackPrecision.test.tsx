import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { feedbackText } from "./CareFeedback";
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
      expect(feedbackText(feedback, emptyGrowth(), Date.now()).title).toBe(`成长 +0.25 · ${label} +1`);
      const { container } = render(<CareOutcome feedback={feedback} />);
      expect(container.querySelector(".care-learning")?.textContent).toContain(`${label}：+1`);
      expect(feedback).toEqual(before);
    });
  }
});
