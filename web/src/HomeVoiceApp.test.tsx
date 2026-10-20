import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { homeVoice } from "./homeVoice";
import { species } from "./types";
import { RequestFailure } from "./requestFailure";
import type { PetState } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const caption = () => document.querySelector(".growth-feedback strong")?.textContent;
const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
const mount = async () => { await act(async () => { render(<App />); }); };
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  const now = Date.now();
  saved = { schema: 12, revision: 1, species: 2, name: "草莓兔", createdAt: now - 2000,
    hatchedAt: now - 1000, lastTick: now, sleeping: false, careCount: 0, logs: [],
    growth: emptyGrowth("baby"), needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } };
  api.mockImplementation(async () => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const cases = species.flatMap((name, index) => (["baby", "growing", "adult"] as const).flatMap(stage =>
  (["content", "quiet"] as const).map(kind => ({ name, index, stage, kind }))));
it.each(cases)("shows $name $stage $kind voice, keeps care advice/three keys and returns without a write", async ({ index, stage, kind }) => {
  Object.assign(saved, { species: index, name: species[index], growth: emptyGrowth(stage) });
  if (kind === "quiet") Object.assign(saved.needs, { energy: 44, mood: 60 });
  const before = structuredClone(saved), voice = homeVoice(index, stage, kind)!;
  await mount();
  expect(caption()).toBe(voice);
  expect(document.querySelector(`.gesture-${kind}`)).not.toBeNull();
  expect(document.querySelector(".growth-feedback")?.getAttribute("data-feedback")).toBe("idle");
  expect(document.querySelector(".growth-feedback")?.getAttribute("role")).toBeNull();
  await key("a"); // Menu: existing actionable care advice, not a dialogue choice.
  expect(document.querySelector(".care-menu-advice")?.textContent).toContain(kind === "content" ? "现在很舒适" : "可以安静陪伴");
  await key("c"); expect(caption()).toBe(voice);
  await advance(15000); expect(caption()).toBe(voice);
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd input,.lcd a,.lcd [role=button]")).toBeNull();
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(document.querySelector(".pet-scene")?.getAttribute("data-echo")).toBeNull();
  expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
  expect(api.mock.calls.every(([path]) => path === "visit" || path === "state")).toBe(true);
  expect(saved).toEqual(before);
});

it("changes the current calm voice to a genuine body need on polling, without inventing a care outcome", async () => {
  await mount(); expect(caption()).toBe(homeVoice(2, "baby", "content"));
  saved.needs.hunger = 10; saved.revision++;
  await advance(15000);
  expect(caption()).toBe("小肚子咕噜咕噜，想吃点东西");
  expect(document.querySelector(".gesture-hungry")).not.toBeNull();
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(api.mock.calls.every(([path]) => path === "visit" || path === "state")).toBe(true);
});

it("hides the voice when a read fails and restores only after explicit authoritative reconciliation", async () => {
  await mount();
  api.mockRejectedValue(new RequestFailure("lost", "unavailable"));
  await advance(15000);
  expect(document.querySelector(".save-recovery")).not.toBeNull();
  expect(document.querySelector(".growth-feedback")).toBeNull();
  api.mockResolvedValue({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
  await key("b"); expect(caption()).toBe(homeVoice(2, "baby", "content"));
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(api.mock.calls.every(([path]) => path === "visit" || path === "state")).toBe(true);
});

it.each(["balanced", "lively", "gentle", "easygoing"] as const)("uses saved %s adult voice across reads without replacing needs or replaying feedback", async form => {
  saved.growth = { ...emptyGrowth("adult"), form };
  const voice = homeVoice(2, "adult", "content", form);
  await mount();
  expect(caption()).toBe(voice);
  await key("a"); await key("c");
  expect(caption()).toBe(voice);
  // A later habit balance is not a new adult form or dialogue event.
  saved.growth.care.play = 200;
  saved.growth.care.rest = 100;
  saved.revision++;
  await advance(15000);
  expect(caption()).toBe(voice);
  expect(document.querySelector(".growth-feedback")?.getAttribute("role")).toBeNull();
  saved.needs.hunger = 10; saved.revision++;
  await advance(15000);
  expect(caption()).toBe("小肚子咕噜咕噜，想吃点东西");
  saved.needs.hunger = 80; saved.needs.energy = 44; saved.needs.mood = 60; saved.revision++;
  await advance(15000);
  expect(caption()).toBe(homeVoice(2, "adult", "quiet"));
  saved.sleeping = true; saved.revision++;
  await advance(15000);
  expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("sleeping");
  expect(caption()).not.toBe(voice);
  expect(document.querySelector(".care-outcome")).toBeNull();
  expect(document.querySelector(".pet-scene")?.getAttribute("data-echo")).toBeNull();
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd input,.lcd a,.lcd [role=button]")).toBeNull();
  expect(api.mock.calls.every(([path]) => path === "visit" || path === "state")).toBe(true);
});
