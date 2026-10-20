import { describe, expect, it } from "vitest";
import { petNeed } from "./needs";
import { homeVoice } from "./homeVoice";
import { emptyGrowth } from "./growth";
import { species } from "./types";
import type { GrowthStage, Needs, PetState } from "./types";
const stages = ["baby", "growing", "adult"] as const;
const pet = (index: number, stage?: GrowthStage, needs: Partial<Needs> = {}): PetState => ({
  schema: 17, revision: 1, species: index, name: species[index], createdAt: 1, hatchedAt: 2, lastTick: 3,
  sleeping: false, careCount: 0, logs: [], ...(stage ? { growth: emptyGrowth(stage) } : {}),
  needs: { hunger: 80, mood: 80, clean: 80, energy: 80, ...needs },
});
const cues = { content: {}, quiet: { mood: 60, energy: 44 } } as const;

describe.each(species.map((name, index) => ({ name, index })))("$name stage companionship", ({ index }) => {
  it.each(stages)("uses recorded %s voices for both calm moods, deterministically without mutating state", stage => {
    for (const [kind, needs] of Object.entries(cues)) {
      const saved = pet(index, stage, needs), before = structuredClone(saved);
      const voice = homeVoice(index, stage, kind)!;
      expect(voice).toBeTruthy();
      expect([...voice].length).toBeLessThanOrEqual(25);
      expect(petNeed(saved)).toEqual({ kind, text: voice, urgent: false });
      expect(petNeed(saved)).toEqual(petNeed(saved));
      expect(saved).toEqual(before);
      expect(voice).not.toMatch(/金币|奖励|签到|每天|上次|昨天|喂我|终于|不来|孤单/);
    }
  });
  it("has distinct stage voices and does not infer legacy or younger stages from age or form", () => {
    for (const kind of Object.keys(cues)) {
      expect(new Set(stages.map(stage => homeVoice(index, stage, kind))).size).toBe(3);
      expect(homeVoice(index, undefined, kind)).toBeNull();
      expect(homeVoice(index, "egg", kind)).toBeNull();
      expect(petNeed(pet(index))).toEqual(petNeed({ ...pet(index), hatchedAt: 1, lastTick: 999999999 }));
      for (const stage of stages) for (const form of ["balanced", "lively", "gentle", "easygoing"] as const) {
        const saved = pet(index, stage);
        saved.growth!.form = form;
        expect(petNeed(saved)?.text).toBe(homeVoice(index, stage, "content", stage === "adult" ? form : undefined));
      }
    }
  });
  it.each(stages)("does not override care needs, play invitation, sleep, egg or active games at %s", stage => {
    for (const needs of [{ hunger: 10 }, { energy: 20 }, { clean: 15 }, { mood: 40 }, { hunger: 40 }, { energy: 35 }, { clean: 40 }]) {
      const saved = pet(index, stage, needs), legacy = { ...saved }; delete legacy.growth;
      expect(petNeed(saved)).toEqual(petNeed(legacy));
    }
    const saved = pet(index, stage);
    expect(petNeed({ ...saved, sleeping: true })).toBeNull();
    expect(petNeed({ ...saved, hatchedAt: 0 })).toBeNull();
    expect(petNeed({ ...saved, game: { startedAt: 3, round: 0, score: 0, lastBeat: -1 } })).toBeNull();
  });
});

it("falls back for unknown species, unsupported stage and non-calm signals", () => {
  for (const index of [-1, 10, 0.5, NaN, Infinity]) expect(homeVoice(index, "baby", "content")).toBeNull();
  expect(homeVoice(0, "unknown" as GrowthStage, "content")).toBeNull();
  for (const kind of ["hungry", "dirty", "tired", "playful", "sleeping", "unknown"]) expect(homeVoice(0, "baby", kind)).toBeNull();
});

it("provides sixty distinct brief voices without mixing species anatomy", () => {
  const all = species.flatMap((_, index) => stages.flatMap(stage => Object.keys(cues).map(kind => homeVoice(index, stage, kind))));
  expect(all).toHaveLength(60);
  expect(new Set(all).size).toBe(60);
  const anatomy = [ /尾/, /翅|翼/, /耳/, /鳍/, /菌/, /爪/, /蹼|后腿/, /爪|耳|尾/, /翼|爪/, /爪|耳|尾/ ];
  for (let index = 0; index < species.length; index++) for (const stage of stages) for (const kind of Object.keys(cues)) {
    const voice = homeVoice(index, stage, kind)!;
    expect(voice).toMatch(anatomy[index]);
    if (index === 1) expect(voice).not.toMatch(/手|爪|耳|鳍/);
    if (index === 3) expect(voice).not.toMatch(/手|爪|耳|翅|翼/);
    if (index === 4) expect(voice).not.toMatch(/耳|爪|尾|鳍/);
    if (index === 6) expect(voice).not.toMatch(/耳|爪|尾|鳍|翅|翼/);
  }
});
