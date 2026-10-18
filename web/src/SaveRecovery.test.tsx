import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const failure = () => new RequestFailure("connection interrupted", "unknown");
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import"].includes(path));
const recovery = () => document.querySelector(".save-recovery");
const scene = () => document.querySelector(".pet-scene")?.getAttribute("data-motion");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 8, revision: 2, species: 2, name: "草莓兔", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 50, mood: 70, clean: 60, energy: 80 }, careCount: 0,
    growth: emptyGrowth("baby"), logs: [],
    economy: { coins: 30, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [], equipped: { accessory: "", room: "" } } };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("uncertain write recovery through A/B/C", () => {
  it("keeps a failed heartbeat visibly disconnected until a successful read", async () => {
    await mount(); api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable"));
    await advance(15000);
    expect(recovery()?.textContent).toContain("小窝暂时未连接");
    expect(recovery()?.textContent).not.toContain("可能已经保存");
    await key("a"); await key("c");
    expect(document.querySelector(".local-status")?.textContent).toContain("小窝暂未连接");
    expect(writes()).toHaveLength(0);
    await key("b"); expect(recovery()).toBeNull(); expect(scene()).toBe("idle");
    expect(writes()).toHaveLength(0);
  });

  it("initial connection failure uses B to load without mutating the pet", async () => {
    api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable"));
    await mount(); expect(recovery()?.textContent).toContain("还没有读到存档");
    await key("b"); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(0);
  });

  it("does not replay reset after its committed response was lost", async () => {
    await mount();
    api.mockImplementation(async path => {
      if (path === "reset") { saved.hatchedAt = 0; saved.revision++; saved.growth = emptyGrowth("egg"); throw failure(); }
      return result();
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新开始" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "确认重新开始" })); });
    expect(recovery()).toBeTruthy();
    await key("b");
    expect(recovery()).toBeNull(); expect(writes()).toHaveLength(1);
    expect(document.querySelector(".content-choose")).toBeTruthy();
    expect(document.querySelector(".confirm-modal")).toBeNull();
  });

  it("reconciles an imported save without replaying import or care", async () => {
    await mount();
    api.mockImplementation(async path => {
      if (path === "import") { saved.species = 7; saved.revision++; saved.sleeping = true; throw failure(); }
      return result();
    });
    const file = new File(["{}"], "test-backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
    expect(recovery()).toBeTruthy();
    await key("b"); expect(recovery()).toBeNull(); expect(writes()).toHaveLength(1);
    expect(scene()).toBe("sleeping"); expect(saved.species).toBe(7);
  });

  it("a stale successful action reply cannot trigger a care animation", async () => {
    await mount(); const stale = result(); stale.state.revision--;
    api.mockResolvedValueOnce(stale); await menu(0);
    expect(recovery()).toBeTruthy(); expect(scene()).toBeUndefined();
    await key("b"); expect(scene()).toBe("idle"); expect(writes()).toHaveLength(1);
  });

  it("reload reads saved state once without replaying the interrupted action", async () => {
    await mount();
    api.mockImplementation(async path => {
      if (path === "action") { saved.careCount++; saved.revision++; throw failure(); }
      return result();
    });
    await menu(0); expect(recovery()).toBeTruthy(); cleanup(); await mount();
    expect(scene()).toBe("idle"); expect(writes()).toHaveLength(1);
    expect(api.mock.calls.at(-1)?.[0]).toBe("visit");
  });

  it.each([false, true])("reads current state without replaying a lost meal (committed=%s)", async committed => {
    await mount();
    api.mockImplementation(async path => {
      if (path === "action") {
        if (committed) { saved.careCount++; saved.revision++; saved.needs.hunger += 20; saved.growth!.stage = "growing"; }
        throw failure();
      }
      return result();
    });
    await menu(0);
    expect(recovery()).toBeTruthy();
    expect(scene()).toBeUndefined();
    expect(screen.getByRole("alert").textContent).toContain("可能已经保存");
    for (const value of ["a", "c", "a", "c"]) await key(value);
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "A 选择" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "B 确认" })).toHaveProperty("disabled", false);
    await key("b");
    expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(api.mock.calls.at(-1)?.[1]).toBeUndefined();
    expect(recovery()).toBeNull();
    expect(scene()).toBe("idle"); // neither a meal nor a late evolution celebration
    expect(saved.careCount).toBe(committed ? 1 : 0);
    expect(document.querySelector(".care-feedback")).toBeNull();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("没有自动重试");
  });

  it("keeps mutations locked across repeated failed reads and prevents concurrent B reads", async () => {
    await mount();
    api.mockRejectedValueOnce(failure()); await menu(0);
    const gate = deferred<Result>();
    api.mockImplementation(async path => { if (path === "state") return gate.promise; return result(); });
    await key("b"); await key("b"); await key("a");
    expect(api.mock.calls.filter(([p]) => p === "state")).toHaveLength(1);
    expect(recovery()?.textContent).toContain("正在核对");
    await act(async () => gate.reject(new RequestFailure("offline", "unavailable")));
    expect(screen.getByRole("alert").textContent).toContain("仍未确认");
    await key("c"); expect(writes()).toHaveLength(1);
    api.mockImplementation(async () => result());
    await key("b"); expect(recovery()).toBeNull(); expect(writes()).toHaveLength(1);
  });

  it("heartbeat recovery is read-only and never replays the lost mutation", async () => {
    await mount(); api.mockRejectedValueOnce(failure()); await menu(0);
    await advance(15000);
    expect(recovery()).toBeNull();
    expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(writes()).toHaveLength(1);
  });

  it("ignores an old pre-write poll without blocking a fresh reconciliation read", async () => {
    await mount();
    const old = deferred<Result>();
    const oldResult = result();
    api.mockImplementation(async path => {
      if (path === "visit") return old.promise;
      if (path === "action") { saved.revision++; saved.careCount++; throw failure(); }
      return result();
    });
    await advance(15000); // read started before the write, still in flight
    await menu(0); expect(recovery()).toBeTruthy();
    await key("b"); expect(recovery()).toBeNull();
    await act(async () => old.resolve(oldResult));
    expect(scene()).toBe("idle"); expect(saved.careCount).toBe(1);
    expect(writes()).toHaveLength(1);
    expect(document.querySelector(".local-status")?.textContent).toContain("成长已好好保存");
  });

  it("an old poll cannot clear an uncertain write or start a success animation", async () => {
    await mount(); const old = deferred<Result>(); const oldResult = result();
    api.mockImplementation(async path => { if (path === "visit") return old.promise; if (path === "action") throw failure(); return result(); });
    await advance(15000); await menu(0);
    await act(async () => old.resolve(oldResult));
    expect(recovery()).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("未确认");
    expect(writes()).toHaveLength(1);
  });

  it("does not unlock after an older recovery snapshot", async () => {
    await mount(); api.mockRejectedValueOnce(failure()); await menu(0);
    const older = result(); older.state.revision--;
    api.mockResolvedValueOnce(older); await key("b");
    expect(recovery()).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("较旧");
    await key("a"); expect(writes()).toHaveLength(1);
    await key("b"); expect(recovery()).toBeNull();
  });

  it("blocks repeat keys until the original write finishes, then offers only reconciliation", async () => {
    await mount(); const gate = deferred<Result>(); api.mockReturnValueOnce(gate.promise);
    await menu(0); await key("b"); await key("a"); expect(writes()).toHaveLength(1);
    await act(async () => gate.reject(failure()));
    await key("c"); await key("a"); expect(writes()).toHaveLength(1); expect(recovery()).toBeTruthy();
  });

  it("uses explicit server rejection normally, without pretending the action saved", async () => {
    await mount(); api.mockRejectedValueOnce(new RequestFailure("先起床再吃饭", "rejected"));
    await menu(0);
    expect(recovery()).toBeNull(); expect(scene()).toBeUndefined();
    expect(screen.getByRole("alert").textContent).toContain("先起床");
    await key("c"); expect(scene()).toBe("idle");
  });

  it("does not buy twice after debit/ownership were saved but the response was lost", async () => {
    const shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [{ id: "sky-bow", name: "天空蝴蝶结", price: 20, slot: "accessory", description: "小小蝴蝶结" }] };
    api.mockImplementation(async path => {
      if (path === "action") { saved.economy!.coins -= 20; saved.economy!.owned.push("sky-bow"); saved.revision++; throw failure(); }
      return { ...result(), shop } as Result;
    });
    await mount(); await menu(9); await key("a"); await key("b"); await key("b"); await key("b");
    expect(recovery()).toBeTruthy();
    await key("a"); await key("c"); expect(writes()).toHaveLength(1);
    await key("b"); expect(recovery()).toBeNull();
    expect(saved.economy!.coins).toBe(10); expect(saved.economy!.owned).toEqual(["sky-bow"]);
    expect(writes()).toHaveLength(1); expect(scene()).toBe("idle");
    expect(document.querySelector(".shop-panel")).toBeNull();
  });

  it("recovers a lost game step as manually paused, never automatically advancing again", async () => {
    saved.game = { id: "game-1", kind: "snake", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1,
      snake: { body: [{ x: 4, y: 4 }, { x: 3, y: 4 }], food: { x: 7, y: 7 }, direction: 0, step: 0, eaten: 0, paused: true,
        lastMoveAt: Date.now() } };
    let failedRead = false;
    api.mockImplementation(async (path, body) => {
      if (path === "state" && !failedRead) { failedRead = true; throw new RequestFailure("offline", "unavailable"); }
      if (path === "action") {
        const a = body as { kind: string };
        if (a.kind === "snake-resume") { saved.game!.snake!.paused = false; saved.revision++; return result(); }
        if (a.kind === "snake-step") { saved.game!.snake!.step++; saved.revision++; throw failure(); }
      }
      return result();
    });
    await mount(); await key("c"); await advance(700); expect(recovery()).toBeTruthy();
    const count = writes().length; await key("b"); expect(recovery()).toBeNull();
    await advance(5000); expect(writes()).toHaveLength(count);
    expect(document.querySelector(".snake-overlay")).toBeTruthy();
  });
});
