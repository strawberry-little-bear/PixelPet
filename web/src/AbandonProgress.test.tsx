import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AbandonGame } from "./ArcadePanel";
import type { PetState } from "./types";

type Game = NonNullable<PetState["game"]>;
const common = { id: "0123456789abcdef0123456789abcdef", startedAt: 1, round: 2, score: 1, lastBeat: 4 };
const cases: { title: string; game: Game; progress: string }[] = [
  { title: "接星星", game: common, progress: "已完成 2 / 5 轮 · 接住 1 颗" },
  { title: "连连看", game: { ...common, kind: "tiles", tiles: { board: [], pick: -1, pairs: 3, shuffles: 0 } }, progress: "已配对 3 / 8 对" },
  { title: "贪吃蛇", game: { ...common, kind: "snake", snake: { body: [], food: { x: 0, y: 0 }, direction: 0, eaten: 2, step: 5, lastMoveAt: 1, paused: true } }, progress: "已吃 2 / 8 颗果子" },
  { title: "俄罗斯方块", game: { ...common, kind: "tetris", tetris: { board: [], active: { kind: 1, rotation: 0, x: 2, y: 0 }, next: 2, bag: [], lines: 3, pieces: 7, step: 4, lastFallAt: 1, paused: true } }, progress: "已消除 3 / 8 行 · 放下 7 块" },
  { title: "池塘钓鱼", game: { ...common, kind: "fishing", fishing: { spot: 0, casts: 2, catches: ["reed-minnow"], phase: "ready", step: 5, waitMs: 30000, elapsedMs: 0, candidate: "secret-fish", lastPulseAt: 1, paused: true } }, progress: "已使用 2 / 3 竿 · 钓到 1 条鱼" },
  { title: "公园散步", game: { ...common, kind: "walk", walking: { route: Array(12).fill("rock"), souvenirs: ["leaf", "shell", "flower"], beat: 28, step: 30, cleared: 3, pose: "", poseUntil: 0, lastPulseAt: 1, lastInputAt: 0, paused: true } }, progress: "已走 28 / 72 步 · 已遇见 1 / 3 次发现" },
  { title: "森林寻宝", game: { ...common, kind: "treasure", treasure: { layout: [1, 0, 0, 2, 3, 0, 0, 0, 0], opened: [0, 1], step: 4, paused: true } }, progress: "已探索 2 / 6 格 · 实际找到 1 / 3 件" },
];
afterEach(cleanup);
describe("abandon confirmation shows only the current saved game progress", () => {
  it.each(cases)("identifies $title and its acknowledged progress without changing it", ({ title, game, progress }) => {
    const before = structuredClone(game), view = render(<AbandonGame game={game} />);
    const note = view.getByLabelText("本局已保存进度");
    expect(note.textContent).toContain(title);
    expect(note.textContent).toContain(progress);
    expect(view.getByText(/A \/ C 留在本局 · B 确认放弃/)).toBeTruthy();
    expect(view.container.textContent).toContain("不发金币、不计陪伴奖励");
    expect(view.container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(game).toEqual(before);
  });
  it("updates to a newly acknowledged snapshot instead of holding the opening progress", () => {
    const view = render(<AbandonGame game={common} />);
    view.rerender(<AbandonGame game={{ ...common, round: 3, score: 2 }} />);
    expect(view.getByLabelText("本局已保存进度").textContent).toContain("已完成 3 / 5 轮 · 接住 2 颗");
  });
  it("does not reveal future fish, route souvenirs or unopened treasure", () => {
    for (const index of [4, 5, 6]) {
      const a = structuredClone(cases[index].game), b = structuredClone(a);
      if (b.fishing) { b.fishing.candidate = "another-secret"; b.fishing.waitMs++; }
      if (b.walking) b.walking.souvenirs = ["pebble", "feather", "pinecone"];
      if (b.treasure) b.treasure.layout = [1, 0, 0, 0, 0, 2, 3, 0, 0];
      const view = render(<AbandonGame game={a} />), first = view.getByLabelText("本局已保存进度").textContent;
      view.rerender(<AbandonGame game={b} />);
      expect(view.getByLabelText("本局已保存进度").textContent).toBe(first);
      view.unmount();
    }
  });
  it.each(["fishing", "walk"] as const)("retains the %s permanent-discovery explanation", kind => {
    const view = render(<AbandonGame game={cases.find(c => c.game.kind === kind)!.game} />);
    expect(view.container.textContent).toContain(kind === "walk" ? "实际遇见的发现仍会保留" : "实际钓到的鱼仍保留在图鉴");
  });
  it("keeps the star clock explanation separate from progress", () => {
    const view = render(<AbandonGame game={common} />);
    expect(view.container.textContent).toContain("光点仍随时间移动，但不会自动接取");
  });
  it("does not invent progress without a game", () => {
    const view = render(<AbandonGame game={undefined} />);
    expect(view.queryByLabelText("本局已保存进度")).toBeNull();
  });
  it("treats old absent fish catches as no catches, not a predicted catch", () => {
    const game = structuredClone(cases[4].game); game.fishing!.catches = null;
    const view = render(<AbandonGame game={game} />);
    expect(view.getByLabelText("本局已保存进度").textContent).toContain("钓到 0 条鱼");
  });
  it("does not invent a zero count when the matching saved board is absent", () => {
    const view = render(<AbandonGame game={{ ...common, kind: "snake" }} />);
    expect(view.queryByLabelText("本局已保存进度")).toBeNull();
  });

});
