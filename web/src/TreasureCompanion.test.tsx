import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TreasureCompanion } from "./TreasureCompanion";
import { emptyGrowth } from "./growth";
import { petRigKind } from "./PetArt";
import type { GrowthStage, PetState } from "./types";
const fixture = (species: number, stage: GrowthStage): PetState => ({ schema: 17, revision: 1, species, name: "伙伴", createdAt: 1, hatchedAt: 2, lastTick: 100,
  sleeping: false, careCount: 0, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, growth: emptyGrowth(stage), logs: [],
  economy: { equipped: { accessory: "leaf-pin" } } as PetState["economy"],
  game: { id: "local-game", kind: "treasure", startedAt: 5, round: 0, score: 0, lastBeat: -1,
    treasure: { layout: [1, 2, 3, 0, 0, 0, 0, 0, 0], opened: [0], step: 2, paused: false } } });
const reaction = { gameId: "local-game", step: 2, cell: 0, item: 1, serial: 1 };
const parts = [".tanuki-paw.paw-right", ".bird-head", ".rabbit-arm.paw-right", ".dolphin-flipper.flipper-right", ".mushroom-cap", ".bear-paw-right", ".frog-hand-right", ".cat-paw.paw-right", ".dragon-hand-right", ".dog-paw-right"];
afterEach(cleanup);
describe("treasure companion art", () => {
  for (const stage of ["baby", "growing", "adult"] as const) it.each(parts.map((part, species) => ({part, species})))(`${stage}: uses real anatomy ($species)`, ({part, species}) => {
    const pet = fixture(species, stage), rig = petRigKind(species, stage);
    render(<TreasureCompanion pet={pet} paused={false} done={false} reaction={reaction}/>);
    expect(document.querySelector(`.treasure-companion[data-rig=${rig}][data-reaction=found] ${part}`)).toBeTruthy();
    expect(document.querySelector(`.${rig}-${stage}.rig-motion-treasure`)).toBeTruthy();
    expect(document.querySelector('.equipped-accessory[data-item="leaf-pin"]')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("找到小松果");
    expect(document.querySelector(".treasure-actor")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it.each([1, 2, 3])("renders only the real discovered object %s", item => {
    render(<TreasureCompanion pet={fixture(2, "baby")} paused={false} done reaction={{...reaction, item}}/>);
    expect(document.querySelector(".treasure-object")?.getAttribute("data-item")).toBe(String(item));
  });
  it("reflects the saved adult tendency without changing the treasure controls", () => {
    const pet = fixture(2, "adult");
    pet.growth!.form = "gentle";
    render(<TreasureCompanion pet={pet} paused={false} done={false} />);
    expect(document.querySelector('.treasure-companion[data-form="gentle"]')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("安静观察着");
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it("empty final exploration never displays any revealed object", () => {
    render(<TreasureCompanion pet={fixture(3, "adult")} paused={false} done reaction={{...reaction, cell: 8, item: 0}}/>);
    expect(screen.getByRole("status").textContent).toContain("这里是空地");
    expect(screen.getByRole("status").textContent).toContain("浅水");
    expect(document.querySelector(".treasure-object")).toBeNull();
  });
  it.each([{paused:true}, {gameId:"old"}, {step:1}])("ignores paused or stale local reaction %j", change => {
    render(<TreasureCompanion pet={fixture(2, "baby")} paused={"paused" in change} done={false} reaction={{...reaction, ...change}}/>);
    expect(document.querySelector('[data-reaction="quiet"]')).toBeTruthy();
    expect(document.querySelector(".treasure-object")).toBeNull();
  });
});
