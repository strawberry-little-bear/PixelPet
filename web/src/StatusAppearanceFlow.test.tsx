import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth, formNames, stageNames } from "./growth";
import type { AdultForm, GrowthStage, PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const response = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const writes = () => api.mock.calls.filter(([path]) => !["state", "visit"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function openStatus() { await key("a"); for (let i = 0; i < 4; i++) await key("a"); await key("b"); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
const portrait = () => document.querySelector(".status-name");
const appearance = (element: Element | null) => [".growth-outfit", ".growth-form-emblem", ".equipped-accessory"].map(selector => element?.querySelector(selector)?.outerHTML);

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T02:00:00Z"));
  localStorage.clear(); api.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = Date.now();
  saved = { schema: 17, revision: 10, species: 2, name: "成长伙伴", createdAt: at - 7200000,
    hatchedAt: at - 3600000, lastTick: at, sleeping: false, careCount: 0, logs: [],
    needs: { hunger: 70, clean: 70, energy: 70, mood: 70 }, growth: emptyGrowth("baby") };
  api.mockImplementation(async () => response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const stages: [GrowthStage, AdultForm | ""][] = [["baby", ""], ["growing", ""], ...(["balanced", "lively", "gentle", "easygoing"] as AdultForm[]).map(form => ["adult", form] as [GrowthStage, AdultForm])];
it.each(stages)("keeps the home outfit and saved %s/%s form in status", async (stage, form) => {
  saved.growth = { ...emptyGrowth(stage), form };
  // Deliberately contradict the saved adult form: later habits must not redress it.
  saved.growth.care.play = form === "lively" ? 0 : 100;
  saved.growth.care.clean = saved.growth.care.rest = form === "lively" ? 100 : 0;
  const before = structuredClone(saved);
  await mount();
  const home = document.querySelector(".pet-scene"), expected = appearance(home);
  const rig = home?.querySelector(".growth-size")?.className;
  await openStatus();
  expect(portrait()).toBeTruthy();
  expect(appearance(portrait())).toEqual(expected);
  expect(portrait()?.querySelector(".growth-size")?.className).toBe(rig);
  expect(portrait()?.querySelector(".growth-outfit")).toBeTruthy();
  const label = document.querySelector(".status-name")?.textContent;
  expect(label).toContain(stageNames[stage]);
  if (form) expect(label).toContain(formNames[form]);
  expect(saved).toEqual(before); expect(writes()).toHaveLength(0);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".screen-status button,.screen-status input,.screen-status a")).toBeNull();
});
it("replaces the default outfit with the saved accessory and keeps the adult emblem", async () => {
  saved.growth = { ...emptyGrowth("adult"), form: "gentle" };
  saved.economy = { coins: 0, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "" } };
  await mount(); const expected = appearance(document.querySelector(".pet-scene"));
  await openStatus();
  expect(appearance(portrait())).toEqual(expected);
  expect(portrait()?.querySelectorAll('.equipped-accessory[data-item="leaf-pin"]')).toHaveLength(1);
  expect(portrait()?.querySelector(".growth-outfit")).toBeNull();
  expect(portrait()?.querySelector(".growth-form-emblem")).toBeTruthy();
  expect(writes()).toHaveLength(0);
});
it("follows accepted sleep/wake revisions, ignores stale sleep and does not wake the pet by reading", async () => {
  saved.sleeping = true;
  await mount(); await openStatus();
  expect(portrait()?.querySelector(".expression-asleep.rig-motion-sleeping")).toBeTruthy();
  expect(document.querySelector(".status-name")?.textContent).toContain("正在睡觉");
  saved.sleeping = false; saved.revision++; await poll();
  expect(portrait()?.querySelector(".expression-asleep")).toBeNull();
  expect(document.querySelector(".status-name")?.textContent).not.toContain("正在睡觉");
  saved.sleeping = true; saved.revision--; await poll();
  expect(portrait()?.querySelector(".expression-asleep")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("keeps a legacy stage estimate without inventing saved clothes or an adult form", async () => {
  saved.schema = 1; delete saved.growth;
  saved.hatchedAt = Date.now() - 100 * 3600000; saved.createdAt = saved.hatchedAt;
  await mount(); await openStatus();
  expect(portrait()).toBeTruthy();
  expect(document.querySelector(".status-name")?.textContent).toContain("成年期");
  for (const name of Object.values(formNames)) expect(document.querySelector(".status-name")?.textContent).not.toContain(name);
  expect(portrait()?.querySelector(".growth-outfit,.growth-form-emblem")).toBeNull();
  expect(saved.growth).toBeUndefined(); expect(writes()).toHaveLength(0);
});
