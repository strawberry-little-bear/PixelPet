import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareAdvice, careAdvice } from "./CareAdvice";
import { emptyGrowth } from "./growth";
import { bodyNeed, petNeed } from "./needs";
import type { GrowthStage, PetState } from "./types";

afterEach(cleanup);
const pet = (stage: GrowthStage = "baby") => ({
  hatchedAt: 1, sleeping: true, growth: emptyGrowth(stage),
  needs: { hunger: 80, clean: 80, energy: 40, mood: 10 },
} as PetState);

describe("sleeping care guidance from saved readings", () => {
  const cases = [
    { needs: { energy: 100 }, expected: "体力已满，可以从菜单选「起床啦」" },
    { needs: { energy: 99.999 }, expected: "不必急着叫醒" },
    { needs: { hunger: 10, energy: 100 }, expected: "醒来后优先吃点东西" },
    { needs: { clean: 10, energy: 100 }, expected: "醒来后优先洗澡" },
    { needs: { hunger: 20, clean: 10, energy: 0 }, expected: "醒来后优先洗澡" },
    { needs: { hunger: 10, clean: 10, energy: 0 }, expected: "醒来后优先吃点东西" },
    { needs: { hunger: 50, clean: 30, energy: 0 }, expected: "醒来后优先洗澡" },
    { needs: { hunger: 56, clean: 46, energy: 100 }, expected: "继续睡不会增加休息习惯" },
  ];
  for (const stage of ["baby", "growing", "adult"] as const) {
    it.each(cases)(`${stage} gives actionable advice for $needs`, ({ needs, expected }) => {
      const p = pet(stage); Object.assign(p.needs, needs);
      const original = structuredClone(p);
      const { container } = render(<CareAdvice pet={p} />);
      expect(container.textContent).toContain(expected);
      if (expected.includes("优先")) expect(container.textContent).toContain("先从菜单选「起床啦」");
      expect(container.textContent).not.toMatch(/立刻|必须|倒计时|金币|成长 \+/);
      expect(container.querySelector("button,a,input,[tabindex],[aria-live]")).toBeNull();
      expect(petNeed(p)).toBeNull(); // advice must not wake or animate the pet
      expect(p).toEqual(original);
    });
  }
  it.each([
    [55, 80, "吃点东西"], [56, 45, "洗澡"],
    [25, 20, "洗澡"], [25, 25, "吃点东西"],
  ])("shares awake body thresholds and priority at hunger %s / clean %s", (hunger, clean, expected) => {
    const p = pet(); p.needs = { hunger: Number(hunger), clean: Number(clean), energy: 100, mood: 80 };
    expect(careAdvice(p)).toContain(expected);
    p.sleeping = false; expect(careAdvice(p)).toContain(expected);
  });
  it("keeps existing awake priorities across body threshold combinations", () => {
    const values = [0, 25, 26, 40, 41, 45, 46, 55, 56, 100];
    for (const hunger of values) for (const energy of values) for (const clean of values) {
      const p = pet(); p.sleeping = false;
      p.needs = { hunger, energy, clean, mood: 80 };
      const candidates = [
        { kind: "hungry", value: hunger, threshold: 55 },
        { kind: "tired", value: energy, threshold: 40 },
        { kind: "dirty", value: clean, threshold: 45 },
      ];
      const critical = candidates.filter(n => n.value <= 25).sort((a, b) => a.value - b.value)[0];
      const expected = critical ?? candidates.filter(n => n.value <= n.threshold)
        .sort((a, b) => a.value / a.threshold - b.value / b.threshold)[0];
      expect(bodyNeed(p)).toEqual(expected ? { kind: expected.kind, urgent: !!critical } : null);
      expect(petNeed(p)).toMatchObject({ kind: expected?.kind ?? "content", urgent: !!critical });
    }
  });
  it("updates only from changed saved readings, including old responses without growth", () => {
    const p = pet(); delete p.growth;
    const { container, rerender } = render(<CareAdvice pet={p} />);
    expect(container.textContent).toContain("不必急着叫醒");
    p.needs.energy = 100; rerender(<CareAdvice pet={p} />);
    expect(container.textContent).toContain("体力已满");
    p.needs.hunger = 5; rerender(<CareAdvice pet={p} />);
    expect(container.textContent).toContain("醒来后优先吃点东西");
    p.sleeping = false; rerender(<CareAdvice pet={p} />);
    expect(container.textContent).toContain("现在适合吃点东西");
    expect(container.textContent).not.toContain("起床啦");
  });
});
