import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { CareFeedback, GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, kind: "feed" | "clean", receipt: CareFeedback, retryAt: number;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const writes = () => api.mock.calls.filter(([p]) => ["action", "reset", "import", "recap/read"].includes(p));
const toast = () => document.querySelector('.growth-feedback[data-feedback="cooldown"]')?.textContent!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function sync() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
async function mount(stage: GrowthStage) { saved.growth = { ...emptyGrowth(stage), ...(stage === "adult" ? { points: 72, form: "gentle" as const } : {}), care: { ...emptyGrowth().care, lastFeed: Date.now() - 29 * 60000, lastClean: Date.now() - 29 * 60000 } }; await act(async () => { render(<App />); }); }
async function care() { await key("a"); if (kind === "clean") { await key("a"); await key("a"); } await key("b"); await key("c"); }
async function cover(name: string, open: boolean) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: !open && name !== "tools" ? /^关闭$/ : name === "help" ? "玩法说明" : /存档盒/ })); });
  if (name === "reset" && open) await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^重新开始$/ })); });
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); kind = "feed"; const now = Date.now(); retryAt = now + 60000;
  saved = { schema: 12, revision: 10, species: 2, name: "照顾回执", createdAt: now - 7200000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, careCount: 1, logs: [], needs: { hunger: 60, mood: 70, clean: 60, energy: 80 } };
  api.mockImplementation(async path => {
    if (path !== "action") return result();
    const before = structuredClone(saved.needs); saved.revision++; saved.careCount++;
    saved.needs[kind === "feed" ? "hunger" : "clean"] += kind === "feed" ? 28 : 34;
    receipt = { kind, reason: "cooldown", habit: kind === "feed" ? "nutrition" : "clean", habitGain: 0, points: 0, retryAt,
      effect: { at: Date.now(), before, after: structuredClone(saved.needs) } };
    return { ...result(), careFeedback: structuredClone(receipt) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
for (const stage of ["baby", "growing", "adult"] as const) for (const action of ["feed", "clean"] as const) {
  it.each(["help", "tools", "reset", "hidden"])(`${stage}/${action}: retains the historical reason after %s outlasts the reward interval`, async name => {
    kind = action; await mount(stage); const growth = structuredClone(saved.growth); await care();
    const text = toast(); expect(text).toContain("记录时同类习惯仍在间隔内"); expect(text).toContain("记录时约还需 1 分钟"); expect(text).toContain("以之后实际结果为准");
    if (name === "hidden") {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true); await sync(); await tick(65000); hidden.mockReturnValue(false); await sync();
    } else { await cover(name, true); await tick(65000); await cover(name, false); }
    expect(toast()).toBe(text); expect(toast()).not.toMatch(/已结束|成长 \+/);
    expect(document.querySelector(".care-learning")?.textContent).toContain("记录时同类习惯仍在间隔内");
    expect(saved.growth).toEqual(growth); expect(receipt.habitGain).toBe(0); expect(writes()).toHaveLength(1);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3); expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    await tick(7999); expect(toast()).toBe(text); await tick(1); expect(toast()).toBeUndefined();
  });
}
it("an old/late acknowledgement is not proof that the current interval has ended", async () => {
  retryAt = Date.now() - 60000; await mount("baby"); await care(); expect(toast()).toContain("记录时同类习惯仍在间隔内"); expect(toast()).not.toContain("已结束"); expect(writes()).toHaveLength(1);
});
it("new authoritative eligibility updates the menu, not the historical result", async () => {
  await mount("baby"); await care(); const old = toast();
  await cover("help", true); await tick(65000); saved.lastTick = Date.now(); saved.revision++; await sync(); await cover("help", false);
  expect(toast()).toBe(old); saved.needs.hunger = 60; saved.revision++; await sync(); await key("a");
  expect(screen.getByLabelText("所选菜单说明").textContent).toContain("符合记录习惯的条件"); expect(writes()).toHaveLength(1);
});
it("a failed read clears the old feedback; B only reconciles and never repeats care", async () => {
  await mount("baby"); await care(); api.mockRejectedValueOnce(new RequestFailure("离线", "unavailable")); await sync();
  expect(document.querySelector(".save-recovery")).toBeTruthy(); expect(toast()).toBeUndefined();
  await key("b"); expect(document.querySelector(".save-recovery")).toBeNull(); expect(toast()).toBeUndefined(); expect(writes()).toHaveLength(1);
});

it.each(["feed", "clean"] as const)("%s menu estimate changes only with accepted snapshots, without writing care", async action => {
  kind = action; await mount("baby");
  await key("a"); if (kind === "clean") { await key("a"); await key("a"); }
  const preview = () => screen.getByLabelText("所选菜单说明").textContent;
  expect(preview()).toContain("最近读取时约还需 1 分钟");
  const original = result();
  await tick(65000);
  expect(preview()).toContain("最近读取时约还需 1 分钟");
  expect(preview()).not.toContain("符合记录");
  saved.lastTick = Date.now(); saved.revision++;
  await sync(); expect(preview()).toContain("符合记录");
  api.mockResolvedValueOnce(original); await sync();
  expect(preview()).toContain("符合记录");
  expect(preview()).not.toContain("还需");
  expect(writes()).toHaveLength(0);
});
