import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { RequestFailure } from "./requestFailure";
import type { CareFeedback, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), message: "", serverTime: Date.now() });
const advice = () => screen.queryByRole("region", { name: "小窝中的照顾建议" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function tick(ms = 15000) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function care(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
const outcome = () => screen.queryByRole("region", { name: "上次操作的即时变化" });
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = Date.now();
  saved = { schema: 17, revision: 1, species: 2, name: "慢慢照顾", createdAt: at - 3600000, hatchedAt: at - 3600000,
    lastTick: at, sleeping: false, careCount: 0, logs: [], growth: emptyGrowth(),
    needs: { hunger: 80, clean: 80, energy: 80, mood: 80 } };
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([
  { stage: "baby", needs: { hunger: 12, clean: 18, energy: 20 }, kind: "hungry", label: "吃点东西" },
  { stage: "growing", needs: { hunger: 32, clean: 15, energy: 20 }, kind: "dirty", label: "洗个澡澡" },
  { stage: "adult", needs: { hunger: 32, clean: 50, energy: 20 }, kind: "tired", label: "睡个好觉" },
] as const)("$stage/$kind names the same next care as the gesture and menu without choosing it", async profile => {
  saved.growth = emptyGrowth(profile.stage);
  saved.growth.points = profile.stage === "adult" ? 72 : profile.stage === "growing" ? 30 : 1;
  if (profile.stage === "adult") saved.growth.form = "gentle";
  Object.assign(saved.needs, profile.needs);
  const before = structuredClone(saved);
  await mount();
  expect(advice()?.textContent).toContain("现在怎么照顾 · 最近读取");
  expect(advice()?.textContent).toContain(`从菜单选「${profile.label}」`);
  expect(document.querySelector(".pet-scene")?.getAttribute("data-need")).toBe(profile.kind);
  expect(advice()?.querySelector("button,input,a,[tabindex],[role=button],[aria-live]")).toBeNull();
  await act(async () => { fireEvent.click(advice()!); });
  expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
  await key("b");
  expect(advice()).toBeNull();
  expect(document.querySelector(".care-menu-advice")?.textContent).toContain(`从菜单选「${profile.label}」`);
  expect(document.querySelector(".care-item.selected")?.textContent).toContain("吃点东西");
  await key("c"); expect(advice()?.textContent).toContain(profile.label);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(writes()).toHaveLength(0);
});

it.each([
  { name: "comfortable", needs: {} },
  { name: "playful", needs: { mood: 10 } },
  { name: "quiet", needs: { energy: 43, mood: 10 } },
])("does not clutter $name companionship with body-care instructions", async profile => {
  Object.assign(saved.needs, profile.needs); await mount();
  expect(advice()).toBeNull(); expect(writes()).toHaveLength(0);
});
it("leaves sleeping care to the existing wake-first guidance, without duplicating it", async () => {
  saved.sleeping = true; saved.needs.hunger = 10; await mount();
  expect(advice()).toBeNull();
  expect(screen.getAllByLabelText("照顾建议")).toHaveLength(1);
  expect(document.querySelector(".sleep-home-guidance")?.textContent).toContain("先从菜单选「起床啦」");
  expect(writes()).toHaveLength(0);
});
it("does not show care before a pet is welcomed", async () => {
  saved.hatchedAt = 0; saved.growth = emptyGrowth("egg"); saved.needs.hunger = 10;
  await mount(); expect(document.querySelector(".content-choose")).not.toBeNull();
  expect(advice()).toBeNull(); expect(writes()).toHaveLength(0);
});
it("supports an old save without claiming missing growth rewards", async () => {
  delete saved.growth; saved.needs.clean = 10; await mount();
  expect(advice()?.textContent).toContain("洗个澡澡");
  expect(advice()?.textContent).not.toMatch(/成长点|习惯|\+/); expect(writes()).toHaveLength(0);
});
it("uses only accepted snapshots, not the local clock or a stale revision", async () => {
  saved.needs.hunger = 10; await mount(); await tick(1000);
  expect(advice()?.textContent).toContain("吃点东西");
  saved.revision++; saved.needs.hunger = 80; saved.needs.clean = 10; await tick();
  expect(advice()?.textContent).toContain("洗个澡澡");
  saved.revision--; saved.needs.clean = 80; saved.needs.energy = 10; await tick();
  expect(advice()?.textContent).toContain("洗个澡澡");
  saved.revision += 2; saved.needs.energy = 80; await tick();
  expect(advice()).toBeNull(); expect(writes()).toHaveLength(0);
});
it("distinguishes current care from a precise historical receipt throughout the feed-clean chain", async () => {
  saved.needs = { hunger: 12, clean: 18, energy: 20, mood: 50 };
  api.mockImplementation(async (path, body) => {
    if (path !== "action") return response();
    const kind = (body as { kind: "feed" | "clean" }).kind;
    const before = structuredClone(saved.needs);
    if (kind === "feed") { saved.needs.hunger += 20; saved.needs.clean -= 3; saved.needs.mood += 3; }
    else { saved.needs.clean += 35; saved.needs.mood += 4; }
    saved.revision++; saved.careCount++;
    const feedback: CareFeedback = { kind, points: .25, habit: kind === "feed" ? "nutrition" : "clean", habitGain: 1,
      reason: "credited", effect: { at: Date.now(), before, after: structuredClone(saved.needs) } };
    return { ...response(), careFeedback: feedback };
  });
  await mount(); await care(0);
  expect(advice()).toBeNull(); // Do not compete with the care animation.
  await key("c");
  expect(advice()?.textContent).toContain("洗个澡澡");
  expect(document.querySelector("[data-feedback=credited]")).not.toBeNull();
  expect(outcome()?.textContent).toContain("12.00 → 32.00");
  expect(outcome()?.textContent).toContain("18.00 → 15.00");
  expect(screen.getByLabelText("本次成长与习惯").textContent).toContain("本次成长：+0.25 点");
  const historical = outcome()?.textContent;
  await tick(7999); expect(document.querySelector("[data-feedback=credited]")).not.toBeNull();
  await tick(1); expect(document.querySelector("[data-feedback=idle]")).not.toBeNull();
  expect(advice()?.textContent).toContain("洗个澡澡"); expect(outcome()?.textContent).toBe(historical);
  await care(2); expect(advice()).toBeNull(); await key("c");
  expect(advice()?.textContent).toContain("睡个好觉");
  expect(outcome()?.textContent).toContain("15.00 → 50.00");
  const cleaning = outcome()?.textContent;
  // A newer current state must not rewrite the last operation's historical values.
  saved.revision++; saved.needs.energy = 80; saved.needs.hunger = 80; await tick();
  expect(advice()).toBeNull(); expect(outcome()?.textContent).toBe(cleaning);
  expect(writes().map(([, body]) => (body as { kind: string }).kind)).toEqual(["feed", "clean"]);
});
it("B still executes the default feed, not the suggested rest", async () => {
  saved.needs.energy = 10; await mount();
  expect(advice()?.textContent).toContain("睡个好觉"); await care(0);
  expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ kind: "feed" });
});
it("hides last-read home advice during recovery and reads fresh needs without replaying care", async () => {
  saved.needs.hunger = 10; await mount();
  expect(advice()?.textContent).toContain("吃点东西");
  api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await tick();
  expect(document.querySelector(".save-recovery")).not.toBeNull(); expect(advice()).toBeNull();
  saved.revision++; saved.needs.hunger = 80; saved.needs.clean = 10; await key("b");
  expect(advice()?.textContent).toContain("洗个澡澡"); expect(writes()).toHaveLength(0);
});
