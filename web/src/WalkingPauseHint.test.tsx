import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalkingGame } from "./WalkingGame";
import { walkMenu } from "./walk";
import type { PetState } from "./types";

const now = Date.parse("2026-10-21T04:00:00Z");
function fixture(): PetState {
  return { schema: 17, revision: 1, species: 3, name: "散步伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "walk", startedAt: now,
      round: 0, score: 0, lastBeat: -1, walking: { route: Array(12).fill("rock"),
        souvenirs: ["leaf", "shell", "flower"], beat: 28, step: 30, cleared: 3,
        pose: "", poseUntil: 0, lastPulseAt: now, lastInputAt: 0, paused: true } } };
}
const hints = [
  "B / C 从第 29 步继续自动前进，不补走离开期间的路。",
  "B 查看永久沿途图鉴；本局已遇见的清单在下方，返回仍暂停。",
  "B 先打开放弃确认；已遇见的发现保留，未完成不发奖励。",
  "B 回看已保存的风景手记；返回仍暂停，不会生成新发现。",
  "B 重看本局两页玩法；返回仍暂停，等你手动继续。",
];
afterEach(cleanup);
describe("Walking pause choice consequences", () => {
  it.each(hints.map((hint, choice) => ({ hint, choice })))("explains choice $choice without changing the saved walk", ({ hint, choice }) => {
    const pet = fixture(), before = structuredClone(pet);
    const view = render(<WalkingGame pet={pet} active choice={choice} />);
    const note = view.container.querySelector(".walk-pause-hint");
    expect(note?.textContent).toBe(hint);
    expect(note?.getAttribute("aria-live")).toBe("polite");
    expect(note?.getAttribute("aria-atomic")).toBe("true");
    expect(view.container.querySelector('.walk-pause [data-selected="true"]')?.textContent).toContain(walkMenu[choice]);
    expect(view.container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(pet).toEqual(before);
  });
  it("updates only the explanation when the local selection changes", () => {
    const pet = fixture(), view = render(<WalkingGame pet={pet} active choice={1} />);
    view.rerender(<WalkingGame pet={pet} active choice={2} />);
    expect(view.container.querySelectorAll(".walk-pause-hint")).toHaveLength(1);
    expect(view.container.querySelector(".walk-pause-hint")?.textContent).toBe(hints[2]);
    expect(view.container.querySelector(".walk-find")?.textContent).toContain("已走过 1 / 3 处");
  });
  it("explains a local pause of a server-running game after refresh without rewriting it", () => {
    const pet = fixture(); pet.game!.walking!.paused = false;
    const view = render(<WalkingGame pet={pet} active={false} choice={4} />);
    expect(view.container.querySelector(".walk-pause-hint")?.textContent).toBe(hints[4]);
    expect(pet.game!.walking!.paused).toBe(false);
  });
  it.each([0, 71])("uses the next saved step at beat %s", beat => {
    const pet = fixture(); pet.game!.walking!.beat = beat;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    expect(view.container.querySelector(".walk-pause-hint")?.textContent).toContain(`从第 ${beat + 1} 步`);
  });
  it("keeps the running obstacle/timing instructions instead of pause choices", () => {
    const pet = fixture(); pet.game!.walking!.paused = false;
    const view = render(<WalkingGame pet={pet} active choice={2} />);
    expect(view.container.querySelector(".walk-pause-hint")).toBeNull();
    expect(view.container.querySelector(".walk-warning")?.textContent).toContain("前方浅石 · A 跃水 · 还有 2 步");
    expect(view.container.querySelector(".walk-warning")?.getAttribute("aria-live")).toBe("off");
    expect(view.container.querySelector(".walk-warning")?.hasAttribute("aria-atomic")).toBe(false);
  });
  it("keeps the visual countdown quiet and announces pause and finish", () => {
    const pet = fixture(); pet.game!.walking!.paused = false;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    const warning = () => view.container.querySelector(".walk-warning");
    expect(warning()?.getAttribute("aria-live")).toBe("off");
    pet.game!.walking!.beat = 30;
    view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(warning()?.getAttribute("aria-live")).toBe("off");
    expect(warning()?.hasAttribute("aria-atomic")).toBe(false);
    expect(view.container.querySelector(".walk-navigation-announcement")?.textContent).toContain("第 6 处");
    pet.game!.walking!.beat = 31;
    view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(warning()?.getAttribute("aria-live")).toBe("off");
    expect(warning()?.hasAttribute("aria-atomic")).toBe(false);
    pet.game!.walking!.beat = 72;
    view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(warning()?.getAttribute("aria-live")).toBe("polite");
    expect(warning()?.getAttribute("aria-atomic")).toBe("true");
  });
  it("keeps completed walks focused on explicit collection even when not active", () => {
    const pet = fixture(); pet.game!.walking!.beat = 72;
    const view = render(<WalkingGame pet={pet} active={false} choice={2} />);
    expect(view.container.querySelector(".walk-pause-hint")).toBeNull();
    expect(view.container.querySelector(".walk-warning")?.textContent).toContain("B / C 收好");
  });
});
