import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryPoints, recoveryPoints } from "./RecoveryPoints";
const point = { id: "9007199254740993", createdAt: 1700000000000, status: "available", pet: { name: "小草莓", species: 2, stage: "baby", lastTick: 1699999999000 } };
const backup = JSON.stringify({ schema: 1, revision: 0, name: "小草莓", species: 2, hatchedAt: 1000, lastTick: 2000 });
const network = vi.fn();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.stubGlobal("fetch", network); network.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("read-only recovery point tools", () => {
 it("fetches only on explicit expand and requests the exact ID without rounding", async () => {
  const preview = vi.fn(); network.mockResolvedValueOnce(response({ snapshots: [point] })).mockResolvedValueOnce(new Response(backup, { headers: { "Content-Type": "application/json" } }));
  render(<RecoveryPoints enabled onPreview={preview} />); expect(network).not.toHaveBeenCalled();
  await click("自动恢复点 · 查看"); expect(screen.getByText(/小草莓 · 草莓兔/)).toBeTruthy();
  await click(`预览恢复点 #${point.id}：小草莓`);
  expect(network.mock.calls.map(([path]) => path)).toEqual(["/api/snapshots", `/api/snapshots/${point.id}`]);
  expect(network.mock.calls.every(([, options]) => options.cache === "no-store" && !options.method)).toBe(true);
  expect(preview).toHaveBeenCalledExactlyOnceWith(backup, { id: point.id, createdAt: point.createdAt });
 });
 it("explains empty lists and unavailable points without offering restore", async () => {
  network.mockResolvedValueOnce(response({ snapshots: [] })).mockResolvedValueOnce(response({ snapshots: ["unreadable", "clock-ahead", "too-large"].map((status, i) => ({ id: String(i+1), createdAt: point.createdAt, status })) }));
  render(<RecoveryPoints enabled onPreview={vi.fn()} />); await click("自动恢复点 · 查看");
  expect(screen.getByText(/还没有自动恢复点/)).toBeTruthy(); await click("重新读取恢复点");
  expect(screen.getByText(/未通过当前校验/)).toBeTruthy(); expect(screen.getByText(/先校准服务时钟/)).toBeTruthy(); expect(screen.getByText(/内容超过 64 KiB/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /预览恢复点/ })).toBeNull();
 });
 it.each(["close", "disable", "unmount"])('ignores a late list response after %s', async mode => {
  const gate = deferred<Response>(); network.mockReturnValue(gate.promise);
  const view = render(<RecoveryPoints enabled onPreview={vi.fn()} />); await click("自动恢复点 · 查看");
  const signal = network.mock.calls[0][1].signal;
  if (mode === "close") await click("自动恢复点 · 收起");
  if (mode === "disable") view.rerender(<RecoveryPoints enabled={false} onPreview={vi.fn()} />);
  if (mode === "unmount") view.unmount();
  await act(async () => { gate.resolve(response({ snapshots: [point] })); });
  expect(signal.aborted).toBe(true); expect(screen.queryByRole("button", { name: /预览恢复点/ })).toBeNull();
 });
 it("ignores late snapshot bytes after closing while preview is loading", async () => {
  const gate = deferred<Response>(), preview = vi.fn(); network.mockResolvedValueOnce(response({ snapshots: [point] })).mockReturnValueOnce(gate.promise);
  render(<RecoveryPoints enabled onPreview={preview} />); await click("自动恢复点 · 查看"); await click(`预览恢复点 #${point.id}：小草莓`); await click("自动恢复点 · 收起");
  await act(async () => { gate.resolve(new Response(backup, { headers: { "Content-Type": "application/json" } })); }); expect(preview).not.toHaveBeenCalled();
 });
 it("times out without automatic retries and allows a new explicit request", async () => {
  vi.useFakeTimers(); const old = deferred<Response>(); network.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ snapshots: [] }));
  render(<RecoveryPoints enabled onPreview={vi.fn()} />); await click("自动恢复点 · 查看");
  await act(async () => { vi.advanceTimersByTime(10000); }); expect(screen.getByRole("alert").textContent).toContain("超时"); expect(network).toHaveBeenCalledTimes(1);
  await click("重新读取恢复点"); await act(async () => { old.resolve(response({ snapshots: [point] })); });
  expect(screen.getByText(/还没有自动恢复点/)).toBeTruthy(); expect(screen.queryByRole("button", { name: /预览恢复点/ })).toBeNull();
 });
 it.each([
  () => response({ error: "恢复点已不存在" }, 404),
  () => new Response("<html>proxy</html>", { headers: { "Content-Type": "text/html" } }),
  () => new Response(" ".repeat(65537), { headers: { "Content-Type": "application/json" } }),
  () => response({ invalid: true }),
 ])("never previews failed or invalid selected bytes %#", async failure => {
  const preview = vi.fn(); network.mockResolvedValueOnce(response({ snapshots: [point] })).mockResolvedValueOnce(failure());
  render(<RecoveryPoints enabled onPreview={preview} />); await click("自动恢复点 · 查看"); await click(`预览恢复点 #${point.id}：小草莓`);
  expect(screen.getByRole("alert")).toBeTruthy(); expect(preview).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(2);
 });
 it("renders a disabled tool without making requests", () => { render(<RecoveryPoints enabled={false} onPreview={vi.fn()} />); expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true); expect(network).not.toHaveBeenCalled(); });
});
describe("recovery list validation", () => {
 it("keeps legacy stage unknown and IDs exact", () => { expect(recoveryPoints({ snapshots: [{ ...point, pet: { ...point.pet, stage: "unknown" } }] })[0].id).toBe(point.id); });
 it.each([null, {}, { snapshots: null }, { snapshots: Array(11).fill(point) }, { snapshots: [point, point] }, ...[
  { id: 1 }, { id: "01" }, { id: "-1" }, { createdAt: Infinity }, { status: "future" }, { pet: {} }, { pet: { ...point.pet, stage: "constructor" } }, { pet: { ...point.pet, lastTick: -1 } },
 ].map(overrides => ({ snapshots: [{ ...point, ...overrides }] }))])("rejects malformed envelopes %#", value => expect(() => recoveryPoints(value)).toThrow());
});
