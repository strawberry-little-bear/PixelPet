import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { GrowthStage, PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const fields = [["hunger", "饱食"], ["mood", "心情"], ["clean", "清洁"], ["energy", "体力"]] as const;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function mount(stage: GrowthStage = "baby", sleeping = false) {
  saved.growth = emptyGrowth(stage); saved.sleeping = sleeping;
  await act(async () => { render(<App />); });
}
async function status() { await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b"); }
function check(selector: string) {
  const scope = within(document.querySelector(selector) as HTMLElement);
  expect(scope.getAllByRole("meter")).toHaveLength(4);
  for (const [field, label] of fields) {
    const meter = scope.getByRole("meter", { name: label });
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
    expect(Number(meter.getAttribute("aria-valuenow"))).toBe(saved.needs[field]);
    expect(meter.getAttribute("aria-valuetext")).toBe(`${Number.isInteger(saved.needs[field]) ? "" : "约 "}${Math.round(saved.needs[field])} / 100`);
    const description = document.getElementById(meter.getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain("最近读取"); expect(description?.textContent).toContain("越高越舒适");
    expect(meter.querySelector("i")?.style.width).toBe(`${saved.needs[field]}%`);
    expect(meter.hasAttribute("tabindex")).toBe(false); expect(meter.hasAttribute("aria-live")).toBe(false);
  }
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); const now = Date.now();
  saved = { schema: 12, revision: 10, species: 2, name: "需求伙伴", createdAt: now - 7200000, hatchedAt: now - 3600000, lastTick: now,
    sleeping: false, careCount: 0, logs: [], needs: { hunger: 0, mood: 100, clean: 49.6, energy: 0.4 } };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const stage of ["baby", "growing", "adult"] as const) for (const asleep of [false, true]) {
  it(`${stage}/${asleep}: named bounded read-only meters on sidebar and status`, async () => {
    await mount(stage, asleep); check(".outside-needs"); await status(); check(".screen-status"); check(".outside-needs");
    expect(screen.getAllByRole("meter")).toHaveLength(8);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd input,.lcd a,[role=slider]")).toBeNull();
    await key("a"); expect(document.querySelector(".status-guide")).not.toBeNull(); check(".outside-needs");
    await key("c"); expect(document.querySelector(".content-home")).not.toBeNull();
    expect(api.mock.calls.every(([path]) => !["action", "reset", "import", "recap/read"].includes(path))).toBe(true);
  });
}
it("accepted reads update both sets, stale reads and local time do not invent values", async () => {
  await mount(); await status(); const old = result();
  await act(async () => { vi.advanceTimersByTime(10000); }); check(".screen-status"); check(".outside-needs");
  saved.revision++; saved.needs = { hunger: 20.25, mood: 70, clean: 90, energy: 99.6 };
  await poll(); check(".screen-status"); check(".outside-needs");
  api.mockResolvedValueOnce(old); await poll(); check(".screen-status"); check(".outside-needs");
});
it("unavailable state keeps only the last accepted sidebar reading; B recovery reads without writes", async () => {
  await mount(); await status(); api.mockRejectedValueOnce(new Error("offline")); await poll();
  expect(document.querySelector(".screen-status")).toBeNull(); check(".outside-needs");
  expect(document.querySelector(".save-recovery")?.textContent).toContain("暂时未连接");
  saved.revision++; saved.needs.energy = 30.5; await key("b"); check(".outside-needs");
  expect(api.mock.calls.some(([p]) => p === "action")).toBe(false);
});
it("unhatched pets have no fabricated need meters", async () => {
  saved.hatchedAt = 0; await mount("egg"); expect(screen.queryAllByRole("meter")).toHaveLength(0);
});
it("a confirmed feeding updates values; merely opening status does not feed again", async () => {
  await mount();
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      expect(body).toMatchObject({ kind: "feed" }); saved.revision++; saved.careCount++;
      saved.needs = { ...saved.needs, hunger: 20, mood: 100, clean: 46.6 };
    }
    return result();
  });
  await key("a"); await key("b"); check(".outside-needs"); await key("c"); await status(); check(".screen-status");
  expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(1);
});
