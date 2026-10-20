import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FishingGame } from "./FishingGame";
import type { Fishing, PetState } from "./types";

const now = Date.now();
const representations: [string, unknown][] = [["nil", null], ["omitted", undefined], ["array", []]];
function pet(phase: Fishing["phase"], catches: unknown): PetState {
  const n = { spot: 0, casts: phase === "ready" ? 0 : phase === "done" ? 3 : 1,
    ...(catches === undefined ? {} : { catches }), phase, step: 0, waitMs: phase === "ready" ? 0 : 32000, elapsedMs: 0,
    candidate: phase === "ready" ? "" : "reed-minnow", lastPulseAt: now, paused: true,
    ...(["result", "done"].includes(phase) ? { outcome: "early" } : {}) };
  return { schema: 17, revision: 1, species: 2, name: "池塘伙伴", createdAt: now,
    hatchedAt: now, lastTick: now, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 },
    careCount: 0, logs: [], game: { id: "0123456789abcdef0123456789abcdef", kind: "fishing",
      startedAt: now, round: 0, score: 0, lastBeat: -1, fishing: n as Fishing } };
}
afterEach(cleanup);
for (const phase of ["ready", "wait", "bite", "result", "done"] as const) {
  it.each(representations)(`renders ${phase} with %s empty catches without changing the save`, (_, catches) => {
    const saved = pet(phase, catches), before = structuredClone(saved);
    render(<FishingGame pet={saved} active={false} choice={0} />);
    expect(document.querySelector(".fishing-game header")?.textContent).toContain("0 鱼");
    if (phase === "done") {
      expect(screen.getByText(/三竿完成 · 发现 0 条鱼/)).toBeTruthy();
      expect(screen.getByText("至少钓到一条并完成三竿才计陪伴 / 金币")).toBeTruthy();
    } else expect(screen.getByText("池塘已暂停")).toBeTruthy();
    expect(document.querySelectorAll("button,a,input")).toHaveLength(0);
    expect(saved).toEqual(before);
  });
}
it("keeps real catches and the existing settlement explanation", () => {
  const saved = pet("done", ["reed-minnow", "rain-koi"]), n = saved.game!.fishing!;
  Object.assign(n, { outcome: "caught", lastFish: "rain-koi", candidate: "rain-koi" });
  render(<FishingGame pet={saved} active={false} choice={0} />);
  expect(document.querySelector("header")?.textContent).toContain("2 鱼");
  expect(screen.getByText(/三竿完成 · 发现 2 条鱼/)).toBeTruthy();
  expect(screen.getByText("完成可计陪伴 · 3–6 币（共用今日额度）")).toBeTruthy();
});
