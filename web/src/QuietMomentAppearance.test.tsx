import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { emptyGrowth, formNames, stageNames } from "./growth";
import { PetScene } from "./PetScene";
import { QuietMoment } from "./QuietMoment";
import type { AdultForm, PetState } from "./types";

const pet = (): PetState => ({
  schema: 17, revision: 1, species: 2, name: "成长伙伴", createdAt: 1000,
  hatchedAt: 1000, lastTick: 2000, sleeping: false,
  needs: { hunger: 60, mood: 70, clean: 60, energy: 80 }, careCount: 0,
  logs: [], growth: emptyGrowth("baby"),
});
afterEach(cleanup);

function compareWithHome(saved: PetState, home: HTMLElement, quiet: HTMLElement) {
  for (const selector of [".growth-outfit", ".growth-form-emblem", ".equipped-accessory"]) {
    expect(quiet.querySelector(selector)?.outerHTML).toBe(home.querySelector(selector)?.outerHTML);
  }
  expect(quiet.querySelector(".growth-size")?.className).toBe(home.querySelector(".growth-size")?.className);
  expect(quiet.querySelector(".quiet-growth-label")?.textContent).toContain(stageNames[saved.growth!.stage]);
}
function mountBoth(saved: PetState) {
  const home = render(<PetScene index={saved.species} stage={saved.growth!.stage} form={saved.growth!.form}
    motion="idle" dirty={false} clipId={0} equipped={saved.economy?.equipped} />);
  const quiet = render(<QuietMoment pet={saved} choice={0} replied={false} />);
  return { home: home.container, quiet: quiet.container };
}

it.each(["baby", "growing"] as const)("keeps the saved %s outfit when entering quiet company", stage => {
  const saved = pet(); saved.growth = emptyGrowth(stage);
  const before = structuredClone(saved), { home, quiet } = mountBoth(saved);
  compareWithHome(saved, home, quiet);
  expect(quiet.querySelector(".growth-outfit")).not.toBeNull();
  expect(quiet.querySelector(".growth-form-emblem")).toBeNull();
  expect(saved).toEqual(before);
});

it.each(["balanced", "lively", "gentle", "easygoing"] as AdultForm[])("keeps saved adult form %s rather than recalculating it from habits", form => {
  const saved = pet(); saved.growth = emptyGrowth("adult"); saved.growth.form = form;
  saved.growth.care.play = form === "lively" ? 0 : 100;
  saved.growth.care.clean = saved.growth.care.rest = form === "lively" ? 100 : 0;
  const before = structuredClone(saved), { home, quiet } = mountBoth(saved);
  compareWithHome(saved, home, quiet);
  expect(quiet.querySelector(".growth-form-emblem")).not.toBeNull();
  expect(quiet.querySelector(".quiet-growth-label")?.textContent).toBe(`成年期 · ${formNames[form]}`);
  expect(saved).toEqual(before);
});


it.each([
  ["balanced", "它安稳地陪在你身边"],
  ["lively", "发呆完就想和你去冒险"],
  ["gentle", "把动作放得很轻"],
  ["easygoing", "按自己的节奏眨眨眼"],
] as const)("shows the saved adult tendency in quiet company: %s", (form, words) => {
  const saved = pet(); saved.growth = emptyGrowth("adult"); saved.growth.form = form;
  const { container } = render(<QuietMoment pet={saved} choice={1} replied />);
  expect(container.querySelector(`.quiet-form-line[data-form="${form}"]`)?.textContent).toContain(words);
});

it.each([
  ["baby", ""], ["growing", ""], ["adult", "gentle"],
] as const)("only shows a saved adult tendency after the quiet reply: %s", (stage, form) => {
  const saved = pet(); saved.growth = emptyGrowth(stage); saved.growth.form = form;
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied={false} />);
  expect(container.querySelector(".quiet-form-line")).toBeNull();
  rerender(<QuietMoment pet={saved} choice={0} replied />);
  expect(container.querySelector(".quiet-form-line")).toBeNull();
});

