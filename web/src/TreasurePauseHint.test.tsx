import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TreasureGame } from "./TreasureGame";
import { treasureMenu } from "./treasure";
import type { PetState } from "./types";

const now = Date.parse("2026-10-21T02:00:00Z");
function fixture(): PetState {
  return { schema: 17, revision: 1, species: 2, name: "寻宝伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "treasure", startedAt: now,
      round: 0, score: 0, lastBeat: -1, treasure: { layout: [1, 2, 3, 0, 0, 0, 0, 0, 0],
        opened: [0, 3], step: 4, paused: true } } };
}
const hints = [
  "B / C 继续后仍选中 2 号未探索格；A 换格、B 探索一次，不会自动探索。",
  "B 重看本局两页规则；C 返回暂停，不消耗探索次数。",
  "B 先打开放弃确认，A / C 可取消；确认放弃才丢弃本局，不发金币或陪伴奖励。",
];
afterEach(cleanup);
describe("Treasure pause choice consequences", () => {
  it.each(hints.map((hint, choice) => ({ hint, choice })))("explains choice $choice without changing saved progress", ({ hint, choice }) => {
    const pet = fixture(), before = structuredClone(pet);
    const view = render(<TreasureGame pet={pet} active cursor={1} choice={choice} />);
    const note = view.container.querySelector(".treasure-pause-hint");
    expect(note?.textContent).toBe(hint);
    expect(note?.getAttribute("aria-live")).toBe("polite");
    expect(note?.getAttribute("aria-atomic")).toBe("true");
    expect(view.container.querySelector('.treasure-pause [aria-current="true"]')?.textContent).toContain(treasureMenu[choice]);
    expect(view.container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(pet).toEqual(before);
  });
  it("changes only the explanation when choosing a different pause action", () => {
    const pet = fixture(), view = render(<TreasureGame pet={pet} active cursor={1} choice={1} />);
    view.rerender(<TreasureGame pet={pet} active cursor={1} choice={2} />);
    expect(view.container.querySelectorAll(".treasure-pause-hint")).toHaveLength(1);
    expect(view.container.querySelector(".treasure-pause-hint")?.textContent).toBe(hints[2]);
    expect(view.getByRole("gridcell", { name: /^2号格/ }).getAttribute("aria-selected")).toBe("true");
  });
  it("uses the current selection, not a saved or predicted destination", () => {
    const pet = fixture(), view = render(<TreasureGame pet={pet} active cursor={1} choice={0} />);
    view.rerender(<TreasureGame pet={pet} active cursor={8} choice={0} />);
    expect(view.container.querySelector(".treasure-pause-hint")?.textContent).toContain("仍选中 9 号未探索格");
  });
  it("explains a local pause after refresh without claiming the server is paused", () => {
    const pet = fixture(); pet.game!.treasure!.paused = false;
    const view = render(<TreasureGame pet={pet} active={false} cursor={1} choice={0} />);
    expect(view.container.querySelector(".treasure-pause-hint")?.textContent).toBe(hints[0]);
    expect(pet.game!.treasure!.paused).toBe(false);
  });
  it("does not give different hints for unseen objects", () => {
    const pet = fixture(), view = render(<TreasureGame pet={pet} active cursor={1} choice={0} />);
    const before = view.container.querySelector(".treasure-pause-hint")?.textContent;
    pet.game!.treasure!.layout = [1, 0, 0, 0, 0, 0, 0, 2, 3];
    view.rerender(<TreasureGame pet={pet} active cursor={1} choice={0} />);
    expect(before).toBe(hints[0]);
    expect(view.container.querySelector(".treasure-pause-hint")?.textContent).toBe(before);
  });
  it("does not add pause text to an actively running board", () => {
    const pet = fixture(); pet.game!.treasure!.paused = false;
    const view = render(<TreasureGame pet={pet} active cursor={1} choice={0} />);
    expect(view.container.querySelector(".treasure-pause-hint")).toBeNull();
    expect(view.container.querySelector(".treasure-status")?.textContent).toContain("2号格 · 未探索 · B 探索");
  });
  it.each([{ opened: [3, 4, 5, 6, 7, 8] }, { opened: [0, 1, 2] }])("keeps completed board $opened focused on explicit collection", ({ opened }) => {
    const pet = fixture(); pet.game!.treasure!.opened = opened;
    const view = render(<TreasureGame pet={pet} active cursor={1} choice={2} />);
    expect(view.container.querySelector(".treasure-pause-hint")).toBeNull();
    expect(view.container.querySelector(".treasure-status")?.textContent).toContain("B / C 收好");
  });
  it("does not invent a pause explanation without a treasure board", () => {
    const pet = fixture(); delete pet.game!.treasure;
    const view = render(<TreasureGame pet={pet} active cursor={1} choice={0} />);
    expect(view.container.textContent).toBe("");
  });
});
