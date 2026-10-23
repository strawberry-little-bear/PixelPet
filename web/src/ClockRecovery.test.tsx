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
const clock = () => new RequestFailure("service clock behind", "rejected", "clock_ahead");
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset", "recap/read"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function click(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }
async function file(text: () => Promise<string> = async () => JSON.stringify(saved)) {
  const chosen = new File(["{}"], "backup.json", { type: "application/json" });
  Object.defineProperty(chosen, "text", { value: text });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [chosen] } }); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset();
  saved = { schema: 8, revision: 2, species: 2, name: "校时伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [] };
  api.mockRejectedValue(clock());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("service clock recovery", () => {
  it("never treats clock mismatch as corruption or permits writes, exports or LCD clicks", async () => {
    await mount();
    expect(document.querySelector(".clock-recovery")?.textContent).toContain("这不表示存档损坏");
    expect(document.querySelector(".clock-recovery")?.textContent).toContain("运行 Go 服务的电脑时间");
    expect(document.querySelector(".corrupt-recovery,.outside-needs,.companion-growth,.collection-pet.is-chosen")).toBeNull();
    expect(document.querySelector(".local-status")?.textContent).toContain("服务时间待校准");
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    await key("a"); await key("c"); await key("b"); await poll();
    expect(api.mock.calls.map(([path]) => path)).toEqual(["visit", "state", "state"]);
    await click(/存档盒/);
    for (const name of ["导入备份", "重新开始"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "导出存档" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出存档" })).toBeNull();
    await file(); await key("b");
    expect(writes()).toHaveLength(0);
    expect(document.querySelector(".import-preview")).toBeNull();
  });

  it("recovers silently via one authoritative GET and never replays care or growth animation", async () => {
    api.mockResolvedValue(result()); await mount();
    api.mockRejectedValue(clock()); await poll();
    saved.growth = emptyGrowth("adult"); saved.growth.form = "gentle"; saved.revision++;
    api.mockResolvedValue(result()); await key("b");
    expect(document.querySelector(".clock-recovery,.save-recovery,[data-motion='evolve']")).toBeNull();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "校时伙伴" })).toBeTruthy();
    expect(api.mock.calls.at(-1)?.[0]).toBe("state"); expect(writes()).toHaveLength(0);
  });

  it("retains read-only silent recovery across a network failure without claiming a fresh clock diagnosis", async () => {
    await mount();
    api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await key("b");
    expect(document.querySelector(".clock-recovery,.corrupt-recovery")).toBeNull();
    api.mockResolvedValue(result()); await key("b");
    expect(api.mock.calls.map(([path]) => path)).toEqual(["visit", "state", "state"]);
    expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
  });

  it("can redisplay clock diagnosis after temporary network loss", async () => {
    await mount(); api.mockRejectedValueOnce(new Error("offline")); await key("b");
    expect(document.querySelector(".clock-recovery")).toBeNull();
    await key("b"); expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("does not clear an unknown write outcome on clock diagnosis or resend the lost write", async () => {
    api.mockResolvedValue(result()); await mount();
    api.mockRejectedValueOnce(new RequestFailure("lost response", "unknown")); await key("b"); await key("b");
    expect(writes()).toHaveLength(1);
    api.mockRejectedValue(clock()); await key("b");
    expect(document.querySelector(".clock-recovery")?.textContent).toContain("上次操作结果仍待核对");
    await key("a"); await key("c"); await poll(); expect(writes()).toHaveLength(1);
    saved.revision++; api.mockResolvedValue(result()); await key("b");
    expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(1);
    expect(document.querySelector("[data-motion='feed']")).toBeNull();
  });

  it("enters clock mode immediately when an action is explicitly rejected by time checks", async () => {
    api.mockResolvedValue(result()); await mount(); api.mockRejectedValue(clock()); await key("b"); await key("b");
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    await key("a"); await key("c"); await key("b"); expect(writes()).toHaveLength(1);
  });

  it("discards late file parsing if the clock diagnosis arrives while a backup is being read", async () => {
    api.mockResolvedValue(result()); await mount(); const gate = deferred<string>(); await file(() => gate.promise);
    api.mockRejectedValue(clock()); await poll();
    await act(async () => { gate.resolve(JSON.stringify(saved)); });
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(document.querySelector(".import-preview")).toBeNull(); expect(writes()).toHaveLength(0);
  });

  it.each(["import", "reset"]) ("closes pending %s confirmation when its write returns a clock rejection", async path => {
    api.mockResolvedValue(result()); await mount();
    if (path === "import") { await file(); }
    else { await click(/存档盒/); await click("重新开始"); }
    api.mockRejectedValue(clock());
    if (path === "import") await key("b");
    else { fireEvent.change(screen.getByRole("textbox", { name: "重新开始确认文字" }), { target: { value: saved.name } }); await click("确认重新开始"); }
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(document.querySelector(".import-preview,.modal")).toBeNull();
    await key("b"); await key("a"); await key("c");
    expect(writes().map(([p]) => p)).toEqual([path]);
  });

  it("revokes corrupt-save repair eligibility when the current save is instead clock-blocked", async () => {
    api.mockRejectedValue(new RequestFailure("invalid", "rejected", "save_corrupt")); await mount(); await file();
    api.mockRejectedValue(clock()); await poll();
    expect(document.querySelector(".corrupt-recovery,.import-preview")).toBeNull();
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it("only enables corruption repair after a new explicit corruption diagnosis", async () => {
    await mount(); api.mockRejectedValue(new RequestFailure("invalid", "rejected", "save_corrupt")); await key("b");
    expect(document.querySelector(".clock-recovery")).toBeNull();
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("also handles a clock rejection from the one-time return-summary claim", async () => {
    const snap = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 1, rest: 0, trackedHours: 0 };
    api.mockImplementation(async path => {
      if (path === "recap/read") throw clock();
      return { ...result(), recapPending: true, returnRecap: { id: "recap-clock", from: 1, to: Date.now(), before: snap, after: snap } };
    });
    await mount(); expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(writes().map(([path]) => path)).toEqual(["recap/read"]);
  });
  it("does not issue concurrent B rechecks or accept a stale clock poll after a newer action", async () => {
    await mount(); const read = deferred<Result>();
    api.mockImplementation(async () => read.promise);
    await key("b"); await key("b"); await key("b");
    expect(api.mock.calls.map(([path]) => path)).toEqual(["visit", "state"]);
    await act(async () => { read.resolve(result()); });
    expect(document.querySelector(".content-home")).toBeTruthy();
    const stale = deferred<Result>();
    api.mockImplementation(async path => {
      if (path === "visit") return stale.promise;
      return result();
    });
    await poll(); await key("b"); await key("b");
    expect(writes()).toHaveLength(1);
    await act(async () => { stale.reject(clock()); });
    expect(document.querySelector(".clock-recovery,.save-recovery")).toBeNull();
  });

  it("closes a stale help overlay so a new clock diagnosis remains visible", async () => {
    api.mockResolvedValue(result()); await mount(); await click("玩法说明");
    expect(document.querySelector(".modal")).toBeTruthy();
    api.mockRejectedValue(clock()); await poll();
    expect(document.querySelector(".modal")).toBeNull();
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("does not let clock recovery roll back a previously known healthy revision", async () => {
    saved.revision = 10; api.mockResolvedValue(result()); await mount();
    api.mockRejectedValue(clock()); await poll();
    saved.revision = 9; api.mockResolvedValue(result()); await key("b");
    expect(document.querySelector(".clock-recovery")).toBeTruthy();
    expect(document.querySelector(".toast.error")?.textContent).toContain("读到较旧的存档");
    saved.revision = 10; api.mockResolvedValue(result()); await key("b");
    expect(document.querySelector(".save-recovery")).toBeNull(); expect(writes()).toHaveLength(0);
  });

});
