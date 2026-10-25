import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { completedCareOutcome } from "./care-outcome";
import { CareOutcome } from "./CareOutcome";
import { emptyGrowth } from "./growth";
import type { AdultForm, PetState, Result } from "./types";

const at = 1792368000000;
function fixture(kind: "feed" | "clean" | "wake" = "feed") {
  const before: PetState = { schema: 22, revision: 1, species: 2, name: "回应伙伴", createdAt: at - 100000,
    hatchedAt: at - 90000, lastTick: at, sleeping: kind === "wake", careCount: 0,
    needs: { hunger: 50, mood: 50, clean: 50, energy: 1 }, growth: emptyGrowth(), logs: [] };
  const result: Result = { state: { ...structuredClone(before), revision: 2, sleeping: false }, message: "", serverTime: at,
    careFeedback: { kind: kind === "wake" ? "sleep" : kind, reason: kind === "wake" ? "awake" : "credited",
      points: 0, habitGain: 0, effect: { at, before: { ...before.needs }, after: { ...before.needs } } } };
  return { before, result, action: kind === "wake" ? "sleep" : kind };
}
afterEach(cleanup);

describe("confirmed care companion response", () => {
  it.each(["feed", "clean", "wake"] as const)("distinguishes recorded stages for %s and preserves exact feedback", kind => {
    const { before, result, action } = fixture(kind);
    const original = structuredClone(result.careFeedback);
    const responses = new Set<string>();
    for (const stage of ["baby", "growing", "adult"] as const) {
      result.state.growth = emptyGrowth(stage);
      if (stage === "adult") result.state.growth.form = "balanced";
      const receipt = completedCareOutcome(action, before, result)!;
      expect(receipt.companionResponse).toBeTruthy();
      responses.add(receipt.companionResponse!);
      const { companionResponse: _, ...feedback } = receipt;
      expect(feedback).toEqual(original);
    }
    expect(responses.size).toBe(3);
    expect(result.careFeedback).toEqual(original);
  });
  it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("uses saved %s instead of contradictory care totals", form => {
    const { before, result, action } = fixture();
    result.state.growth = { ...emptyGrowth("adult"), form };
    const expected = completedCareOutcome(action, before, result)!;
    result.state.growth.care.play = form === "lively" ? 0 : 100;
    result.state.growth.care.clean = form === "lively" ? 100 : 0;
    expect(completedCareOutcome(action, before, result)).toEqual(expected);
    expect(expected.companionResponse).not.toMatch(/精神|体力充沛|吃饱|恢复好了/);
  });
  it("takes the stage reached by this action, freezes the response and renders it in the existing summary", () => {
    const { before, result, action } = fixture();
    result.state.growth = emptyGrowth("growing");
    const receipt = completedCareOutcome(action, before, result)!;
    expect(receipt.companionResponse).toBe("它吃好饭团，抬起头认真望望你。");
    result.state.growth = { ...emptyGrowth("adult"), form: "gentle" };
    render(<CareOutcome feedback={receipt}/>);
    expect(document.querySelector(".care-outcome-summary")?.textContent).toBe(receipt.companionResponse);
    expect(screen.getByRole("region", { name: "上次操作的即时变化" })).toBeTruthy();
    expect(document.querySelectorAll(".care-outcome-summary")).toHaveLength(1);
  });
  it.each(["missing growth", "egg", "unformed adult", "invalid form", "malformed form", "old effect", "timestamp mismatch", "other action", "other pet", "sleeping feed", "wake without sleep"])("keeps generic receipts for %s", scenario => {
    const { before, result } = fixture();
    let action = "feed";
    if (scenario === "missing growth") delete result.state.growth;
    if (scenario === "egg") result.state.growth = emptyGrowth("egg");
    if (scenario === "unformed adult") result.state.growth = emptyGrowth("adult");
    if (scenario === "invalid form") result.state.growth = { ...emptyGrowth("adult"), form: "toString" as AdultForm };
    if (scenario === "malformed form") result.state.growth = { ...emptyGrowth("adult"), form: { toString: null } as unknown as AdultForm };
    if (scenario === "old effect") delete result.careFeedback!.effect;
    if (scenario === "timestamp mismatch") result.serverTime++;
    if (scenario === "other action") action = "clean";
    if (scenario === "other pet") result.state.hatchedAt++;
    if (scenario === "sleeping feed") before.sleeping = true;
    if (scenario === "wake without sleep") { action = "sleep"; result.careFeedback!.kind = "sleep"; result.careFeedback!.reason = "awake"; }
    expect(completedCareOutcome(action, before, result)).toBe(result.careFeedback);
    expect(completedCareOutcome(action, before, result)?.companionResponse).toBeUndefined();
  });
  it("does not invent a receipt on a read, an old reply without feedback or bedtime", () => {
    const { before, result } = fixture();
    expect(completedCareOutcome("feed", null, result)?.companionResponse).toBeUndefined();
    result.state.sleeping = true; result.careFeedback!.kind = "sleep"; result.careFeedback!.reason = "resting";
    expect(completedCareOutcome("sleep", before, result)?.companionResponse).toBeUndefined();
    delete result.careFeedback;
    expect(completedCareOutcome("feed", before, result)).toBeNull();
  });
});
