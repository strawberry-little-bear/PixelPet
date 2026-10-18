import { describe, expect, it } from "vitest";
import { petNeed } from "./needs";
import type { Needs, PetState } from "./types";
const pet = (needs: Partial<Needs> = {}): PetState => ({ schema:2, revision:1, species:2, name:"草莓兔", createdAt:1, hatchedAt:2, lastTick:3, sleeping:false, careCount:0, logs:[], needs:{ hunger:80, mood:80, clean:80, energy:80, ...needs } });
describe("deterministic proactive needs", () => {
  it.each([
    [{hunger:25,energy:10,mood:0}, "tired", true],
    [{hunger:10,energy:10,clean:10}, "hungry", true],
    [{hunger:40,energy:80}, "hungry", false],
    [{energy:35,mood:0}, "tired", false],
    [{clean:20,mood:0}, "dirty", true],
    [{mood:40}, "playful", false],
    [{mood:60,energy:44}, "quiet", false],
    [{hunger:56,mood:61,clean:46,energy:41}, "content", false],
  ] as const)("selects one signal for %j", (needs, kind, urgent) => {
    const p=pet(needs), before=structuredClone(p);
    expect(petNeed(p)).toMatchObject({kind, urgent});
    expect(petNeed(p)).toEqual(petNeed(p));
    expect(p).toEqual(before);
  });
  it("never invites play with hunger, low energy, dirty body, sleep or a running game", () => {
    for (const n of [{hunger:55},{energy:40},{clean:45}]) expect(petNeed(pet({...n,mood:0}))?.kind).not.toBe("playful");
    expect(petNeed({...pet({hunger:0,mood:0}),sleeping:true})).toBeNull();
    expect(petNeed({...pet({mood:0}),game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
    expect(petNeed({...pet(),hatchedAt:0})).toBeNull();
    expect(petNeed(null)).toBeNull();
  });
  it("describes dolphin fins without changing deterministic priorities or saved data", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), dolphin={...original,species:3}, before=structuredClone(dolphin);
      const a=petNeed(original)!, b=petNeed(dolphin)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toContain("鳍");
      expect(b).toEqual(petNeed(dolphin));
      expect(dolphin).toEqual(before);
    }
    expect(petNeed({...pet(),species:3,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:3,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("describes mushroom gestures without changing priorities, save data or suppression", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), mushroom={...original,species:4}, before=structuredClone(mushroom);
      const a=petNeed(original)!, b=petNeed(mushroom)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toMatch(/菌盖|小手/);
      expect(b.text).not.toMatch(/鳍|耳|尾/);
      expect(b).toEqual(petNeed(mushroom));
      expect(mushroom).toEqual(before);
    }
    expect(petNeed({...pet(),species:4,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:4,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("describes bear paws without changing deterministic priority, data or sleep/game suppression", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), bear={...original,species:5}, before=structuredClone(bear);
      const a=petNeed(original)!, b=petNeed(bear)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toMatch(/爪|揉揉眼睛|圆耳/);
      expect(b.text).not.toMatch(/鳍|菌盖|翼/);
      expect(b).toEqual(petNeed(bear));
      expect(bear).toEqual(before);
    }
    expect(petNeed({...pet(),species:5,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:5,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("describes frog webs without changing priorities, saved forms, or sleep/game suppression", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), frog={...original,species:6}, before=structuredClone(frog);
      const a=petNeed(original)!, b=petNeed(frog)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toContain("蹼");
      expect(b.text).not.toMatch(/鳍|菌盖|耳|爪|翼/);
      expect(b).toEqual(petNeed(frog));
      expect(frog).toEqual(before);
    }
    expect(petNeed({...pet(),species:6,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:6,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("describes dragon wings, horns and claws without changing deterministic need rules", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), dragon={...original,species:8}, before=structuredClone(dragon);
      const a=petNeed(original)!, b=petNeed(dragon)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toMatch(/爪|翼|星角/);
      expect(b.text).not.toMatch(/鳍|菌盖|蹼|耳/);
      expect(b).toEqual(petNeed(dragon));
      expect(dragon).toEqual(before);
    }
    expect(petNeed({...pet(),species:8,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:8,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("describes dog paws, hanging ears and tail without changing saved state or priorities", () => {
    for (const needs of [{hunger:10},{energy:20},{clean:15},{mood:40},{mood:60,energy:44},{}]) {
      const original=pet(needs), dog={...original,species:9}, before=structuredClone(dog);
      const a=petNeed(original)!, b=petNeed(dog)!;
      expect(b.kind).toBe(a.kind);
      expect(b.urgent).toBe(a.urgent);
      expect(b.text).toMatch(/爪|耳|尾/);
      expect(b.text).not.toMatch(/鳍|菌盖|蹼|翼|星角/);
      expect(b).toEqual(petNeed(dog));
      expect(dog).toEqual(before);
    }
    expect(petNeed({...pet(),species:9,sleeping:true})).toBeNull();
    expect(petNeed({...pet(),species:9,game:{startedAt:2,round:0,score:0,lastBeat:-1}})).toBeNull();
  });
  it("stops hunger as soon as a saved meal has filled the pet", () => {
    const p=pet({hunger:50}); expect(petNeed(p)?.kind).toBe("hungry");
    p.needs.hunger=70; expect(petNeed(p)?.kind).toBe("content");
    p.needs.clean=20; expect(petNeed(p)?.kind).toBe("dirty");
    p.needs.clean=55; expect(petNeed(p)?.kind).toBe("content");
  });
});
