import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { request } from "./api";
import { games } from "./games";
import { emptyGrowth } from "./growth";
import type { PetState } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  const now = Date.now();
  const pet: PetState = {
    schema: 2, revision: 1, species: 2, name: "草莓兔",
    createdAt: now - 10000, hatchedAt: now - 9000, lastTick: now,
    sleeping: false, needs: { hunger: 60, mood: 70, clean: 60, energy: 80 },
    careCount: 0, growth: { ...emptyGrowth("baby"), care: { ...emptyGrowth("baby").care, lastPlay: now - 10 * 60 * 1000 } }, logs: [],
  };
  api.mockReset();
  api.mockResolvedValue({ state: pet, serverTime: now, message: "" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function open() {
  await act(async () => { render(<App />); });
  await key("a"); // Home → care menu, initially feed.
  await key("a"); // Select play without opening or starting a game.
}

it("announces the actual game count at the care-menu entrance, without a stale partial list", async () => {
  await open();
  const note = screen.getByRole("note", { name: "所选菜单说明" });
  expect(note.textContent).toContain(`${games.length} 款小游戏`);
  expect(note.textContent).toContain("按喜好选，不必都玩");
  expect(note.textContent).not.toContain("星星、配对、果园、积木、池塘与公园");
  expect(api.mock.calls.some(([path]) => path === "action")).toBe(false);
});

it("lets A/B/C discover every listed game, read both rule pages and return without writes", async () => {
  await open();
  await key("b");
  expect(document.querySelectorAll(".arcade-card")).toHaveLength(games.length);
  for (const [index, game] of games.entries()) {
    const selected = document.querySelector(".arcade-card.selected");
    expect(selected?.getAttribute("data-game")).toBe(game.id);
    expect(selected?.textContent).toContain(game.title);
    expect(document.querySelector(".arcade-panel header")?.textContent).toContain(`${index + 1} / ${games.length}`);
    await key("b");
    const guide = screen.getByRole("region", { name: `${game.title}玩法说明` });
    expect(guide.textContent).toContain("1 / 2");
    expect(guide.textContent).toContain(game.controls);
    expect(screen.getByLabelText("当前陪玩习惯").textContent).toContain("约还需 20 分钟");
    expect(screen.getByLabelText("当前陪玩习惯").textContent).toContain("仍可陪玩");
    await key("a");
    expect(guide.textContent).toContain("2 / 2");
    expect(guide.textContent).toContain(game.reward);
    await key("c");
    expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe(game.id);
    await key("a");
  }
  expect(document.querySelector(".arcade-card.selected")?.getAttribute("data-game")).toBe(games[0].id);
  await key("c");
  expect(document.querySelector(".arcade-panel")).toBeNull();
  expect(document.querySelector(".pet-scene")).not.toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelectorAll(".lcd button,.lcd input,.lcd a,.lcd [role=button]")).toHaveLength(0);
  expect(api.mock.calls.some(([path]) => path === "action")).toBe(false);
  for (const game of games) expect(localStorage.getItem(`pixelpet-guide-v1-${game.id}`)).toBeNull();
});
