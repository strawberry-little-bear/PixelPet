import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { RequestFailure } from "./requestFailure";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), first = "a".repeat(32), next = "b".repeat(32);
let saved: PetState, generation: string;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "", saveGeneration: generation });
const writes = () => api.mock.calls.filter(([p]) => ["action", "reset", "import", "recap/read"].includes(p));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function poll() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function menu(index: number) { await key("a"); for (let i = 0; i < index; i++) await key("a"); await key("b"); }
async function preview() {
  const body = JSON.stringify(saved), file = new File([body], "same-pet.json");
  Object.defineProperty(file, "text", { value: async () => body });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [file] } }); });
}
function resetModal() { fireEvent.click(screen.getByRole("button", { name: /存档盒/ })); fireEvent.click(screen.getByRole("button", { name: "重新开始" })); }
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = first;
  saved = { schema: 11, revision: 10, species: 2, name: "保护伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth("baby"),
    needs: { hunger: 40, mood: 80, clean: 60, energy: 80 }, careCount: 0, logs: [] };
  api.mockImplementation(async (path, _body, expected) => {
    if (["action", "reset", "import", "recap/read"].includes(path)) {
      if (expected !== generation) throw new RequestFailure("存档已替换", "rejected", "save_changed", generation);
      saved.revision++;
      if (path === "action") saved.careCount++;
    }
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("save-generation-scoped user intent", () => {
  it.each(["feed", "reset", "import"])("a stale %s is rejected, then only a fresh explicit action can run", async kind => {
    await mount();
    if (kind === "reset") resetModal();
    if (kind === "import") await preview();
    generation = next; saved.revision++; const snapshot = structuredClone(saved);
    if (kind === "feed") await menu(0);
    if (kind === "reset") await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "重新开始确认文字" }), { target: { value: saved.name } }); fireEvent.click(screen.getByRole("button", { name: "确认重新开始" })); });
    if (kind === "import") await key("b");
    expect(writes()).toHaveLength(1); expect(writes()[0][2]).toBe(first);
    expect(saved).toEqual(snapshot);
    expect(document.querySelector(".save-recovery")?.textContent).toContain("本次操作未执行");
    expect(document.querySelector(".save-recovery")?.textContent).not.toContain("可能已经保存");
    expect(document.querySelector("[role=dialog], .import-preview")).toBeNull();
    await key("a"); await key("c"); expect(writes()).toHaveLength(1);
    await key("b");
    expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(document.querySelector(".save-recovery")).toBeNull();
    expect(document.querySelector(".pet-scene")?.getAttribute("data-motion")).toBe("idle");
    expect(writes()).toHaveLength(1);
    await menu(0); expect(writes()).toHaveLength(2); expect(writes()[1][2]).toBe(next);
    expect(saved.careCount).toBe(snapshot.careCount + 1);
  });

  it.each(["growth", "preview", "reset"])("a normal read cancels %s after a same-identity import", async panel => {
    await mount();
    if (panel === "growth") await menu(6);
    if (panel === "preview") await preview();
    if (panel === "reset") resetModal();
    generation = next; saved.revision++; await poll();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector("[role=dialog], .import-preview")).toBeNull();
    expect(writes()).toHaveLength(0);
    await menu(0); expect(writes()[0][2]).toBe(next);
  });

  it("failed recovery reads retain the known rejection and never retry the write", async () => {
    await mount(); generation = next; saved.revision++; await menu(0);
    api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await key("b");
    expect(screen.getByRole("alert").textContent).toContain("上次操作未执行");
    expect(document.querySelector(".save-recovery")?.textContent).toContain("本次操作未执行");
    expect(writes()).toHaveLength(1);
    await key("b"); expect(document.querySelector(".save-recovery")).toBeNull(); expect(writes()).toHaveLength(1);
  });

  it("an older recovery read does not turn a known refusal into an uncertain write", async () => {
    await mount(); const stale = result(); stale.state.revision--;
    generation = next; saved.revision++; await menu(0);
    api.mockResolvedValueOnce(stale); await key("b");
    expect(screen.getByRole("alert").textContent).toContain("上次操作未执行");
    expect(screen.getByRole("alert").textContent).not.toContain("结果仍未确认");
    expect(document.querySelector(".save-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(1);
    await key("b"); expect(document.querySelector(".save-recovery")).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it("a delayed pre-import read cannot retarget the next operation to an old generation", async () => {
    await mount(); await preview(); const stale = result();
    let finish!: (r: Result) => void;
    api.mockImplementation(async (path, _body, expected) => {
      if (path === "visit") return new Promise<Result>(resolve => { finish = resolve; });
      if (path === "import") { generation = next; saved.revision++; }
      if (path === "action") expect(expected).toBe(next);
      return result();
    });
    await poll(); await key("b"); await act(async () => { finish(stale); });
    expect(document.querySelector(".content-home")).toBeTruthy();
    await menu(0); expect(writes().at(-1)?.[2]).toBe(next);
  });

  it.each([false, true])("a fresh read may cross a repaired generation with a lower revision (after rejection=%s)", async rejected => {
    await mount(); generation = next; saved.revision = 1;
    if (rejected) { await menu(0); await key("b"); } else { await menu(6); await poll(); }
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".save-recovery")).toBeNull();
    await menu(0); expect(writes().at(-1)?.[2]).toBe(next);
  });


  it.each(["import", "reset"])("first-load corrupt diagnosis scopes the explicit %s repair", async kind => {
    api.mockRejectedValueOnce(new RequestFailure("坏档", "unavailable", "save_corrupt", first)); await mount();
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    if (kind === "import") { await preview(); await key("b"); }
    else { resetModal(); await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "重新开始确认文字" }), { target: { value: "重新开始" } }); fireEvent.click(screen.getByRole("button", { name: "确认重新开始" })); }); }
    expect(writes()).toHaveLength(1); expect(writes()[0][2]).toBe(first);
  });

  it("a second corrupt generation invalidates a repair preview instead of silently rebinding it", async () => {
    api.mockRejectedValueOnce(new RequestFailure("坏档", "unavailable", "save_corrupt", first)); await mount(); await preview();
    generation = next;
    api.mockRejectedValueOnce(new RequestFailure("另一个坏档", "unavailable", "save_corrupt", next)); await poll();
    expect(document.querySelector(".import-preview")).toBeNull();
    await key("b"); expect(writes()).toHaveLength(0);
  });

  it("a pending return-summary acknowledgment is generation scoped too", async () => {
    const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 0, rest: 0, trackedHours: 0 };
    const initial = { ...result(), recapPending: true, returnRecap: { id: "pending", from: Date.now() - 3600000, to: Date.now(), before: snapshot, after: snapshot } };
    generation = next; saved.revision++; api.mockResolvedValueOnce(initial); await mount();
    expect(writes()).toHaveLength(1); expect(writes()[0]).toEqual(["recap/read", { id: "pending" }, first]);
    expect(document.querySelector(".save-recovery")?.textContent).toContain("本次操作未执行");
    await key("b"); expect(writes()).toHaveLength(1);
  });
});
