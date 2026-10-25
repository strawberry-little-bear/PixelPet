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

it.each([
  ["balanced", "", "日常照顾正在慢慢形成均衡的节奏。"],
  ["lively", "play", "陪玩的痕迹更明显一些，它正在长出活力。"],
  ["gentle", "calm", "清洁和休息的痕迹更明显一些，它正在长得安稳。"],
  ["easygoing", "easygoing", "它正在按自己的节奏慢慢长大。"],
] as const)("shows the current growing tendency as provisional feedback: %s", (form, signal, words) => {
  const saved = pet(); saved.growth = emptyGrowth("growing");
  if (form === "balanced") saved.growth.care.nutrition = 1;
  if (signal === "play") saved.growth.care.play = 2;
  if (signal === "calm") saved.growth.care.clean = saved.growth.care.rest = 2;
  if (signal === "easygoing") { saved.growth.trackedHours = 12; saved.growth.wellbeing = 1; }
  const before = structuredClone(saved);
  const { container } = render(<QuietMoment pet={saved} choice={1} replied />);
  const line = container.querySelector(`.quiet-growth-tendency[data-form="${form}"]`);
  expect(line?.textContent).toContain(`当前偏向 · ${formNames[form]}`);
  expect(line?.textContent).toContain(words);
  expect(line?.textContent).toContain("还会随着照顾继续变化");
  expect(saved).toEqual(before);
});

it.each(["empty", "stage progress", "care timestamps"] as const)(
  "keeps growing daydream feedback neutral without saved evidence: %s", scenario => {
    const saved = pet(); saved.growth = emptyGrowth("growing");
    if (scenario === "stage progress") { saved.growth.points = 32; saved.growth.growingAt = 1500; }
    if (scenario === "care timestamps") {
      saved.growth.care.lastFeed = saved.growth.care.lastPlay = saved.growth.care.lastClean = 1500;
    }
    const before = structuredClone(saved);
    const { container } = render(<QuietMoment pet={saved} choice={1} replied />);
    expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
    expect(container.querySelector(".quiet-moment-copy > p")?.textContent).toBe("它轻轻呼了一口气，和你一起发呆。");
    expect(container.querySelector(".quiet-moment-pet")?.getAttribute("data-reaction")).toBe("breathe");
    expect(saved).toEqual(before);
  },
);

it("reveals newly saved growing evidence without replaying the current response or moving reading focus", () => {
  const saved = pet(); saved.growth = emptyGrowth("growing");
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied responseId={1} />);
  const reading = screen.getByRole("region", { name: "无目的互动阅读区" });
  reading.focus();
  const reaction = container.querySelector(".quiet-moment-pet");
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  const updated = structuredClone(saved); updated.revision++; updated.growth!.care.play = 2;
  rerender(<QuietMoment pet={updated} choice={1} replied responseId={1} />);
  expect(container.querySelector('.quiet-growth-tendency[data-form="lively"]')?.textContent).toContain("陪玩的痕迹更明显一些");
  expect(container.querySelector(".quiet-moment-pet")).toBe(reaction);
  expect(reaction?.getAttribute("data-reaction")).toBe("breathe");
  expect(document.activeElement).toBe(reading);
  rerender(<QuietMoment pet={updated} choice={1} replied responseId={2} />);
  expect(container.querySelector(".quiet-moment-pet")?.getAttribute("data-reaction")).toBe("lively");
  rerender(<QuietMoment pet={{ ...updated, sleeping: true }} choice={1} replied={false} responseId={2} />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  expect(container.querySelector(".expression-asleep")).not.toBeNull();
});

