import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FishingGame } from "./FishingGame";
import { fishCatalog } from "./fishing";
import { emptyGrowth } from "./growth";
import type { Fishing, PetState } from "./types";

const now = Date.UTC(2026, 9, 20, 1);
function fixture(): PetState {
  return {
    schema: 17, revision: 1, species: 2, name: "小伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0,
    growth: emptyGrowth("baby"), logs: [],
    game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing", startedAt: now,
      round: 0, score: 0, lastBeat: -1,
      fishing: { spot: 0, casts: 1, catches: [], phase: "wait", step: 1, waitMs: 40000,
        elapsedMs: 0, candidate: "reed-minnow", lastPulseAt: now, paused: false } },
  };
}
const shadows = () => document.querySelector(".fishing-shadows");

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("quiet underwater shadows, not a fishing signal", () => {
  it.each(Array.from({ length: 10 }, (_, species) => [0, 1, 2].map(spot => [species, spot])).flat())(
    "adds the same two generic shadows for species %i at spot %i", (species, spot) => {
      const pet = fixture(); pet.species = species; pet.game!.fishing!.spot = spot;
      render(<FishingGame pet={pet} active choice={0} />);
      expect(document.querySelectorAll(".fishing-shadow")).toHaveLength(2);
      expect(shadows()?.closest("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(shadows()?.getAttribute("aria-hidden")).toBe("true");
      expect(document.querySelector(".pond-scene")?.getAttribute("data-motion")).toBe("waiting");
      expect(screen.getByText("还没咬钩；鱼影只是风景，等「咬钩啦」再按 B。")).toBeTruthy();
      expect(document.querySelector(".fishing-bite")).toBeNull();
    },
  );

  it.each(fishCatalog)("never reveals or changes shape for candidate $id", fish => {
    const pet = fixture();
    const { rerender } = render(<FishingGame pet={pet} active choice={0} />);
    const before = shadows()?.outerHTML;
    expect(before).toBeTruthy();
    Object.assign(pet.game!.fishing!, { candidate: fish.id, waitMs: 32000, elapsedMs: 31999, casts: 3 });
    rerender(<FishingGame pet={pet} active choice={0} />);
    expect(shadows()?.outerHTML).toBe(before);
    expect(screen.queryByText(new RegExp(fish.name))).toBeNull();
    expect(shadows()?.outerHTML).not.toContain(fish.id);
    expect(document.querySelector(".fishing-catch")).toBeNull();
  });

  it.each(["ready", "bite", "result", "done"] as Fishing["phase"][])("removes shadows in %s", phase => {
    const pet = fixture(); pet.game!.fishing!.phase = phase;
    const { rerender } = render(<FishingGame pet={fixture()} active choice={0} />);
    expect(shadows()).not.toBeNull();
    rerender(<FishingGame pet={pet} active choice={0} />);
    expect(shadows()).toBeNull();
    if (phase === "bite") expect(screen.getByText("咬钩啦！按 B 提竿")).toBeTruthy();
  });

  it.each([true, false])("keeps saved/local pause decorative, saved pause=%s", paused => {
    const pet = fixture(); pet.game!.fishing!.paused = paused;
    render(<FishingGame pet={pet} active={paused} choice={0} />);
    expect(document.querySelectorAll(".fishing-shadow")).toHaveLength(2);
    expect(document.querySelector(".pond-scene")?.getAttribute("data-motion")).toBe("paused");
    expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(document.querySelector(".fishing-bite,.fishing-wait-note")).toBeNull();
  });

  it("does not advance time, create timers, make requests, or alter discoveries", async () => {
    const pet = fixture(), before = structuredClone(pet);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { rerender } = render(<FishingGame pet={pet} active choice={0} />);
    const original = shadows()?.outerHTML;
    expect(original).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    rerender(<FishingGame pet={JSON.parse(JSON.stringify(pet))} active choice={0} />);
    expect(shadows()?.outerHTML).toBe(original);
    expect(pet).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
    expect(document.querySelectorAll(".fishing-game button,.fishing-game input,.fishing-game a,.fishing-game [tabindex]")).toHaveLength(0);
    expect(shadows()?.closest('[aria-live],[role="status"]')).toBeNull();
  });
});
