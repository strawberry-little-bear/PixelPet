import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { emptyGrowth } from "./growth";
import { QuietMoment } from "./QuietMoment";
import type { AdultForm, Growth, PetState } from "./types";

const pet = (growth?: Growth): PetState => ({
  schema: 22, revision: 1, species: 4, name: "安静伙伴", createdAt: 1000,
  hatchedAt: 1000, lastTick: 2000, sleeping: false,
  needs: { hunger: 60, mood: 70, clean: 60, energy: 80 }, careCount: 0,
  logs: [], growth,
});
afterEach(cleanup);
const reaction = (container: HTMLElement) => container.querySelector(".quiet-moment-pet")!;

it("announces only the current response, not the changing ambient reading scene", () => {
  const saved = pet(emptyGrowth("baby"));
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied={false} now={1000} />);
  const response = container.querySelector(".quiet-moment-copy > p");
  expect(response?.getAttribute("role")).toBe("status");
  expect(response?.getAttribute("aria-live")).toBe("polite");
  expect(response?.getAttribute("aria-atomic")).toBe("true");
  expect(container.querySelector(".quiet-moment")?.hasAttribute("aria-live")).toBe(false);

  const idle = response?.textContent;
  rerender(<QuietMoment pet={saved} choice={1} replied={false} now={new Date(2026, 6, 1, 12).getTime()} />);
  expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  expect(container.querySelector(".quiet-moment-copy > p")?.textContent).toBe(idle);
});

it("reserves the curious baby response for daydreaming, including the first explicit B", () => {
  const saved = pet(emptyGrowth("baby"));
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied={false} />);
  const idle = reaction(container);
  rerender(<QuietMoment pet={saved} choice={1} replied />);
  expect(reaction(container)).not.toBe(idle);
  expect(reaction(container).getAttribute("data-reaction")).toBe("peek");
  for (const choice of [0, 2]) {
    rerender(<QuietMoment pet={saved} choice={choice} replied />);
    expect(reaction(container).getAttribute("data-reaction")).toBe("breathe");
  }
});

it("keeps a response fixed while ordinary sync updates care and authoritative artwork", () => {
  const growing = emptyGrowth("growing"); growing.care.play = 2;
  const saved = pet(growing), before = structuredClone(saved);
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied responseId={1} />);
  const first = reaction(container);
  expect(first.getAttribute("data-reaction")).toBe("lively");
  const calm = { ...growing, care: { ...growing.care, play: 0, clean: 3, rest: 3 } };
  rerender(<QuietMoment pet={{ ...saved, revision: 2, growth: calm }} choice={1} replied responseId={1} />);
  expect(reaction(container)).toBe(first);
  expect(first.getAttribute("data-reaction")).toBe("lively");
  rerender(<QuietMoment pet={{ ...saved, growth: calm }} choice={1} replied responseId={2} />);
  expect(reaction(container)).not.toBe(first);
  expect(reaction(container).getAttribute("data-reaction")).toBe("gentle");
  const second = reaction(container);
  rerender(<QuietMoment pet={{ ...saved, growth: { ...calm, stage: "adult", form: "easygoing" } }} choice={1} replied responseId={2} />);
  expect(reaction(container)).toBe(second);
  expect(second.classList.contains("growth-adult")).toBe(true);
  expect(container.querySelector(".growth-form-emblem")).not.toBeNull();
  expect(second.getAttribute("data-reaction")).toBe("gentle");
  expect(saved).toEqual(before);
});

it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])(
  "uses saved adult %s even when current care suggests a different form", form => {
    const growth = emptyGrowth("adult"); growth.form = form;
    growth.care.play = form === "lively" ? 0 : 20;
    growth.care.clean = form === "lively" ? 20 : 0;
    growth.care.rest = growth.care.clean;
    const saved = pet(growth), before = structuredClone(saved);
    const { container } = render(<QuietMoment pet={saved} choice={1} replied />);
    expect(reaction(container).getAttribute("data-reaction")).toBe(form === "balanced" ? "breathe" : form);
    expect(container.querySelector(".quiet-form-line")?.getAttribute("data-form")).toBe(form);
    expect(saved).toEqual(before);
  },
);

it("does not invent a personality from missing history, an egg or an unformed adult", () => {
  const { container, rerender } = render(<QuietMoment pet={pet()} choice={1} replied />);
  expect(reaction(container).getAttribute("data-reaction")).toBe("breathe");
  for (const [index, stage] of (["egg", "growing", "adult"] as const).entries()) {
    rerender(<QuietMoment pet={pet(emptyGrowth(stage))} choice={1} replied responseId={index + 1} />);
    expect(reaction(container).getAttribute("data-reaction")).toBe("breathe");
  }
});

it("uses saved growing rest/wellbeing traces without making them adult forms", () => {
  const growth = emptyGrowth("growing"); growth.trackedHours = 12; growth.wellbeing = 1;
  const { container } = render(<QuietMoment pet={pet(growth)} choice={1} replied />);
  expect(reaction(container).getAttribute("data-reaction")).toBe("easygoing");
  expect(container.querySelector(".growth-form-emblem")).toBeNull();
});

it("keeps sleeping company asleep and waits for a fresh reply after wake", () => {
  const saved = { ...pet(emptyGrowth("baby")), sleeping: true };
  const before = structuredClone(saved);
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied />);
  expect(container.querySelector('.quiet-moment[data-sleeping="true"] .motion-sleeping')).not.toBeNull();
  expect(container.querySelector(".expression-asleep")).not.toBeNull();
  expect(container.querySelector(".quiet-growth-tendency,.quiet-form-line")).toBeNull();
  rerender(<QuietMoment pet={{ ...saved, sleeping: false }} choice={1} replied={false} />);
  expect(container.querySelector('.quiet-moment[data-replied="false"]')).not.toBeNull();
  expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(saved).toEqual(before);
});
