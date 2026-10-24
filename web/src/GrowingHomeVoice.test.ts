import { describe, expect, it } from "vitest";
import { emptyGrowth, tendency } from "./growth";
import { growingHomeVoice, homeVoice } from "./homeVoice";
import { petNeed } from "./needs";
import type { AdultForm, PetState } from "./types";

const forms = ["balanced", "lively", "gentle", "easygoing"] as const;
const basePet = (growth = emptyGrowth("growing")): PetState => ({
  schema: 19, revision: 1, species: 2, name: "草莓兔", createdAt: 1, hatchedAt: 2, lastTick: 3,
  sleeping: false, careCount: 0, logs: [], growth,
  needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
});

function growthFor(form: AdultForm) {
  const growth = emptyGrowth("growing");
  growth.trackedHours = form === "easygoing" ? 12 : 1;
  growth.wellbeing = form === "easygoing" ? 0 : 80;
  growth.care.play = form === "lively" ? 3 : 0;
  growth.care.clean = form === "gentle" ? 3 : 0;
  growth.care.rest = form === "gentle" ? 2 : 0;
  return growth;
}

describe("growing home companionship", () => {
  it.each(forms)("uses the current %s tendency as a present-tense calm cue", form => {
    const growth = growthFor(form);
    expect(tendency(growth)).toBe(form);
    const before = structuredClone(growth);
    const content = growingHomeVoice(2, growth, "content");
    const quiet = growingHomeVoice(2, growth, "quiet");
    expect(content).toContain(form === "lively" ? "想和你动一动" : form === "gentle" ? "想安静靠近你" : form === "easygoing" ? "按自己的节奏来" : "和你待着刚刚好");
    expect(quiet).toContain(form === "lively" ? "歇够了再出发" : form === "gentle" ? "把这一刻放慢" : form === "easygoing" ? "不赶时间就好" : "今天慢慢来");
    expect(content).toContain(homeVoice(2, "growing", "content")!);
    expect(quiet).toContain(homeVoice(2, "growing", "quiet")!);
    expect(growth).toEqual(before);
  });

  it("keeps the original stage voice until a saved habit counter has evidence", () => {
    const growth = emptyGrowth("growing");
    expect(growingHomeVoice(2, growth, "content")).toBe(homeVoice(2, "growing", "content"));
    expect(growingHomeVoice(2, growth, "quiet")).toBe(homeVoice(2, "growing", "quiet"));
  });

  it("lets calm tendency cues flow through the home need without overriding a real need", () => {
    const growing = basePet(growthFor("lively"));
    expect(petNeed(growing)?.text).toContain("想和你动一动");
    growing.needs.hunger = 10;
    expect(petNeed(growing)).toMatchObject({ kind: "hungry", text: "小肚子咕噜咕噜，想吃点东西", urgent: true });
    expect(petNeed({ ...growing, sleeping: true })).toBeNull();
    expect(petNeed({ ...growing, game: { startedAt: 3, round: 0, score: 0, lastBeat: -1 } })).toBeNull();
  });

  it("keeps adult saved forms and legacy stages on their existing voice path", () => {
    const adult = { ...emptyGrowth("adult"), form: "gentle" as const };
    expect(growingHomeVoice(2, adult, "content")).toBe(homeVoice(2, "adult", "content", "gentle"));
    expect(growingHomeVoice(2, undefined, "content")).toBeNull();
    expect(growingHomeVoice(2, emptyGrowth("baby"), "content")).toBe(homeVoice(2, "baby", "content"));
  });
});