it("keeps one equipped accessory in place of the default outfit, with the adult emblem", () => {
  const saved = pet(); saved.growth = emptyGrowth("adult"); saved.growth.form = "gentle";
  saved.economy = { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: ["leaf-pin"],
    equipped: { accessory: "leaf-pin", room: "" } };
  const { home, quiet } = mountBoth(saved);
  compareWithHome(saved, home, quiet);
  expect(quiet.querySelectorAll('.equipped-accessory[data-item="leaf-pin"]')).toHaveLength(1);
  expect(quiet.querySelector(".growth-outfit")).toBeNull();
  expect(quiet.querySelector(".growth-form-emblem")).not.toBeNull();
});

it("refreshes saved stage and form during sleep/wake sync without waking the artwork", () => {
  const saved = pet(), { container, rerender } = render(<QuietMoment pet={saved} choice={0} replied />);
  const asleep = { ...saved, sleeping: true, growth: { ...emptyGrowth("adult"), form: "easygoing" as const } };
  rerender(<QuietMoment pet={asleep} choice={0} replied />);
  expect(container.querySelector('.quiet-moment-pet.growth-adult.motion-sleeping')).not.toBeNull();
  expect(container.querySelector('.expression-asleep.rig-motion-sleeping')).not.toBeNull();
  expect(screen.getByText("成年期 · 自在型")).toBeTruthy();
  const emblem = container.querySelector(".growth-form-emblem")?.outerHTML;
  rerender(<QuietMoment pet={{ ...asleep, sleeping: false }} choice={1} replied={false} />);
  expect(container.querySelector(".motion-sleeping")).toBeNull();
  expect(container.querySelector(".growth-form-emblem")?.outerHTML).toBe(emblem);
});

it("does not invent a saved stage/form for legacy data, or dress an egg as an adult", () => {
  const saved = pet(); delete saved.growth;
  const { container, rerender } = render(<QuietMoment pet={saved} choice={0} replied={false} />);
  expect(container.querySelector(".quiet-growth-label")).toBeNull();
  expect(container.querySelector(".growth-outfit")).toBeNull();
  expect(container.querySelector(".growth-form-emblem")).toBeNull();
  rerender(<QuietMoment pet={{ ...saved, growth: emptyGrowth("egg") }} choice={0} replied={false} />);
  expect(screen.getByText("等待孵化")).toBeTruthy();
  expect(container.querySelector(".growth-outfit")).toBeNull();
  expect(container.querySelector(".growth-form-emblem")).toBeNull();
});
it("shows a present local-time atmosphere without adding a control or changing the pet", () => {
  const saved = pet(); const before = structuredClone(saved);
  const { container } = render(<QuietMoment pet={saved} choice={1} replied={false} now={new Date(2026, 9, 24, 18).getTime()} />);
  expect(container.querySelector(".quiet-atmosphere")?.getAttribute("data-period")).toBe("dusk");
  expect(container.querySelector(".quiet-atmosphere")?.textContent).toContain("晚霞");
  expect(container.querySelector(".quiet-event")?.getAttribute("data-season")).toBe("autumn");
  expect(container.querySelector(".quiet-event")?.textContent).toContain("秋日小事");
  expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(saved).toEqual(before);
});

it("does not show present-time atmosphere while the pet is sleeping", () => {
  const saved = { ...pet(), sleeping: true };
  const { container } = render(<QuietMoment pet={saved} choice={1} replied={false} now={new Date(2026, 9, 24, 18).getTime()} />);
  expect(container.querySelector(".quiet-atmosphere")).toBeNull();
});

it("lets one saved game interest surface as a passive quiet response", () => {
  const saved = pet();
  saved.companion = { since: 1000, interests: [{ kind: "fishing", points: 3, lastAt: 1500 }] };
  const before = structuredClone(saved);
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied now={2000} />);
  expect(container.querySelector(".quiet-interest")?.getAttribute("data-game")).toBe("fishing");
  expect(container.querySelector(".quiet-interest")?.textContent).toContain("池塘边的等待");
  expect(saved).toEqual(before);
  rerender(<QuietMoment pet={{ ...saved, sleeping: true }} choice={1} replied now={2000} />);
  expect(container.querySelector(".quiet-interest")).toBeNull();
});
