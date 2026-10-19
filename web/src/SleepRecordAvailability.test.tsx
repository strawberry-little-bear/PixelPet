import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CareOutcome } from "./CareOutcome";
import { carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { CareFeedback, PetState } from "./types";

const at = Date.parse("2026-10-20T01:00:00Z");
const needs = { hunger: 70, mood: 80, clean: 80, energy: 80 };
const pet = (schema: number): PetState => ({ schema, revision: 1, species: 2, name: "好梦伙伴",
  createdAt: at - 3600000, hatchedAt: at - 3600000, lastTick: at, sleeping: true,
  needs: { ...needs }, careCount: 0, logs: [], growth: emptyGrowth() });
const wake: CareFeedback = { kind: "sleep", reason: "awake", points: 0, habitGain: 0,
  effect: { at, before: needs, after: needs } };
afterEach(cleanup);

it.each([11, 16, 17])("explains missing sleep history before a schema %s wake without mutating the save", schema => {
  const saved = pet(schema), before = structuredClone(saved);
  const text = carePreview(saved, "sleep").join("");
  expect(text).toContain("没有完整入睡记录");
  expect(text).toContain("仍照常恢复体力");
  expect(text).toContain("不倒推整段小结");
  if (schema >= 17) expect(text).toContain("下次明确入睡后开始记录");
  else expect(text).not.toContain("下次明确入睡后开始记录");
  expect(saved).toEqual(before);
});
it("does not say an explicitly recorded sleep has no start", () => {
  const saved = pet(17);
  saved.sleepSession = { startedAt: at, settledHours: 0, energyRecovered: 0, restGain: 0, growthPoints: 0 };
  expect(carePreview(saved, "sleep").join("")).not.toContain("没有完整入睡记录");
});
it("does not show missing sleep history when awake or before hatching", () => {
  const saved = pet(17); saved.sleeping = false;
  expect(carePreview(saved, "sleep").join("")).not.toContain("没有完整入睡记录");
  saved.sleeping = true; saved.hatchedAt = 0;
  expect(carePreview(saved, "sleep").join("")).not.toContain("没有完整入睡记录");
});
it.each([undefined, null])("explains an acknowledged wake with absent history (%s), never fabricating totals", sleepSummary => {
  render(<CareOutcome feedback={{ ...wake, sleepSummary } as CareFeedback} />);
  const note = screen.getByRole("note", { name: "整段睡眠记录说明" });
  expect(note.textContent).toContain("本次没有可展示的完整睡眠记录");
  expect(note.textContent).toContain("不代表睡着期间没有恢复");
  expect(note.textContent).not.toMatch(/\d/);
  expect(screen.queryByRole("group", { name: "这次睡眠的实际结算" })).toBeNull();
  expect(screen.getByRole("region", { name: "上次操作的即时变化" }).textContent).toContain("起床");
});
it.each([
  { reason: "resting" }, { kind: "feed" }, { points: .25 }, { habitGain: 1 },
  { habit: "rest" }, { effect: undefined }, { sleepSummary: { startedAt: NaN } },
])("does not turn unrelated/incompatible/malformed replies into a missing-history notice (%j)", patch => {
  render(<CareOutcome feedback={{ ...wake, ...patch } as CareFeedback} />);
  expect(screen.queryByRole("note", { name: "整段睡眠记录说明" })).toBeNull();
});
