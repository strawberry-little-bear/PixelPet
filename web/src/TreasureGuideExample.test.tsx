import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GameGuide } from "./ArcadePanel";
import { games } from "./games";
import { treasureCell, treasureClue } from "./treasure";
import type { TreasureHunt } from "./types";

afterEach(cleanup);
const game = games.find(item => item.id === "treasure")!;
const examples = [
  { label: "中央空地示例", source: 4, layout: [1, 0, 2, 0, 0, 0, 0, 0, 3], nearby: 3 },
  { label: "角落空地示例", source: 0, layout: [0, 0, 0, 0, 1, 2, 0, 0, 3], nearby: 1 },
];

it("shows all three map objects rather than an impossible two-object center clue", () => {
  const { container } = render(<GameGuide shop={null} now={0} game={game} page={0} review />);
  const diagrams = [...container.querySelectorAll(".treasure-example-grid")];
  expect(diagrams.length).toBeGreaterThan(0);
  for (const diagram of diagrams) {
    expect([...diagram.children].filter(cell => cell.textContent === "◆")).toHaveLength(3);
  }
});

it.each(examples)("teaches a legal three-object map in $label, using actual eight-neighbor rules", ({ label, source, layout, nearby }) => {
  render(<GameGuide shop={null} now={0} game={game} page={0} review />);
  const diagram = screen.getByRole("img", { name: new RegExp(label) });
  const cells = [...diagram.children];
  expect(cells).toHaveLength(9);
  const actualLayout = cells.map(cell => cell.getAttribute("data-object") === "true" ? 1 : 0);
  expect(actualLayout).toEqual(layout.map(item => item > 0 ? 1 : 0));
  expect(actualLayout.filter(Boolean)).toHaveLength(3);
  const model: TreasureHunt = { layout, opened: [source], step: 1, paused: true };
  const clue = treasureClue(model)!;
  expect(treasureCell(model, source).nearby).toBe(nearby);
  expect(cells[source].textContent).toBe(String(nearby));
  expect(cells[source].getAttribute("data-source")).toBe("true");
  expect(cells.filter(cell => cell.getAttribute("data-source") === "true")).toHaveLength(1);
  expect(cells.flatMap((cell, index) => cell.getAttribute("data-neighbor") === "true" ? [index] : [])).toEqual(clue.neighbors);
  // Every shown object either belongs to the geometric range or is explicitly outside it.
  expect(cells.filter(cell => cell.getAttribute("data-object") === "true" && cell.getAttribute("data-neighbor") === "true")).toHaveLength(nearby);
  expect(diagram.getAttribute("aria-label")).toContain(`${nearby} 件`);
  expect(within(diagram).queryByRole("button")).toBeNull();
});

it("labels the diagrams as fictional maps and explains the visible boundary markings", () => {
  render(<GameGuide shop={null} now={0} game={game} page={0} review />);
  expect(screen.getByText("示意图，不是本局地图")).toBeTruthy();
  expect(screen.getByText(/◆ 小物.*虚线框.*计数范围/)).toBeTruthy();
  expect(screen.getByText(/角落只数相邻三格.*斜角也算.*范围外两件不计入/)).toBeTruthy();
});

it("keeps examples off the reward page and keeps paused rules read-only", () => {
  const { rerender, container } = render(<GameGuide shop={null} now={0} game={game} page={1} paused />);
  expect(screen.queryByRole("img", { name: /空地示例/ })).toBeNull();
  rerender(<GameGuide shop={null} now={0} game={game} page={0} paused />);
  expect(screen.getAllByRole("img", { name: /空地示例/ })).toHaveLength(2);
  expect(screen.getByText("A / B 翻页 · C 返回暂停")).toBeTruthy();
  expect(container.querySelector("button, [role=button], input, [tabindex]")).toBeNull();
});
