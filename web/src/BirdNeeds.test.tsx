import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import { petNeed } from "./needs";
import type { GrowthStage, Needs, PetState } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const cases = [
  { kind: "hungry", needs: { hunger: 10 }, text: "小翅贴贴肚子，想吃点东西" },
  { kind: "tired", needs: { energy: 20 }, text: "小翅揉揉眼睛，想收翅休息" },
  { kind: "dirty", needs: { clean: 15 }, text: "翅尖理理羽毛，想洗个泡泡澡" },
  { kind: "playful", needs: { mood: 40 }, text: "扬起小翅，一起推推球？" },
  { kind: "content", needs: {}, text: "眯眯眼、轻轻动动翅膀，有你在真好" },
  { kind: "quiet", needs: { mood: 60, energy: 44 }, text: "收拢小翅，想和你安静待一会儿" },
] as const;
function pet(needs: Partial<Needs> = {}, stage: GrowthStage = "baby"): PetState {
  return { schema: 12, revision: 1, species: 1, name: "云朵雀", createdAt: Date.now() - 2000,
    hatchedAt: Date.now() - 1000, lastTick: Date.now(), sleeping: false, careCount: 0, logs: [],
    growth: emptyGrowth(stage), needs: { hunger: 80, mood: 80, clean: 80, energy: 80, ...needs } };
}
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); api.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(cases)("describes the bird's $kind gesture without changing need priority or save data", cue => {
  const bird = pet(cue.needs), before = structuredClone(bird);
  const common = petNeed({ ...bird, species: 2 })!;
  expect(petNeed(bird)).toEqual({ kind: cue.kind, urgent: common.urgent, text: cue.text });
  expect(common.kind).toBe(cue.kind);
  expect(petNeed(bird)?.text).not.toMatch(/手|爪|鳍|耳|菌盖/);
  expect(petNeed(bird)).toEqual(petNeed(bird));
  expect(bird).toEqual(before);
});

describe.each(["baby", "growing", "adult"] as const)("bird need presentation at %s", stage => {
  it.each(cases)("connects $kind wording to the existing wing rig using only A/B/C", async cue => {
    const saved = pet(cue.needs, stage), before = structuredClone(saved);
    api.mockResolvedValue({ state: saved, serverTime: Date.now(), saveGeneration: "a".repeat(32), message: "" });
    await act(async () => { render(<App />); });
    const caption = document.querySelector(".growth-feedback strong");
    expect(caption?.textContent).toContain(cue.text);
    expect(document.querySelector(`.bird-${stage}.gesture-${cue.kind}`)).toBeTruthy();
    expect(document.querySelectorAll(".pet-scene .bird-wing")).toHaveLength(2);
    const description = document.querySelector(".pet-scene")?.getAttribute("aria-label");
    expect(description).toMatch(/翅/);
    expect(description).not.toMatch(/手|爪|鳍|耳|菌盖/);
    expect(document.querySelector(".pet-scene .need-paw")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
    expect(api.mock.calls.every(([path]) => path === "visit")).toBe(true);
    expect(saved).toEqual(before);
  });
  it("keeps sleep, egg and active-game suppression and urgent-body priority", () => {
    const saved = pet({ hunger: 10, energy: 5, clean: 15, mood: 0 }, stage);
    expect(petNeed(saved)).toMatchObject({ kind: "tired", urgent: true, text: cases[1].text });
    expect(petNeed({ ...saved, sleeping: true })).toBeNull();
    expect(petNeed({ ...saved, hatchedAt: 0 })).toBeNull();
    expect(petNeed({ ...saved, game: { startedAt: 1, round: 0, score: 0, lastBeat: -1 } })).toBeNull();
    const legacy = { ...pet({}, stage) }; delete legacy.growth;
    expect(petNeed(legacy)).toMatchObject({ kind: "content", text: cases[4].text });
  });
});
