import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { QuietMoment } from "./QuietMoment";
import type { GrowthStage, PetState } from "./types";

const at = Date.UTC(2026, 9, 25);
const fixtures = [
  { species: 4, kind: "snake", part: "菌盖", absent: /尾巴/ },
  { species: 6, kind: "snake", part: "身子", absent: /尾巴/ },
  { species: 3, kind: "walk", part: "浅水道", absent: /慢慢走走/ },
] as const;
function pet(species: number, kind: "snake" | "walk", stage: GrowthStage = "baby"): PetState {
  return { schema: 22, revision: 1, species, name: "发呆伙伴", createdAt: at - 10000,
    hatchedAt: at - 9000, lastTick: at, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, energy: 80, clean: 80 }, growth: emptyGrowth(stage),
    companion: { since: at - 9000, interests: [{ kind, points: 2, lastAt: at - 1000 }] } };
}
const cue = () => document.querySelector(".quiet-interest");
afterEach(cleanup);

it.each(fixtures)("matches the $species companion's anatomy when recalling $kind", fixture => {
  for (const stage of ["baby", "growing", "adult"] as const) {
    const saved = pet(fixture.species, fixture.kind, stage), original = structuredClone(saved);
    const view = render(<QuietMoment pet={saved} choice={1} replied now={at} />);
    expect(cue()?.textContent).toContain(fixture.part);
    expect(cue()?.textContent).not.toMatch(fixture.absent);
    expect(cue()?.getAttribute("data-game")).toBe(fixture.kind);
    expect(document.querySelector("button,input,a,[role=button]")).toBeNull();
    expect(saved).toEqual(original);
    view.unmount();
  }
});
it("uses a body-neutral fallback for unknown rigs and keeps land walks unchanged", () => {
  const view = render(<QuietMoment pet={pet(999, "snake")} choice={1} replied now={at} />);
  expect(cue()?.textContent).toContain("身子");
  expect(cue()?.textContent).not.toMatch(/尾巴|菌盖|小鳍|前蹼/);
  view.rerender(<QuietMoment pet={pet(2, "walk")} choice={1} replied now={at} />);
  expect(cue()?.textContent).toContain("散步的小路");
  expect(cue()?.textContent).not.toMatch(/浅水道|摆鳍/);
});
it("keeps anatomy-specific familiarity quiet before B, during sleep, on ties and without valid history", () => {
  const saved = pet(3, "walk");
  const view = render(<QuietMoment pet={saved} choice={1} replied={false} now={at} />);
  expect(cue()).toBeNull();
  view.rerender(<QuietMoment pet={saved} choice={1} replied now={at} />);
  expect(cue()?.textContent).toContain("浅水道");
  const original = cue()!.textContent;
  view.rerender(<QuietMoment pet={structuredClone(saved)} choice={1} replied now={at + 1000} />);
  expect(cue()?.textContent).toBe(original);
  for (const hidden of [
    { ...saved, sleeping: true },
    { ...saved, companion: undefined },
    { ...saved, companion: { ...saved.companion!, interests: [{ kind: "walk", points: 1, lastAt: at }] } },
    { ...saved, companion: { ...saved.companion!, interests: [{ kind: "walk", points: 2, lastAt: at }, { kind: "snake", points: 2, lastAt: at }] } },
    { ...saved, companion: { ...saved.companion!, interests: [{ kind: "walk", points: 2.5, lastAt: at }] } },
  ] as PetState[]) {
    view.rerender(<QuietMoment pet={hidden} choice={1} replied now={at} />);
    expect(cue()).toBeNull();
  }
  view.rerender(<QuietMoment pet={saved} choice={0} replied now={at} />);
  expect(cue()).toBeNull();
});
