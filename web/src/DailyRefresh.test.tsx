import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ArcadePanel } from "./ArcadePanel";
import { ShopPanel } from "./ShopPanel";
import { DailyRefresh, dailyRefreshAt } from "./DailyRefresh";
import { emptyGrowth } from "./growth";
import type { PetState, Shop } from "./types";

const now = Date.parse("2026-10-20T23:59:59.999Z");
const rules: Shop = { catalog: [], dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000 };
function pet(): PetState {
  return { schema: 4, revision: 1, species: 2, name: "额度伙伴", createdAt: now - 3600000,
    hatchedAt: now - 3600000, lastTick: now, sleeping: false,
    needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(),
    economy: { coins: 10, gameCoins: 30, lastGameAt: now, lastDailyAt: now, owned: [], equipped: { accessory: "", room: "" } } };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const refresh = () => screen.getByLabelText("额度更新时间");

describe("local date for UTC daily refresh, without economic actions", () => {
  it.each([0, 30])("shows a concrete next refresh with %i earned coins", coins => {
    const p = pet(); p.economy!.gameCoins = coins;
    render(<ArcadePanel choice={0} economy={p.economy} shop={rules} now={now} />);
    expect(refresh().textContent).toContain("本地"); expect(refresh().textContent).toContain("UTC 0 点");
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-21T00:00:00.000Z");
    expect(p.economy!.gameCoins).toBe(coins);
    if (coins === 30) expect(screen.getByText(/今日不再得币，仍可陪它玩/)).toBeTruthy();
  });
  it.each([false, true])("shows the greeting refresh before/after claim (claimed=%s)", claimed => {
    const p = pet(); p.economy!.lastDailyAt = claimed ? now : 0;
    render(<ShopPanel pet={p} shop={rules} now={now} page={0} confirm={false} />);
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-21T00:00:00.000Z");
    expect(document.querySelector(".shop-decision")?.textContent).not.toContain("明天");
    expect(document.querySelector(".shop-decision")?.textContent).toContain(claimed ? "今日已领取" : "B 收下 10 金币");
  });
  it("changes the projected date and existing eligibility at the exact UTC boundary", () => {
    const p = pet();
    const view = render(<ShopPanel pet={p} shop={rules} now={now} page={0} confirm={false} />);
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-21T00:00:00.000Z");
    view.rerender(<ShopPanel pet={p} shop={rules} now={now + 1} page={0} confirm={false} />);
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-22T00:00:00.000Z");
    expect(document.querySelector(".shop-decision")?.textContent).toContain("B 收下 10 金币");
    expect(p.economy!.lastDailyAt).toBe(now);
  });
  it.each(["arcade", "daily"])("respects future saved claim/reward days after clock rollback (%s)", kind => {
    const p = pet(); p.economy!.lastDailyAt = p.economy!.lastGameAt = Date.parse("2026-10-23T10:00:00Z");
    render(kind === "arcade" ? <ArcadePanel choice={0} economy={p.economy} shop={rules} now={now} /> :
      <ShopPanel pet={p} shop={rules} now={now} page={0} confirm={false} />);
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-24T00:00:00.000Z");
  });
  it("does not mix the separate greeting and game timestamps", () => {
    const p = pet(); p.economy!.lastGameAt = Date.parse("2026-10-23T10:00:00Z");
    render(<ShopPanel pet={p} shop={rules} now={now} page={0} confirm={false} />);
    expect(refresh().querySelector("time")?.dateTime).toBe("2026-10-21T00:00:00.000Z");
  });
  it("keeps the refresh explanation visible while sleeping or the wallet is full", () => {
    const p = pet(); p.sleeping = true; p.economy!.coins = rules.maxCoins!;
    render(<ShopPanel pet={p} shop={rules} now={now} page={0} confirm={false} />);
    expect(refresh()).toBeTruthy(); expect(screen.getByText(/让它安心睡吧/)).toBeTruthy();
  });
  it.each(["no-rules", "no-economy", "items"])("does not imply a refresh on unrelated or unknown views (%s)", mode => {
    const p = pet(); if (mode === "no-economy") p.economy = undefined;
    render(<ShopPanel pet={p} shop={mode === "no-rules" ? null : rules} now={now} page={0}
      category={mode === "items" ? "all" : null} confirm={false} />);
    expect(screen.queryByLabelText("额度更新时间")).toBeNull();
  });
  it.each([true, false])("does not invent an arcade refresh without rules/economy (%s)", missingRules => {
    render(<ArcadePanel choice={0} economy={missingRules ? pet().economy : undefined} shop={missingRules ? null : rules} now={now} />);
    expect(screen.queryByLabelText("额度更新时间")).toBeNull();
  });
});


describe("UTC boundary calculation and actual local formatting", () => {
  it.each([
    ["2026-10-20T23:59:59.999Z", "2026-10-21T00:00:00.000Z"],
    ["2026-10-21T00:00:00.000Z", "2026-10-22T00:00:00.000Z"],
    ["2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00.000Z"],
    ["2028-02-28T12:00:00.000Z", "2028-02-29T00:00:00.000Z"],
    ["2028-02-29T12:00:00.000Z", "2028-03-01T00:00:00.000Z"],
  ])("calculates %s without relying on local midnight", (input, output) => {
    expect(new Date(dailyRefreshAt(Date.parse(input))!).toISOString()).toBe(output);
  });
  it.each([NaN, Infinity, -Infinity, -1, 8.64e15, Number.MAX_VALUE])("omits unrepresentable refresh for now=%s", invalid => {
    expect(dailyRefreshAt(invalid)).toBeNull();
    render(<DailyRefresh now={invalid} />); expect(screen.queryByLabelText("额度更新时间")).toBeNull();
  });
  it.each([NaN, Infinity, -Infinity, -1, 8.64e15])("omits unrepresentable saved timestamp %s", invalid => {
    expect(dailyRefreshAt(now, invalid)).toBeNull();
  });
  const Formatter = Intl.DateTimeFormat;
  it.each([
    ["Asia/Shanghai", "2026-10-20T23:59:59Z", "2026/10/21 08:00"],
    ["America/Los_Angeles", "2026-10-20T23:59:59Z", "2026/10/20 17:00"],
    ["Asia/Kathmandu", "2026-10-20T23:59:59Z", "2026/10/21 05:45"],
    ["Pacific/Chatham", "2026-10-20T23:59:59Z", "2026/10/21 13:45"],
    ["Australia/Adelaide", "2026-10-20T23:59:59Z", "2026/10/21 10:30"],
    ["UTC", "2026-10-20T23:59:59Z", "2026/10/21 00:00"],
    ["America/New_York", "2026-03-07T23:59:59Z", "2026/03/07 19:00"],
    ["America/New_York", "2026-03-08T23:59:59Z", "2026/03/08 20:00"],
    ["America/New_York", "2026-10-31T23:59:59Z", "2026/10/31 20:00"],
    ["America/New_York", "2026-11-01T23:59:59Z", "2026/11/01 19:00"],
  ])("formats the refresh instant in %s, including seasonal offsets (%s)", (zone, input, output) => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function(locales, options) {
      return new Formatter(locales, { ...options, timeZone: zone });
    });
    render(<DailyRefresh now={Date.parse(input)} />);
    expect(refresh().querySelector("time")?.textContent).toBe(output);
    expect(refresh().hasAttribute("aria-live")).toBe(false);
    expect(refresh().querySelectorAll("button,a,input")).toHaveLength(0);
  });
});
