import { describe, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { homeVoice } from "./homeVoice";
import { petNeed } from "./needs";
import { species } from "./types";
import type { AdultForm, Needs, PetState } from "./types";

const forms = ["balanced", "lively", "gentle", "easygoing"] as const;
function pet(index: number, form: AdultForm | "" = "", needs: Partial<Needs> = {}): PetState {
  return { schema: 18, revision: 1, species: index, name: species[index], createdAt: 1,
    hatchedAt: 2, lastTick: 3, sleeping: false, careCount: 0, logs: [],
    growth: { ...emptyGrowth("adult"), form },
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80, ...needs } };
}
const anatomy = [/尾/, /翅|翼/, /耳/, /鳍/, /菌/, /爪/, /蹼|后腿/, /爪|耳|尾/, /翼|爪/, /爪|耳|尾/];

describe.each(species.map((name, index) => ({ name, index })))("$name adult companionship", ({ index }) => {
  it.each(forms)("reflects saved %s form, not current habits or an imagined past", form => {
    const saved = pet(index, form), before = structuredClone(saved);
    const voice = homeVoice(index, "adult", "content", form)!;
    expect(voice).toBeTruthy();
    expect(voice).not.toBe(homeVoice(index, "adult", "content"));
    expect([...voice].length).toBeLessThanOrEqual(25);
    expect(voice).toMatch(anatomy[index]);
    expect(voice).not.toMatch(/金币|奖励|签到|每天|上次|昨天|终于|不来|孤单|因为你|必须|最好/);
    if (index === 1) expect(voice).not.toMatch(/手|爪|耳|鳍/);
    if (index === 3) expect(voice).not.toMatch(/手|爪|耳|翅|翼/);
    if (index === 4) expect(voice).not.toMatch(/耳|爪|尾|鳍/);
    if (index === 6) expect(voice).not.toMatch(/耳|爪|尾|鳍|翅|翼/);
    expect(petNeed(saved)).toEqual({ kind: "content", text: voice, urgent: false });
    expect(petNeed(saved)).toEqual(petNeed(saved));
    expect(saved).toEqual(before);
    saved.growth!.care = { nutrition: 200, play: 500, clean: 2, rest: 0, lastFeed: 0, lastPlay: 0, lastClean: 0 };
    saved.growth!.wellbeing = 1;
    expect(petNeed(saved)?.text).toBe(voice);
  });
  it("keeps four distinct adult styles but gives genuine needs priority", () => {
    expect(new Set(forms.map(form => homeVoice(index, "adult", "content", form))).size).toBe(4);
    for (const form of forms) {
      for (const needs of [{ hunger: 10 }, { clean: 15 }, { energy: 20 }, { mood: 40 }, { mood: 60, energy: 44 }]) {
        const saved = pet(index, form, needs);
        expect(petNeed(saved)).toEqual(petNeed(pet(index, "", needs)));
      }
      const saved = pet(index, form);
      expect(petNeed({ ...saved, sleeping: true })).toBeNull();
      expect(petNeed({ ...saved, hatchedAt: 0 })).toBeNull();
      expect(petNeed({ ...saved, game: { startedAt: 3, round: 0, score: 0, lastBeat: -1 } })).toBeNull();
      for (const stage of ["baby", "growing"] as const) {
        saved.growth!.stage = stage;
        expect(petNeed(saved)?.text).toBe(homeVoice(index, stage, "content"));
      }
    }
  });
});

it("keeps neutral adult wording for absent or invalid forms instead of guessing balanced", () => {
  for (const form of [undefined, "", "unknown", "__proto__", "toString", null] as unknown as (AdultForm | undefined)[]) {
    expect(homeVoice(2, "adult", "content", form)).toBe(homeVoice(2, "adult", "content"));
  }
  for (const stage of [undefined, "egg"] as const) expect(homeVoice(2, stage, "content", "gentle")).toBeNull();
  for (const index of [-1, 10, NaN, Infinity, .5]) expect(homeVoice(index, "adult", "content", "gentle")).toBeNull();
});

it("uses explicit, equally warm rabbit wording for all four forms", () => {
  expect(forms.map(form => homeVoice(2, "adult", "content", form))).toEqual([
    "长耳轻轻转向你，陪你听风也看看光",
    "长耳精神地竖起来，想和你听听新声音",
    "长耳软软歇在身侧，安静陪你听风",
    "长耳随意舒展开，我们慢慢待着就好",
  ]);
});
