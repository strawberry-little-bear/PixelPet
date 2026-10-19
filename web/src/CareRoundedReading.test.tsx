import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { CarePreview, carePreview } from "./CarePreview";
import { emptyGrowth } from "./growth";
import type { GrowthStage, Needs, PetState } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const boundaries = [
  { kind: "feed", key: "hunger", label: "饱食", threshold: 70, below: 69.999999, above: 70.000001 },
  { kind: "feed", key: "hunger", label: "饱食", threshold: 96, below: 95.999999, above: 96.000001 },
  { kind: "clean", key: "clean", label: "清洁", threshold: 65, below: 64.999999, above: 65.000001 },
  { kind: "clean", key: "clean", label: "清洁", threshold: 99, below: 98.999999, above: 99.000001 },
  { kind: "sleep", key: "energy", label: "体力", threshold: 100, below: 99.999999 },
] as const;
function pet(stage: GrowthStage = "baby"): PetState {
  return { schema: 12, revision: 1, species: 2, name: "边界伙伴", createdAt: Date.now() - 2000,
    hatchedAt: Date.now() - 1000, lastTick: Date.now(), sleeping: false, careCount: 0, logs: [],
    growth: emptyGrowth(stage), needs: { hunger: 80, mood: 80, clean: 80, energy: 80 } };
}
const note = (label: string, direction: string, threshold: number) =>
  `最近读取：${label}实际${direction} ${threshold}，整数显示 ${threshold}。`;
function preview(saved: PetState, kind: string) { return render(<CarePreview pet={saved} kind={kind} hint="只读说明" />); }
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); api.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe.each(boundaries)("rounded $kind / $threshold", boundary => {
  it("explains a fractional value below the displayed threshold without changing the preview rules", () => {
    const saved = pet(); saved.needs[boundary.key] = boundary.below;
    const original = structuredClone(saved), lines = carePreview(saved, boundary.kind);
    const { container } = preview(saved, boundary.kind);
    expect(container.querySelector(".care-rounded-reading")?.textContent).toBe(note(boundary.label, "低于", boundary.threshold));
    for (const line of lines) expect(container.textContent).toContain(line);
    expect(container.querySelector("button,a,input,[role=button],[aria-live]")).toBeNull();
    expect(saved).toEqual(original);
  });
  it("does not add a rounding warning at the exact threshold", () => {
    const saved = pet(); saved.needs[boundary.key] = boundary.threshold;
    expect(preview(saved, boundary.kind).container.querySelector(".care-rounded-reading")).toBeNull();
  });
});
it.each(boundaries.filter(b => "above" in b))("explains the actual value above $kind / $threshold, not a rounded eligibility decision", boundary => {
  const saved = pet(); saved.needs[boundary.key] = boundary.above;
  expect(preview(saved, boundary.kind).container.querySelector(".care-rounded-reading")?.textContent).toBe(note(boundary.label, "高于", boundary.threshold));
});
it.each(["feed", "clean", "sleep"] as const)("does not clutter ordinary fractional %s readings or suppress unchanged legacy text", kind => {
  const saved = pet(); saved.needs = { hunger: 60.1, mood: 80, clean: 60.1, energy: 80.1 }; delete saved.growth;
  const { container } = preview(saved, kind);
  expect(container.querySelector(".care-rounded-reading")).toBeNull();
  expect(container.textContent).toContain("尚未读到");
});
it.each(["feed", "clean", "sleep"] as const)("suppresses irrelevant %s boundary notes before hatching, in games, and for other menu items", kind => {
  const saved = pet(); saved.needs = { hunger: 70.4, mood: 80, clean: 65.4, energy: 99.6 };
  saved.hatchedAt = 0; expect(preview(saved, kind).container.querySelector(".care-rounded-reading")).toBeNull(); cleanup();
  saved.hatchedAt = 1; saved.game = { startedAt: 1, round: 0, score: 0, lastBeat: -1 };
  expect(preview(saved, kind).container.querySelector(".care-rounded-reading")).toBeNull(); cleanup();
  delete saved.game; expect(preview(saved, "status").container.querySelector(".care-rounded-reading")).toBeNull(); cleanup();
  saved.sleeping = true;
  const { container } = preview(saved, kind);
  expect(!!container.querySelector(".care-rounded-reading")).toBe(kind === "sleep");
});

const flows: { kind: "feed" | "clean" | "sleep"; key: keyof Needs; value: number; label: string; threshold: number; direction: string; selection: number }[] = [
  { kind: "feed", key: "hunger", value: 70.4, label: "饱食", threshold: 70, direction: "高于", selection: 0 },
  { kind: "feed", key: "hunger", value: 95.6, label: "饱食", threshold: 96, direction: "低于", selection: 0 },
  { kind: "clean", key: "clean", value: 65.4, label: "清洁", threshold: 65, direction: "高于", selection: 2 },
  { kind: "clean", key: "clean", value: 98.6, label: "清洁", threshold: 99, direction: "低于", selection: 2 },
  { kind: "sleep", key: "energy", value: 99.6, label: "体力", threshold: 100, direction: "低于", selection: 3 },
];
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
describe.each(["baby", "growing", "adult"] as const)("three-key boundary explanation at %s", stage => {
  it.each(flows)("shows $kind / $threshold without blocking or replaying the explicit care action", async flow => {
    const saved = pet(stage); saved.needs[flow.key] = flow.value;
    api.mockResolvedValue({ state: saved, serverTime: Date.now(), saveGeneration: "a".repeat(32), message: "" });
    await act(async () => { render(<App />); });
    await key("a"); for (let i = 0; i < flow.selection; i++) await key("a");
    expect(document.querySelector(".care-rounded-reading")?.textContent).toBe(note(flow.label, flow.direction, flow.threshold));
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(0);
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toBeNull();
    await key("b");
    const writes = api.mock.calls.filter(([path]) => path === "action");
    expect(writes).toHaveLength(1); expect(writes[0][1]).toMatchObject({ kind: flow.kind });
  });
});
