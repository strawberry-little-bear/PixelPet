import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TileGame } from "./TileGame";
import type { PetState } from "./types";
import type { TileHint } from "./TileGame";
const pet: PetState = {
  schema: 5, revision: 1, species: 2, name: "伙伴", createdAt: 1, hatchedAt: 1, lastTick: 1,
  sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
  game: { id: "one", kind: "tiles", startedAt: 1, round: 0, score: 0, lastBeat: -1,
    tiles: { board: [0,0,2,2,3,3,4,4,5,5,6,6,7,7,8,8], pick: 14, pairs: 1, shuffles: 0 } },
};
function view(state = pet, cursor = 3, hint: TileHint | null = null) { return <TileGame pet={state} cursor={cursor} message="" link={null} hint={hint} now={1}/>; }
afterEach(cleanup);
it("describes all sixteen visible cells, including empty positions, without revealing a solution", () => {
  const { container } = render(view());
  const board = screen.getByRole("img", { name: /四行四列图案棋盘/ });
  const desc = container.querySelector(".tile-board desc")!;
  expect(board.getAttribute("aria-describedby")).toBe(desc.id);
  expect(desc.textContent?.match(/第 \d+ 格/g)).toHaveLength(16);
  expect(desc.textContent).toContain("第 1 格（1 行 1 列）：空格");
  expect(desc.textContent).toContain("第 16 格（4 行 4 列）：脚印");
  expect(desc.textContent).not.toMatch(/可配对|下一步|答案/);
});
it("keeps current and selected pattern names and coordinates readable together", () => {
  render(view());
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.getAttribute("aria-atomic")).toBe("true");
  expect(status.textContent).toContain("第 4 格（1 行 4 列）· 嫩叶");
  expect(screen.getByRole("status").textContent).toContain("已选第 15 格（4 行 3 列）· 脚印");
});
it("an unpicked board explains B rather than retaining an old selection", () => {
  const { rerender } = render(view());
  const state = structuredClone(pet); state.game!.tiles!.pick = -1;
  rerender(view(state));
  expect(screen.getByRole("status").textContent).toContain("B 选中");
  expect(screen.getByRole("status").textContent).not.toContain("已选");
});
it("updates the description from accepted board values after clearing or reshuffling", () => {
  const { container, rerender } = render(view());
  const state = structuredClone(pet); state.game!.tiles!.board[15] = 0;
  rerender(view(state));
  expect(container.querySelector(".tile-board desc")?.textContent).toContain("第 16 格（4 行 4 列）：空格");
});
it("uses unique description IDs and never adds clickable board cells", () => {
  const { container } = render(<>{view()}{view()}</>);
  const boards = container.querySelectorAll(".tile-board");
  expect(boards[0].getAttribute("aria-describedby")).not.toBe(boards[1].getAttribute("aria-describedby"));
  expect(container.querySelectorAll("button,input,a,[role=button],[tabindex]")).toHaveLength(0);
});

it("shows a server-provided legal route as a temporary example", () => {
  const { container } = render(view(pet, 3, { id: 7, path: [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 4, y: 3 }] }));
  expect(container.querySelector(".tile-hint")?.getAttribute("points")).toBe("20,20 20,60 80,60");
  expect(screen.getByRole("note").textContent).toContain("示例路径");
  expect(container.querySelectorAll("button,input,a,[role=button],[tabindex]")).toHaveLength(0);
});
