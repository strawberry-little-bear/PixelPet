import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), network = vi.fn();
let saved: PetState, generation: string, backup: PetState;
const result = (): Result => ({ state: structuredClone(saved), serverTime: Date.now(), saveGeneration: generation, message: "" });
const imports = () => api.mock.calls.filter(([path]) => path === "import");
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }
async function preview() {
 await act(async () => { render(<App />); });
 await click("存档盒"); await click("自动恢复点 · 查看"); await click("预览恢复点 #3：恢复伙伴");
}
beforeEach(() => {
 vi.useFakeTimers(); localStorage.clear(); api.mockReset(); network.mockReset(); vi.stubGlobal("fetch", network); generation = "a".repeat(32);
 saved = { schema: 2, revision: 1, species: 2, name: "当前伙伴", createdAt: Date.now()-10000, hatchedAt: Date.now()-9000, lastTick: Date.now(), sleeping: false, needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0, growth: emptyGrowth("baby"), logs: [] };
 backup = { ...structuredClone(saved), name: "恢复伙伴" };
 api.mockImplementation(async (path, body) => { if (path === "import") { saved = { ...body as PetState, revision: saved.revision+1, game: undefined }; generation = "b".repeat(32); } return result(); });
 network.mockImplementation(async (path: string) => new Response(JSON.stringify(path === "/api/snapshots" ? { snapshots: [{ id: "3", createdAt: Date.now(), status: "available", pet: { name: backup.name, species: backup.species, stage: "baby", lastTick: backup.lastTick } }] } : backup), { headers: { "Content-Type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["a", "c"])("preview then %s leaves current pet unchanged and restores safe focus", async cancel => {
 const before = structuredClone(saved); await preview();
 expect(screen.getByText(/自动恢复点 #3/)).toBeTruthy(); expect(screen.getByText(/恢复伙伴 · 草莓兔/)).toBeTruthy(); expect(imports()).toHaveLength(0);
 expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull(); expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
 expect(document.activeElement?.classList.contains("button-c")).toBe(true);
 await key(cancel); expect(saved).toEqual(before); expect(imports()).toHaveLength(0); expect(document.querySelector(".content-home")).toBeTruthy();
});
it("B submits the previewed state once with the accepted generation", async () => {
 await preview(); let resolve!: (v: Result) => void; const gate = new Promise<Result>(r => { resolve = r; });
 api.mockImplementation(async path => path === "import" ? gate : result());
 await key("b"); await key("b"); await key("c");
 expect(imports()).toHaveLength(1); expect(imports()[0][1]).toEqual(backup); expect(imports()[0][2]).toEqual("a".repeat(32));
 saved = { ...backup, revision: 2 }; generation = "b".repeat(32); await act(async () => { resolve(result()); });
 expect(document.querySelector(".import-preview")).toBeNull(); expect(screen.getByRole("heading", { name: "恢复伙伴" })).toBeTruthy();
});
it("discards old restore intent when another page replaces the current save", async () => {
 await preview(); generation = "c".repeat(32); saved = { ...saved, name: "另一个页面", revision: 2 };
 await act(async () => { vi.advanceTimersByTime(15000); });
 expect(document.querySelector(".import-preview")).toBeNull(); await key("b"); expect(imports()).toHaveLength(0);
});
it("cancelling from a paused game leaves it paused and sends no gameplay action", async () => {
 saved.game = { kind: "snake", id: "0123456789abcdef0123456789abcdef", startedAt: Date.now(), round: 0, score: 0, lastBeat: -1, snake: { body: [{ x: 3, y: 3 }, { x: 2, y: 3 }], food: { x: 7, y: 7 }, direction: 1, eaten: 0, step: 0, lastMoveAt: Date.now(), paused: true } };
 const before = structuredClone(saved.game); await preview(); await key("c");
 expect(document.querySelector(".snake-overlay")).toBeTruthy(); await act(async () => { vi.advanceTimersByTime(5000); });
 expect(saved.game).toEqual(before); expect(api.mock.calls.some(([path]) => path === "action")).toBe(false); expect(imports()).toHaveLength(0);
});
