import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { GameGuide } from "./ArcadePanel";
import { games, rememberGuide } from "./games";
import { emptyGrowth } from "./growth";
import { request } from "./api";
import type { Economy, PetState, Shop } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const now = Date.parse("2026-10-20T23:59:50Z");
const rules: Shop = { catalog: [], dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000 };
const economy = (overrides: Partial<Economy> = {}): Economy => ({ coins: 12, lastDailyAt: 0,
  lastGameAt: now, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" }, ...overrides });
const note = () => screen.getByLabelText("当前游戏奖励额度");
const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
beforeEach(() => { localStorage.clear(); api.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

for (const game of games) for (const mode of ["first", "quick", "paused"] as const) {
  it(`${game.id} ${mode}: separates base rules from exhausted allowance without blocking play`, () => {
    if (mode !== "first") rememberGuide(game.id);
    const e = economy({ gameCoins: 30 }), before = structuredClone(e);
    render(<GameGuide game={game} page={1} paused={mode === "paused"} economy={e} shop={rules} now={now} />);
    expect(document.querySelector(".guide-reward")?.textContent).toBe(`基础规则：${game.reward}`);
    expect(note().textContent).toBe("当前游戏额度为 0；当前不能得币，仍可陪玩。");
    expect(screen.getByText(mode === "paused" ? "A / B 翻页 · C 返回暂停" : mode === "quick"
      ? "A 重看规则 · B 开始 · C 返回选游戏" : "A 翻页 · B 跳过说明，开始 · C 返回选游戏")).toBeTruthy();
    expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
    expect(note().hasAttribute("aria-live")).toBe(false);
    expect(e).toEqual(before); expect(api).not.toHaveBeenCalled();
  });
}

const cases: { label: string; economy?: Economy; shop: Shop | null; text: string }[] = [
  { label: "normal", economy: economy(), shop: rules, text: "今日游戏额度剩 30 币（所有游戏共享）；实际奖励以结算时为准。" },
  { label: "partial daily", economy: economy({ gameCoins: 28 }), shop: rules, text: "今日游戏额度剩 2 币（所有游戏共享）；实际奖励以结算时为准。" },
  { label: "full wallet", economy: economy({ coins: rules.maxCoins! }), shop: rules, text: "钱包已满；当前不能得币，仍可陪玩。" },
  { label: "partial wallet", economy: economy({ coins: rules.maxCoins! - 1 }), shop: rules, text: "钱包还能收 1 币（所有游戏共享）；实际奖励以结算时为准。" },
  { label: "daily tighter than wallet", economy: economy({ coins: rules.maxCoins! - 2, gameCoins: 29 }), shop: rules, text: "今日游戏额度剩 1 币（所有游戏共享）；实际奖励以结算时为准。" },
  { label: "saved UTC day ahead", economy: economy({ lastGameAt: now + 86400000 }), shop: rules, text: "当前游戏额度为 0；当前不能得币，仍可陪玩。" },
  { label: "legacy wallet cap", economy: economy(), shop: { ...rules, maxCoins: undefined }, text: "今日游戏额度剩 30 币；钱包上限待同步，实际奖励以结算时为准。" },
  { label: "missing rules", economy: economy(), shop: null, text: "当前额度待同步；是否得币以结算时为准，仍可陪玩。" },
  { label: "missing economy", shop: rules, text: "当前额度待同步；是否得币以结算时为准，仍可陪玩。" },
];
it.each(cases)("explains $label without promising a minimum reward", ({ economy, shop, text }) => {
  render(<GameGuide game={games[4]} page={1} economy={economy} shop={shop} now={now} />);
  expect(note().textContent).toBe(text);
});

it("keeps the first rules page focused on controls rather than repeating the reward block", () => {
  render(<GameGuide game={games[4]} page={0} economy={economy()} shop={rules} now={now} />);
  expect(screen.queryByLabelText("当前游戏奖励额度")).toBeNull();
});
it("updates UTC allowance at the boundary without mutating the saved economy", () => {
  const e = economy({ gameCoins: 30 });
  const view = render(<GameGuide game={games[4]} page={1} economy={e} shop={rules} now={now} />);
  expect(note().textContent).toContain("当前不能得币");
  view.rerender(<GameGuide game={games[4]} page={1} economy={e} shop={rules} now={now + 10000} />);
  expect(note().textContent).toContain("今日游戏额度剩 30 币");
  expect(e.gameCoins).toBe(30); expect(api).not.toHaveBeenCalled();
});

it.each([false, true])("App passes accepted economy and refreshed rules to the guide (seen=%s)", async seen => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  if (seen) rememberGuide("stars");
  const saved: PetState = { schema: 7, revision: 1, species: 2, name: "额度伙伴", createdAt: now - 10000,
    hatchedAt: now - 9000, lastTick: now, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 },
    careCount: 0, growth: emptyGrowth("baby"), logs: [], economy: economy({ gameCoins: 30 }) };
  let shop = rules;
  api.mockImplementation(async () => ({ state: structuredClone(saved), shop, serverTime: Date.now(), message: "" }));
  await act(async () => { render(<App />); });
  for (const k of ["a", "a", "b", "b"]) await key(k);
  if (!seen) await key("a");
  expect(note().textContent).toContain("当前不能得币");
  saved.revision++; saved.economy!.gameCoins = 28;
  shop = { ...rules, gameDailyLimit: 29 };
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(note().textContent).toContain("今日游戏额度剩 1 币");
  expect(api.mock.calls.some(([path]) => ["action", "import", "reset", "recap/read"].includes(path))).toBe(false);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input,[role=button]")).toBeNull();
});
