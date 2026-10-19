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
let broken: boolean;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" });
const corrupt = () => new RequestFailure("current save invalid", "rejected", "save_corrupt");
const writes = () => api.mock.calls.filter(([path]) => ["action", "import", "reset"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function advance() { await act(async () => { vi.advanceTimersByTime(15000); }); }
async function click(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }
async function file(body = JSON.stringify(saved), text?: () => Promise<string>) {
  const chosen = new File([body], "repair.json", { type: "application/json" });
  Object.defineProperty(chosen, "text", { value: text ?? (async () => body) });
  await act(async () => { fireEvent.change(screen.getByLabelText("导入存档文件"), { target: { files: [chosen] } }); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); broken = true;
  saved = { schema: 8, revision: 2, species: 2, name: "修复伙伴", createdAt: Date.now() - 10000,
    hatchedAt: Date.now() - 9000, lastTick: Date.now(), sleeping: false,
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [] };
  api.mockImplementation(async (path, body) => {
    if (path === "import") { saved = { ...body as PetState, revision: 3 }; broken = false; }
    else if (path === "reset") { saved = { ...saved, hatchedAt: 0, growth: emptyGrowth("egg"), revision: 3 }; broken = false; }
    if (broken) throw corrupt();
    return result();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("explicit repair of a diagnosed corrupt saved state", () => {
  it("enables external repair only after diagnosis, never hatches or cares with A/B/C", async () => {
    await mount();
    expect(document.querySelector(".corrupt-recovery")?.textContent).toContain("存档需要修复");
    expect(document.querySelector(".local-status")?.textContent).toContain("存档需要修复");
    await key("a"); await key("c"); await key("b");
    expect(writes()).toHaveLength(0);
    expect(api.mock.calls.map(([path]) => path)).toEqual(["visit", "state"]);
    expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
    expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "重新开始" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("link", { name: "导出存档" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出存档" })).toBeNull();
    expect(screen.getByText(/当前存档无法正常导出/)).toBeTruthy();
    await advance();
    expect(document.querySelector(".tools-menu")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it.each(["a", "c"])("allows preview with no readable pet and %s cancels without replacement", async cancel => {
    await mount(); await file();
    expect(document.querySelector(".import-preview")?.textContent).toContain("当前存档无法读取");
    expect(document.querySelector(".import-preview")?.textContent).not.toContain("建议先从存档盒导出");
    await advance();
    expect(document.querySelector(".import-preview dl")).toBeTruthy();
    await key(cancel);
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("imports the preview once, uses server state and does not fake evolution or care", async () => {
    await mount(); await file();
    const gate = deferred<Result>();
    api.mockImplementation(async path => { if (path === "import") return gate.promise; return result(); });
    await key("b"); await key("b"); await key("a"); await key("c");
    expect(writes()).toHaveLength(1);
    saved.growth = emptyGrowth("adult"); saved.growth.form = "gentle"; broken = false;
    await act(async () => { gate.resolve(result()); });
    expect(screen.getByRole("heading", { name: "修复伙伴" })).toBeTruthy();
    expect(document.querySelector(".save-recovery,.import-preview,[data-motion='evolve']")).toBeNull();
    await advance();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(writes()).toHaveLength(1);
  });

  it("keeps server-rejected backup local, allows cancel and never claims success", async () => {
    await mount(); await file();
    api.mockImplementation(async path => { if (path === "import") throw new RequestFailure("备份内容无效", "rejected"); throw corrupt(); });
    await key("b");
    expect(document.querySelector(".toast.error")?.textContent).toContain("备份内容无效");
    expect(document.querySelector(".import-preview")).toBeTruthy();
    await key("c");
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(1);
    expect(document.querySelector(".outside-needs,.companion-growth,.collection-pet.is-chosen")).toBeNull();
    expect(screen.queryByRole("heading", { name: "修复伙伴" })).toBeNull(); expect(broken).toBe(true);
  });

  it.each([new RequestFailure("save_corrupt", "unavailable"), new Error("现有存档校验失败")])("does not infer repair permission from error text or ordinary outage: %s", async failure => {
    api.mockRejectedValue(failure); await mount(); await click(/存档盒/);
    expect(document.querySelector(".corrupt-recovery")).toBeNull();
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "重新开始" }) as HTMLButtonElement).disabled).toBe(true);
    await file(); await key("a"); await key("b");
    expect(writes()).toHaveLength(0); expect(document.querySelector(".import-preview")).toBeNull();
  });

  it("revokes repair permission on network loss and ignores late file reading", async () => {
    await mount(); const gate = deferred<string>(); await file("{}", () => gate.promise);
    api.mockRejectedValueOnce(new RequestFailure("offline", "unavailable")); await advance();
    await act(async () => { gate.resolve(JSON.stringify(saved)); });
    expect(document.querySelector(".import-preview,.corrupt-recovery")).toBeNull();
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "重新开始" }) as HTMLButtonElement).disabled).toBe(true);
    await key("b");
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("accepts an externally repaired valid read silently and discards an obsolete preview", async () => {
    await mount(); await file(); broken = false; saved.growth = emptyGrowth("adult");
    await advance();
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".save-recovery,.import-preview,[data-motion='evolve']")).toBeNull();
    expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    expect(writes()).toHaveLength(0);
  });

  it("accepts the lower revision of an explicit external repair after a previously healthy save", async () => {
    broken = false; saved.revision = 100; await mount();
    broken = true; await advance();
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    broken = false; saved.revision = 1; saved.name = "另一页修复的伙伴"; saved.growth = emptyGrowth("adult");
    await key("b");
    expect(screen.getByRole("heading", { name: "另一页修复的伙伴" })).toBeTruthy();
    expect(document.querySelector(".save-recovery,[data-motion='evolve']")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("also diagnoses corruption from the automatic return-summary claim", async () => {
    broken = false;
    const snapshot = { needs: saved.needs, stage: "baby" as const, form: "" as const, points: 1, rest: 0, trackedHours: 0 };
    api.mockImplementation(async path => {
      if (path === "recap/read") throw corrupt();
      return { ...result(), recapPending: true, returnRecap: { id: "pending-recap", from: 1, to: Date.now(), before: snapshot, after: snapshot } };
    });
    await mount();
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    expect(api.mock.calls.filter(([path]) => path === "recap/read")).toHaveLength(1);
    await key("a"); await key("c");
    expect(writes()).toHaveLength(0);
  });

  it("enters repair immediately when a formerly valid care request diagnoses corruption", async () => {
    broken = false; await mount(); await key("b"); broken = true; await key("b");
    expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
    expect(writes()).toHaveLength(1);
    expect(document.querySelector(".outside-needs,.companion-growth,.collection-pet.is-chosen")).toBeNull();
    expect(screen.queryByRole("heading", { name: "修复伙伴" })).toBeNull();
    await key("a"); await key("c");
    expect(writes()).toHaveLength(1);
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires separate explicit reset confirmation, cancel is safe and a new egg stays on choose", async () => {
    await mount(); await click(/存档盒/); await click("重新开始");
    expect(document.querySelector(".modal")?.textContent).toContain("新蛋替换无法读取的存档");
    expect(document.querySelector(".modal-export")).toBeNull(); expect(writes()).toHaveLength(0);
    await click("关闭"); expect(writes()).toHaveLength(0);
    await click(/存档盒/); await click("重新开始"); await click("确认重新开始");
    expect(document.querySelector(".modal,.save-recovery")).toBeNull();
    expect(document.querySelector(".content-choose")).toBeTruthy();
    await advance(); expect(document.querySelector(".content-choose")).toBeTruthy();
    expect(writes()).toHaveLength(1);
  });

  it.each([true, false])("unknown import outcome cannot be bypassed or automatically resent (committed=%s)", async committed => {
    await mount(); await file();
    api.mockImplementation(async path => {
      if (path === "import") { broken = !committed; throw new RequestFailure("lost response", "unknown"); }
      if (broken) throw corrupt();
      return result();
    });
    await key("b");
    expect(document.querySelector(".save-recovery")?.textContent).toContain("可能已经保存");
    await click(/存档盒/);
    expect((screen.getByRole("button", { name: "导入备份" }) as HTMLButtonElement).disabled).toBe(true);
    await file(); expect(document.querySelector(".import-preview")).toBeNull();
    await key("b");
    expect(api.mock.calls.at(-1)?.[0]).toBe("state");
    if (committed) expect(document.querySelector(".content-home")).toBeTruthy();
    else {
      expect(document.querySelector(".corrupt-recovery")).toBeTruthy();
      await key("b"); await key("a"); await key("c");
    }
    expect(writes()).toHaveLength(1);
    expect(document.querySelector(".import-preview")).toBeNull();
  });

  it("ignores a stale diagnosis after confirmed import", async () => {
    await mount(); await file(); const gate = deferred<Result>();
    api.mockImplementation(async (path, body) => {
      if (path === "state") return gate.promise;
      if (path === "import") { saved = { ...body as PetState, revision: 3 }; broken = false; }
      return result();
    });
    await advance(); await key("b");
    await act(async () => { gate.reject(corrupt()); });
    expect(document.querySelector(".content-home")).toBeTruthy();
    expect(document.querySelector(".save-recovery,.import-preview")).toBeNull();
    expect(writes()).toHaveLength(1);
  });
});
