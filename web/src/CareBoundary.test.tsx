import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CarePreview, carePreview, careBaseEffect } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { CareRules, PetState } from "./types";

const rules: CareRules & { needTolerance: number } = {
  awake: { hunger: -3, mood: -2.5, clean: -2, energy: -2 },
  sleeping: { hunger: -3, mood: 0, clean: -2, energy: 14 }, maxOfflineHours: 12,
  actions: { feed: { hunger: 20, mood: 3, clean: -3, energy: 0 }, clean: { hunger: 0, mood: 4, clean: 35, energy: 0 } },
  needTolerance: 1e-9,
};
const now = Date.UTC(2026, 9, 20);
function pet(stage: "baby" | "growing" | "adult" = "baby"): PetState {
  return { schema: 17, revision: 1, species: 2, name: "小伙伴", createdAt: now - 7200000,
    hatchedAt: now - 7200000, lastTick: now, sleeping: false, careCount: 0,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, growth: emptyGrowth(stage), logs: [] };
}
const kinds = [{ kind: "feed", key: "hunger", needed: 70, full: 96 }, { kind: "clean", key: "clean", needed: 65, full: 99 }] as const;
afterEach(cleanup);
for (const stage of ["baby", "growing", "adult"] as const) for (const c of kinds) {
  it.each([-5e-10, 0, 5e-10])(`${stage}/${c.kind} keeps habit eligibility at numerical boundary %g`, delta => {
    const p = pet(stage); p.needs[c.key] = c.needed + delta;
    const before = structuredClone(p);
    render(<CarePreview pet={p} kind={c.kind} hint="" rules={rules} />);
    expect(carePreview(p, c.kind, rules).join("")).toContain("符合记录习惯");
    expect(document.querySelector(".care-rounded-reading")).toBeNull();
    expect(careBaseEffect(p, c.kind, rules)).not.toBeNull();
    expect(p).toEqual(before);
  });
  it.each([-5e-10, 0, 5e-10])(`${stage}/${c.kind} keeps full action unavailable at numerical boundary %g`, delta => {
    const p = pet(stage); p.needs[c.key] = c.full + delta;
    render(<CarePreview pet={p} kind={c.kind} hint="" rules={rules} />);
    expect(carePreview(p, c.kind, rules).join("")).toContain(c.kind === "feed" ? "暂时不能喂食" : "暂时不用洗澡");
    expect(careBaseEffect(p, c.kind, rules)).toBeNull();
    expect(document.querySelector(".care-rounded-reading")).toBeNull();
  });
}
for (const c of kinds) {
  it("does not widen " + c.kind + " boundaries by a meaningful fraction", () => {
    const p = pet(); p.needs[c.key] = c.needed + 2e-9;
    render(<CarePreview pet={p} kind={c.kind} hint="" rules={rules} />);
    expect(carePreview(p, c.kind, rules).join("")).toContain("本次不记");
    expect(document.querySelector(".care-rounded-reading")?.textContent).toContain("实际高于");
    p.needs[c.key] = c.full - 2e-9;
    expect(carePreview(p, c.kind, rules).join("")).toContain(c.kind === "feed" ? "补充饱食" : "恢复清洁");
    expect(careBaseEffect(p, c.kind, rules)).not.toBeNull();
  });
  it("keeps " + c.kind + " cooldown independent of numerical boundary", () => {
    const p = pet(); p.needs[c.key] = c.needed + 5e-10;
    const key = c.kind === "feed" ? "lastFeed" : "lastClean";
    p.growth!.care[key] = now - 30 * 60000 + 1;
    expect(carePreview(p, c.kind, rules).join("")).toContain("间隔内");
    p.lastTick++;
    expect(carePreview(p, c.kind, rules).join("")).toContain("符合记录习惯");
  });
  it.each([undefined, null, NaN, Infinity, -1, 1e-6, "1e-9"])("keeps legacy/invalid tolerance %j exact for " + c.kind, needTolerance => {
    const p = pet(); const r = { ...rules, needTolerance } as unknown as CareRules;
    p.needs[c.key] = c.needed + 5e-10;
    expect(carePreview(p, c.kind, r).join("")).toContain("本次不记");
    p.needs[c.key] = c.full - 5e-10;
    expect(careBaseEffect(p, c.kind, r)).not.toBeNull();
  });
}
it("keeps sleep precision separate without extra LCD controls", () => {
  const p = pet(); p.needs.energy = 100 - 5e-10;
  render(<CarePreview pet={p} kind="sleep" hint="" rules={rules} />);
  expect(document.querySelector(".care-rounded-reading")?.textContent).toContain("实际低于 100");
  expect(document.querySelectorAll("button,input,a,[tabindex],[aria-live]")).toHaveLength(0);
});
