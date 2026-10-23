import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameOutcome } from "./GameOutcome";
import { completedGameOutcome } from "./game-outcome";
import { games } from "./games";
import type { InterestGameReceipt, PetState, Result } from "./types";

const at = Date.parse("2026-10-23T06:00:00Z"), id = "0123456789abcdef0123456789abcdef";
const finish = { stars: "catch", tiles: "tile-pick", snake: "snake-finish", tetris: "tetris-finish", fishing: "fish-finish", walk: "walk-finish", treasure: "treasure-finish" };
function fixture(kind: InterestGameReceipt["kind"] = "stars", reason: InterestGameReceipt["reason"] = "credited") {
  const before: PetState = { schema: 16, revision: 1, species: 2, name: "共同经历", createdAt: at - 3600000, hatchedAt: at - 3600000,
    lastTick: at, sleeping: false, needs: { hunger: 70, mood: 70, clean: 70, energy: 80 }, careCount: 0, logs: [],
    game: { id, ...(kind !== "stars" && { kind }), startedAt: at - 5000, round: 4, score: 1, lastBeat: 4 } };
  const interest: InterestGameReceipt = { kind, gameId: id, before: reason === "familiar" ? 5 : reason === "cooldown" ? 1 : 0,
    after: reason === "familiar" ? 5 : 1, reason, ...(reason === "cooldown" && { retryAt: at + 600000 }) };
  const after = structuredClone(before); delete after.game; after.revision++;
  after.companion = { since: before.createdAt, interests: [{ kind, points: interest.after, lastAt: reason === "credited" ? at : at - 1200000 }], recent: { kind, id, at } };
  const result: Result = { state: after, serverTime: at, message: "本局实际结算原文", gameReceipt: { interest } };
  return { before, result, interest, capture: () => completedGameOutcome(finish[kind], before, result) };
}
afterEach(cleanup);

describe("acknowledged familiarity results", () => {
  it.each(games)("captures $id without mutating or retaining a response alias", ({ id: kind }) => {
    const f = fixture(kind), snapshot = structuredClone(f.result), outcome = f.capture();
    expect(outcome?.gameReceipt?.interest).toEqual(f.interest);
    expect(outcome?.gameReceipt?.interest).not.toBe(f.interest);
    expect(f.result).toEqual(snapshot);
  });
  it.each(["credited", "cooldown", "familiar"] as const)("explains %s separately from growth", reason => {
    const f = fixture("stars", reason);
    render(<GameOutcome outcome={f.capture()} />);
    const panel = screen.getByLabelText("本局游戏熟悉度");
    expect(panel.textContent).toContain(reason === "credited" ? "本局熟悉度 +1" : reason === "cooldown" ? "仍在 30 分钟间隔内" : "熟悉度已满");
    expect(panel.textContent).toContain("熟悉度按每款游戏分别记录");
    expect(panel.textContent).toContain("陪玩习惯与成长以本局照顾变化为准");
    if (reason === "cooldown") expect(panel.textContent).toContain("记录时约还需 10 分钟");
    expect(screen.getByLabelText("本页最近一次游戏结算").textContent).toContain("本局实际结算原文");
    expect(panel.querySelector("button,a,input,[role=button]")).toBeNull();
  });
  it("allows another game's familiarity gain while the shared play habit is cooling down", () => {
    const f = fixture("walk");
    f.result.careFeedback = { kind: "walk-finish", reason: "cooldown", habit: "play", habitGain: 0, points: 0, retryAt: at + 600000, effect: { at, before: f.before.needs, after: f.result.state.needs } };
    f.result.gameReceipt!.walk = { cleared: 8, total: 12, routeCoins: 3, performanceCoins: 2, awardedCoins: 0 };
    const outcome = f.capture();
    expect(outcome?.gameReceipt).toEqual(f.result.gameReceipt);
    render(<GameOutcome outcome={outcome} careFeedback={f.result.careFeedback} />);
    expect(screen.getByLabelText("本局游戏熟悉度").textContent).toContain("熟悉度 +1");
    expect(screen.getByLabelText("散步奖励拆解").textContent).toContain("本次实际到账：+0 金币");
    expect(screen.getByLabelText("本页最近一次游戏结算").textContent).toContain("本次成长：+0.00 点");
    expect(screen.getByLabelText("本页最近一次游戏结算").textContent).toContain("记录时约还需 10 分钟");
  });
  it.each([
    ["wrong game", { kind: "snake" }], ["wrong session", { gameId: "different" }], ["negative", { before: -1 }],
    ["fraction", { after: 1.5 }], ["overflow", { after: 6 }], ["double credit", { after: 2 }],
    ["unknown reason", { reason: "new" }], ["credited with retry", { retryAt: at + 1 }],
    ["inconsistent cooldown", { reason: "cooldown" }], ["premature familiar", { reason: "familiar" }],
  ])("ignores %s metadata and preserves the old acknowledgement", (_label, patch) => {
    const f = fixture(); Object.assign(f.interest, patch);
    const outcome = f.capture(); expect(outcome?.gameReceipt).toBeUndefined();
    render(<GameOutcome outcome={outcome} />);
    expect(screen.queryByLabelText("本局游戏熟悉度")).toBeNull();
    expect(screen.getByLabelText("本页最近一次游戏结算").textContent).toContain("不代表本次兴趣或成长增加");
  });
  it.each(["old reply", "wrong recent time", "no shared record", "wrong saved points", "wrong saved time", "missing interests"])("does not infer a gain: %s", scenario => {
    const f = fixture();
    if (scenario === "old reply") delete f.result.gameReceipt;
    if (scenario === "wrong recent time") f.result.state.companion!.recent!.at--;
    if (scenario === "no shared record") delete f.result.state.companion!.recent;
    if (scenario === "wrong saved points") f.result.state.companion!.interests[0].points = 2;
    if (scenario === "wrong saved time") f.result.state.companion!.interests[0].lastAt--;
    if (scenario === "missing interests") f.result.state.companion!.interests = undefined as never;
    expect(f.capture()?.gameReceipt).toBeUndefined();
  });
  it.each([at, at - 1, at + 600001, NaN, Infinity, 1.5])("rejects an invalid cooldown boundary %s", retryAt => {
    const f = fixture("stars", "cooldown"); f.interest.retryAt = retryAt;
    expect(f.capture()?.gameReceipt).toBeUndefined();
  });
});
