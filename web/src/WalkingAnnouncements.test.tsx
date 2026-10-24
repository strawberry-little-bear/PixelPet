import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalkingGame } from "./WalkingGame";
import type { PetState } from "./types";

const now = Date.parse("2026-10-24T01:00:00Z");
function fixture(species = 2): PetState {
  return { schema: 19, revision: 1, species, name: "一起慢慢走", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "walk", startedAt: now,
      round: 0, score: 0, lastBeat: -1, walking: { route: Array(12).fill("rock"),
        souvenirs: ["leaf", "shell", "flower"], beat: 0, step: 0, cleared: 0,
        pose: "", poseUntil: 0, lastPulseAt: now, lastInputAt: 0, paused: true } } };
}
afterEach(cleanup);

describe("discrete walking obstacle and timing announcements", () => {
  it("announces the first visible obstacle when explicitly resuming from pause", () => {
    const pet = fixture(), before = structuredClone(pet);
    const view = render(<WalkingGame pet={pet} active={false} choice={0} />);
    const announcement = view.container.querySelector(".walk-navigation-announcement")!;
    expect(announcement).not.toBeNull();
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.getAttribute("aria-atomic")).toBe("true");
    expect(announcement.textContent).toBe("");
    expect(pet).toEqual(before);
    const running = structuredClone(pet); running.game!.walking!.paused = false;
    view.rerender(<WalkingGame pet={running} active choice={0} />);
    expect(announcement.textContent).toBe("第 1 处 · 前方石头 · A 跳跃。近 3 步再按 A 跳跃 · 动作保持 3 步。");
  });

  it.each([
    [2, "rock", "前方石头 · A 跳跃"], [2, "branch", "前方树枝 · B 蹲下"],
    [3, "rock", "前方浅石 · A 跃水"], [3, "branch", "前方低枝 · B 下潜"],
  ] as const)("uses the current visible obstacle for species %i and %s", (species, obstacle, instruction) => {
    const pet = fixture(species); pet.game!.walking!.paused = false;
    pet.game!.walking!.route[0] = obstacle;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    expect(view.container.querySelector(".walk-navigation-announcement")?.textContent).toContain(instruction);
  });

  it("keeps early and ready instructions stable while the visual countdown changes", () => {
    const pet = fixture(), walk = pet.game!.walking!; walk.paused = false;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".walk-navigation-announcement")!;
    const early = announcement.textContent;
    for (const beat of [1, 2]) {
      walk.beat = beat; view.rerender(<WalkingGame pet={pet} active choice={0} />);
      expect(announcement.textContent).toBe(early);
      expect(view.container.querySelector(".walk-warning")?.textContent).toContain(`还有 ${6 - beat} 步`);
    }
    walk.beat = 3; view.rerender(<WalkingGame pet={pet} active choice={0} />);
    const ready = announcement.textContent;
    expect(ready).toContain("现在按 A 跳跃");
    for (const beat of [4, 5]) {
      walk.beat = beat; view.rerender(<WalkingGame pet={pet} active choice={0} />);
      expect(announcement.textContent).toBe(ready);
    }
    expect(view.container.querySelector(".walk-warning")?.getAttribute("aria-live")).toBe("off");
  });

  it("reports saved action coverage instead of continuing to request the same input", () => {
    const pet = fixture(), walk = pet.game!.walking!; walk.paused = false; walk.beat = 3;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".walk-navigation-announcement")!;
    walk.pose = "jump"; walk.poseUntil = 6;
    view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(announcement.textContent).toContain("跳跃可覆盖本处 · 不必连按");
    const covered = announcement.textContent;
    walk.beat = 5; view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(announcement.textContent).toBe(covered);
  });

  it("distinguishes successive identical obstacles without revealing later route or finds", () => {
    const pet = fixture(), walk = pet.game!.walking!; walk.paused = false; walk.route[2] = "branch";
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    walk.beat = 6; view.rerender(<WalkingGame pet={pet} active choice={0} />);
    const text = view.container.querySelector(".walk-navigation-announcement")?.textContent;
    expect(text).toBe("第 2 处 · 前方石头 · A 跳跃。近 3 步再按 A 跳跃 · 动作保持 3 步。");
    expect(text).not.toContain("树枝"); expect(text).not.toContain("银杏叶");
    expect(view.container.querySelector(".walk-warning")?.getAttribute("aria-live")).toBe("off");
  });

  it.each(["local", "server"] as const)("clears running advice during %s pause and ignores late saved steps until resume", kind => {
    const pet = fixture(), walk = pet.game!.walking!; walk.paused = false; walk.beat = 3;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".walk-navigation-announcement")!;
    if (kind === "server") walk.paused = true;
    view.rerender(<WalkingGame pet={pet} active={kind === "server"} choice={0} />);
    expect(announcement.textContent).toBe("");
    walk.beat = 4; view.rerender(<WalkingGame pet={pet} active={kind === "server"} choice={0} />);
    expect(announcement.textContent).toBe("");
    expect(view.container.querySelector(".walk-pause-hint")?.textContent).toContain("第 5 步");
    walk.paused = false; view.rerender(<WalkingGame pet={pet} active choice={0} />);
    expect(announcement.textContent).toContain("现在按 A 跳跃");
  });

  it("clears obstacle instructions at the finish and leaves explicit collection available", () => {
    const pet = fixture(), walk = pet.game!.walking!; walk.paused = false; walk.beat = 71;
    const view = render(<WalkingGame pet={pet} active choice={0} />);
    walk.beat = 72; view.rerender(<WalkingGame pet={pet} active={false} choice={0} />);
    expect(view.container.querySelector(".walk-navigation-announcement")?.textContent).toBe("");
    expect(view.container.querySelector(".walk-warning")?.textContent).toContain("B / C 收好本局发现");
    expect(view.container.querySelector(".walk-warning")?.getAttribute("aria-live")).toBe("polite");
    expect(view.container.querySelectorAll("button, [role=button]")).toHaveLength(0);
  });
});