it("keeps the provisional tendency read-only and limited to a completed growing quiet moment", () => {
  const saved = pet(); saved.growth = emptyGrowth("growing"); saved.growth.care.play = 2;
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied={false} />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  rerender(<QuietMoment pet={saved} choice={0} replied />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  rerender(<QuietMoment pet={{ ...saved, sleeping: true }} choice={1} replied />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  rerender(<QuietMoment pet={{ ...saved, growth: emptyGrowth("baby") }} choice={1} replied />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  rerender(<QuietMoment pet={{ ...saved, growth: { ...emptyGrowth("adult"), form: "lively" } }} choice={1} replied />);
  expect(container.querySelector(".quiet-growth-tendency")).toBeNull();
  expect(container.querySelector("button,a,input,[role=button]")).toBeNull();
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

it("keeps waiting company consistent with the night atmosphere", () => {
  render(<QuietMoment pet={pet()} choice={1} replied={false}
    now={new Date(2026, 5, 24, 2).getTime()} />);
  expect(document.querySelector(".quiet-atmosphere")?.textContent).toContain("深夜");
  expect(document.querySelector(".quiet-moment-copy > p")?.textContent).not.toContain("阳光");
});

it("uses the saved room in company while keeping furnishings outside the reacting pet", () => {
  const saved = pet();
  saved.economy = { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0,
    owned: ["leaf-pin", "spring-vase", "summer-shell", "autumn-wall", "winter-floor"],
    equipped: { accessory: "leaf-pin", room: "spring-vase", wallpaper: "autumn-wall", floor: "winter-floor" } };
  const before = structuredClone(saved), { home, quiet } = mountBoth(saved);
  const room = quiet.querySelector('.quiet-moment-room')!;
  expect([...room.querySelectorAll('[data-item]')].map(node => node.getAttribute('data-item')))
    .toEqual(["autumn-wall", "winter-floor", "spring-vase"]);
  for (const id of Object.values(saved.economy.equipped)) {
    expect(home.querySelectorAll(`[data-item="${id}"]`)).toHaveLength(1);
    expect(quiet.querySelectorAll(`[data-item="${id}"]`)).toHaveLength(1);
  }
  expect(room.closest('.quiet-moment-pet')).toBeNull();
  expect(room.getAttribute('aria-hidden')).toBe('true');
  expect(quiet.querySelector('[data-item="summer-shell"]')).toBeNull();
  expect(quiet.querySelector('button,a,input,[role=button]')).toBeNull();
  expect(saved).toEqual(before);
});

it("syncs furnishings and removal without replacing the response or reading region", () => {
  const saved = pet();
  saved.economy = { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0,
    owned: ["spring-vase", "patchwork-rug", "meadow-wall"],
    equipped: { accessory: "", room: "spring-vase", wallpaper: "meadow-wall" } };
  const { container, rerender } = render(<QuietMoment pet={saved} choice={1} replied responseId={1} />);
  const actor = container.querySelector('.quiet-moment-pet'), room = container.querySelector('.quiet-moment-room');
  const reading = screen.getByRole('region', { name: '无目的互动阅读区' }); reading.focus();
  for (const equipped of [
    { accessory: "", room: "patchwork-rug", wallpaper: "meadow-wall" },
    { accessory: "", room: "", wallpaper: "" },
  ]) {
    rerender(<QuietMoment pet={{ ...saved, economy: { ...saved.economy, equipped } }} choice={1} replied responseId={1} />);
    expect(container.querySelector('.quiet-moment-pet')).toBe(actor);
    expect(container.querySelector('.quiet-moment-room')).toBe(room);
    expect(screen.getByRole('region', { name: '无目的互动阅读区' })).toBe(reading);
    expect(document.activeElement).toBe(reading);
    expect(room?.querySelectorAll('[data-item]')).toHaveLength(equipped.room ? 2 : 0);
  }
  rerender(<QuietMoment pet={saved} choice={1} replied responseId={2} />);
  expect(container.querySelector('.quiet-moment-pet')).not.toBe(actor);
  expect(container.querySelector('.quiet-moment-room')).toBe(room);
});

it("does not invent furnishings for an old save without economy", () => {
  const { container } = render(<QuietMoment pet={pet()} choice={0} replied={false} />);
  expect(container.querySelector('.quiet-moment-room [data-item]')).toBeNull();
  expect(container.querySelector('.quiet-moment-pet .growth-outfit')).not.toBeNull();
});
