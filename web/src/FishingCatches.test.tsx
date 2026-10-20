import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FishingCatches, FishingGame } from "./FishingGame";
import { fishCatalog } from "./fishing";
import type { Fishing, PetState } from "./types";

const session = (catches?: string[] | null): Fishing => ({
  spot: 0, casts: 3, phase: "done", catches, step: 3, waitMs: 32000,
  elapsedMs: 0, candidate: "moon-perch", lastFish: "sun-carp", outcome: "missed",
  lastPulseAt: 1, paused: true,
});
const pet = (fishing: Fishing): PetState => ({
  schema: 17, revision: 1, species: 2, name: "钓鱼伙伴", createdAt: 1, hatchedAt: 1,
  lastTick: 1, sleeping: false, needs: { hunger: 70, mood: 70, energy: 70, clean: 70 },
  careCount: 0, logs: [], pond: { since: 1, fish: [{ id: "sun-carp", count: 4, firstAt: 1, lastAt: 1 }] },
  game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing", startedAt: 1,
    round: 0, score: 0, lastBeat: -1, fishing },
});
afterEach(cleanup);
describe("this fishing session's saved catches", () => {
  it.each([null, undefined, []])("treats %j as empty without borrowing the candidate, last fish or album", catches => {
    const saved = pet(session(catches)), before = structuredClone(saved);
    render(<FishingGame pet={saved} active={false} choice={0} />);
    const region = screen.getByRole("region", { name: "本次钓到的小鱼" });
    expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
    expect(region.textContent).toContain("还没有钓到小鱼");
    expect(region.textContent).not.toMatch(/暖阳小鲤|月纹小鲈|首次|新物种/);
    expect(saved).toEqual(before);
  });
  it("keeps repeated catches in acknowledged order, even after the last cast missed", () => {
    const n = session(["reed-minnow", "reed-minnow"]), before = structuredClone(n);
    render(<FishingCatches fishing={n} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map(el => el.querySelector("strong")?.textContent)).toEqual(["青苇小鲦", "青苇小鲦"]);
    expect(rows.map(el => el.querySelector("span")?.textContent)).toEqual(["第 1 条", "第 2 条"]);
    expect(screen.getByText(/不是竿次/)).toBeTruthy();
    expect(screen.getByText(/放弃也保留/)).toBeTruthy();
    expect(screen.getByText(/完成三竿并收好/)).toBeTruthy();
    expect(n).toEqual(before);
  });
  it.each(fishCatalog)("shows the real $id description and art, without claiming a first discovery", fish => {
    render(<FishingCatches fishing={session([fish.id])} />);
    expect(screen.getByText(fish.name)).toBeTruthy();
    expect(screen.getByText(fish.story)).toBeTruthy();
    expect(document.querySelector(`.fishing-catches .fish-${fish.shape}`)).toBeTruthy();
    expect(document.querySelector(".fishing-catches")?.textContent).not.toMatch(/首次|新物种|金币 \+/);
  });
  it("does not draw a fallback species for unknown details", () => {
    render(<FishingCatches fishing={session(["old-unknown"])} />);
    expect(screen.getByText("小鱼详情尚未读到")).toBeTruthy();
    expect(document.querySelector(".fish-art")).toBeNull();
  });
  it("is a read-only native stop without an extra control", () => {
    render(<FishingCatches fishing={session(["rain-koi"])} />);
    const region = screen.getByRole("region", { name: "本次钓到的小鱼" });
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute("aria-describedby")).toBeTruthy();
    expect(region.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(screen.getByText(/本局结束后不保留这份清单/)).toBeTruthy();
  });
  it.each(["ready", "wait", "bite", "result", "done"] as const)("keeps %s's active screen quiet; shows history only when paused or complete", phase => {
    const n = session(["reed-minnow"]); n.phase = phase; n.paused = false;
    const saved = pet(n);
    const { rerender } = render(<FishingGame pet={saved} active={true} choice={0} />);
    expect(screen.queryByRole("region", { name: "本次钓到的小鱼" }) !== null).toBe(phase === "done");
    n.paused = true;
    rerender(<FishingGame pet={saved} active={false} choice={0} />);
    expect(screen.getByRole("region", { name: "本次钓到的小鱼" })).toBeTruthy();
    n.catches = [];
    rerender(<FishingGame pet={saved} active={false} choice={0} />);
    expect(document.querySelectorAll(".fishing-catches li")).toHaveLength(0);
  });
});
