import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FishingGame } from "./FishingGame";
import type { PetState } from "./types";

const now = Date.parse("2026-10-25T01:00:00Z");
function fixture(): PetState {
  return { schema: 22, revision: 1, species: 2, name: "一起听水声", createdAt: now - 3600000,
    hatchedAt: now - 3500000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
    game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing", startedAt: now,
      round: 0, score: 0, lastBeat: -1, fishing: { spot: 0, casts: 0, catches: [],
        phase: "ready", step: 0, waitMs: 32000, elapsedMs: 0,
        candidate: "reed-minnow", lastPulseAt: now, paused: false } } };
}
afterEach(cleanup);

describe("discrete fishing bite announcement", () => {
  it("establishes an empty status region before the first cast, then updates that same node on bite", () => {
    const pet = fixture(), before = structuredClone(pet), n = pet.game!.fishing!;
    const view = render(<FishingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".fishing-bite-announcement")!;
    expect(announcement).not.toBeNull();
    expect(announcement.getAttribute("role")).toBe("status");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.getAttribute("aria-atomic")).toBe("true");
    expect(announcement.textContent).toBe("");
    expect(pet).toEqual(before);
    Object.assign(n, { phase: "wait", casts: 1, elapsedMs: 32000 });
    view.rerender(<FishingGame pet={pet} active choice={0} />);
    expect(announcement.textContent).toBe("");
    n.phase = "bite"; n.elapsedMs = 0;
    view.rerender(<FishingGame pet={pet} active choice={0} />);
    expect(view.container.querySelector(".fishing-bite-announcement")).toBe(announcement);
    expect(announcement.textContent).toBe("咬钩啦！按 B 提竿");
    expect(view.container.querySelector(".fishing-bite")?.hasAttribute("role")).toBe(false);
  });

  it("keeps the announcement unchanged while seconds and ordinary synchronization change", () => {
    const pet = fixture(), n = pet.game!.fishing!; n.phase = "wait";
    const view = render(<FishingGame pet={pet} active choice={0} />);
    n.phase = "bite"; n.elapsedMs = 0;
    view.rerender(<FishingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".fishing-bite-announcement")!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(announcement, { subtree: true, childList: true, characterData: true, attributes: true });
    try {
      for (const elapsedMs of [1000, 2500, 8900, 9999]) {
        n.elapsedMs = elapsedMs; pet.revision++; n.step++;
        view.rerender(<FishingGame pet={structuredClone(pet)} active choice={0} />);
        expect(announcement.textContent).toBe("咬钩啦！按 B 提竿");
        expect(view.container.querySelector(".fishing-status")?.textContent).toContain(`还剩 ${Math.max(1, Math.ceil((10000 - elapsedMs) / 1000))} 秒`);
        expect(view.container.querySelector(".fishing-status")?.getAttribute("aria-live")).toBe("off");
        expect([...mutations, ...observer.takeRecords()]).toHaveLength(0);
      }
    } finally { observer.disconnect(); }
  });

  it.each(["local", "server"] as const)("clears the prompt during %s pause and restores it only on explicit resume", kind => {
    const pet = fixture(), n = pet.game!.fishing!; n.phase = "bite";
    const view = render(<FishingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".fishing-bite-announcement")!;
    if (kind === "server") n.paused = true;
    view.rerender(<FishingGame pet={pet} active={kind === "server"} choice={0} />);
    expect(announcement.textContent).toBe("");
    n.elapsedMs = 2500;
    view.rerender(<FishingGame pet={pet} active={kind === "server"} choice={1} />);
    expect(announcement.textContent).toBe("");
    expect(view.container.querySelector(".fishing-pause-hint")?.textContent).toContain("C 返回暂停");
    n.paused = false;
    view.rerender(<FishingGame pet={pet} active choice={0} />);
    expect(announcement.textContent).toBe("咬钩啦！按 B 提竿");
  });

  it.each(["ready", "wait", "result", "done"] as const)("never creates a bite announcement from %s, candidate or saved catches", phase => {
    const pet = fixture(), n = pet.game!.fishing!;
    Object.assign(n, { phase, casts: phase === "done" ? 3 : 1, catches: ["reed-minnow"], lastFish: "reed-minnow", outcome: "caught" });
    const view = render(<FishingGame pet={pet} active choice={0} />);
    expect(view.container.querySelector(".fishing-bite-announcement")?.textContent).toBe("");
    expect(view.container.querySelectorAll("button, a, input, [role=button]")).toHaveLength(0);
  });

  it("clears at the result and rearms for the next actual bite without announcing the wait", () => {
    const pet = fixture(), n = pet.game!.fishing!;
    const view = render(<FishingGame pet={pet} active choice={0} />);
    const announcement = view.container.querySelector(".fishing-bite-announcement")!;
    for (const phase of ["wait", "bite", "result", "wait", "bite", "done"] as const) {
      n.phase = phase;
      view.rerender(<FishingGame pet={pet} active choice={0} />);
      expect(view.container.querySelector(".fishing-bite-announcement")).toBe(announcement);
      expect(announcement.textContent).toBe(phase === "bite" ? "咬钩啦！按 B 提竿" : "");
    }
  });
});
