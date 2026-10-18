import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import App from "./App";
import { request } from "./api";
import type { PetState } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));

let saved: PetState;
const api = vi.mocked(request);
const state = () => ({
  state: structuredClone(saved),
  message: "照顾成功",
  serverTime: Date.now(),
});
const scene = () =>
  document.querySelector(".pet-scene")?.getAttribute("data-motion");
async function key(value: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: value });
  });
}
async function choose(menuIndex: number) {
  await key("a");
  for (let i = 0; i < menuIndex; i++) await key("a");
  await key("b");
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function mount() {
  await act(async () => {
    render(<App />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api.mockReset();
  saved = {
    schema: 1,
    revision: 1,
    species: 2,
    name: "草莓兔",
    createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000,
    lastTick: Date.now(),
    sleeping: false,
    needs: { hunger: 60, mood: 70, clean: 60, energy: 80 },
    careCount: 0,
    logs: [{ at: Date.now(), text: "你好，小伙伴。" }],
  };
  api.mockImplementation(async (path, body) => {
    if (path === "action") {
      const action = body as { kind: string };
      if (action.kind === "feed") {
        saved.needs.hunger += 20;
        saved.careCount++;
      }
      if (action.kind === "clean") {
        saved.needs.clean = 95;
        saved.careCount++;
      }
      if (action.kind === "sleep") saved.sleeping = !saved.sleeping;
      if (action.kind === "play")
        saved.game = {
          startedAt: Date.now(),
          round: 0,
          score: 0,
          lastBeat: -1,
        };
      saved.revision++;
    }
    return state();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("three-button pet animation lifecycle", () => {
  it("plays a saved meal once and returns to idle without another API mutation", async () => {
    await mount();
    expect(scene()).toBe("idle");
    expect(document.querySelector(".lcd button")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    await choose(0);
    expect(scene()).toBe("eating");
    expect(document.querySelectorAll(".rice-bite")).toHaveLength(2);
    expect(
      (screen.getByRole("button", { name: "A 选择" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "C 返回" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await key("b"); // Keyboard cannot feed twice while the clip is playing.
    expect(saved.careCount).toBe(1);
    await advance(2999);
    expect(scene()).toBe("eating");
    await advance(1);
    expect(scene()).toBe("idle");
    expect(api.mock.calls.filter(([path]) => path === "action")).toHaveLength(
      1,
    );
  });

  it("C skips only the picture; an old meal timeout cannot cut off the next bath", async () => {
    await mount();
    await choose(0);
    await advance(500);
    await key("c");
    expect(scene()).toBe("idle");
    expect(saved.needs.hunger).toBe(80);
    await choose(2);
    expect(scene()).toBe("bathing");
    expect(document.querySelector(".bath-tub")).not.toBeNull();
    expect(document.querySelectorAll(".bath-bubbles i")).toHaveLength(6);
    await advance(2500);
    expect(scene()).toBe("bathing");
    await advance(1499);
    expect(scene()).toBe("bathing");
    await advance(1);
    expect(scene()).toBe("idle");
    expect(saved.careCount).toBe(2);
  });

  it("restores closed-eye sleep after remount and wakes through the same three keys", async () => {
    await mount();
    await choose(3);
    expect(scene()).toBe("sleeping");
    expect(document.querySelector(".expression-asleep")).not.toBeNull();
    expect(document.querySelector(".sleep-blanket")).not.toBeNull();
    await advance(30000);
    expect(scene()).toBe("sleeping");
    cleanup();
    await mount();
    expect(scene()).toBe("sleeping");
    await choose(3);
    expect(scene()).toBe("waking");
    expect(saved.sleeping).toBe(false);
    await advance(1400);
    expect(scene()).toBe("idle");
    expect(document.querySelector(".sleep-blanket")).toBeNull();
  });

  it("does not show a successful care animation when saving fails", async () => {
    await mount();
    api.mockRejectedValueOnce(new Error("保存失败，请重试"));
    await choose(0);
    expect(scene()).toBeUndefined(); // Still in the menu, awaiting a successful save.
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    expect(saved.careCount).toBe(0);
    expect(
      (screen.getByRole("button", { name: "B 确认" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await key("c");
    expect(scene()).toBe("idle");
  });

  it("does not let a celebration lock the controls when a mini game starts", async () => {
    await mount();
    await choose(1);
    expect(document.querySelector(".star-game")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "A 选择" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
