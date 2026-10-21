import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StarsGame } from "./StarsGame";
import { emptyGrowth } from "./growth";
import { petRigKind } from "./PetArt";
import type { GrowthStage, PetState } from "./types";
const fixture = (species: number, stage: GrowthStage): PetState => ({ schema: 17, revision: 1, species, name: "伙伴", createdAt: 1, hatchedAt: 2, lastTick: 100,
  sleeping: false, careCount: 0, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, growth: emptyGrowth(stage), logs: [],
  economy: { equipped: { accessory: "leaf-pin" } } as PetState["economy"],
  game: { id: "stars-local", startedAt: 5, round: 2, score: 2, lastBeat: 1 } });
const reaction = { gameId: "stars-local", round: 2, score: 2, beat: 1, lane: 1 };
afterEach(cleanup);
for (const stage of ["baby", "growing", "adult"] as const) it.each(Array.from({ length: 10 }, (_, i) => i))(`${stage}: species %s celebrates with its existing rig`, species => {
  const pet = fixture(species, stage), rig = petRigKind(species, stage);
  render(<StarsGame pet={pet} now={100} lane={1} target={2} message="接住了！★" reaction={reaction}/>);
  expect(document.querySelectorAll(`.${rig}-${stage}.rig-motion-celebrating.expression-content`)).toHaveLength(1);
  expect(document.querySelector('.equipped-accessory[data-item="leaf-pin"]')).toBeTruthy();
  expect(screen.getByRole("img", { name: "星星在右边；伙伴在中间" }).closest("[aria-live]")).toBeNull();
  expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
});
it.each([{ gameId: "old" }, { round: 1 }, { score: 1 }, { beat: 0 }, { lane: 0 }])("ignores stale local reaction %j", change => {
  render(<StarsGame pet={fixture(2, "baby")} now={100} lane={1} target={1} message="" reaction={{ ...reaction, ...change }}/>);
  expect(document.querySelector(".rig-motion-celebrating")).toBeNull();
  expect(document.querySelector(".rig-motion-idle.expression-awake")).toBeTruthy();
});
