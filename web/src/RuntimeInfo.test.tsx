import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeInfo, runtimeReport } from "./RuntimeInfo";
import type { SyncHealth } from "./RuntimeInfo";
const revision = "a".repeat(40);
const report = { schema: 23, build: { revision, modified: true } };
const fetcher = vi.fn<typeof fetch>();
async function open() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "运行信息 · 查看" })); }); }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); fetcher.mockResolvedValue(new Response(JSON.stringify(report))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("read-only runtime information", () => {
 it("does not request metadata until opened, and never treats it as a save sync", async () => {
  const { rerender } = render(<RuntimeInfo health="unavailable" syncedAt={null}/>);
  expect(fetcher).not.toHaveBeenCalled(); await open();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/runtime");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  expect(screen.getByText("暂时连接不上")).toBeTruthy();
  expect(screen.getByText("本页还没有成功同步")).toBeTruthy();
  expect(screen.getByText("schema 23")).toBeTruthy();
  expect(screen.getByTitle(revision).textContent).toBe("a".repeat(12));
  expect(screen.getByText(/构建时含未提交改动/)).toBeTruthy();
  expect(document.querySelector(".runtime-info code")?.textContent).toBe(window.location.origin);
  const time = Date.UTC(2026, 9, 25, 4, 5, 6);
  rerender(<RuntimeInfo health="ready" syncedAt={time}/>);
  expect(document.querySelector("time")?.dateTime).toBe(new Date(time).toISOString());
  rerender(<RuntimeInfo health="uncertain" syncedAt={time}/>);
  expect(screen.getByText("保存结果待核对")).toBeTruthy();
  expect(document.querySelector("time")?.dateTime).toBe(new Date(time).toISOString());
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([
  ["connecting", "尚未读到存档"], ["ready", "最近同步正常"], ["unavailable", "暂时连接不上"],
  ["uncertain", "保存结果待核对"], ["corrupt", "存档需要修复"], ["clock-ahead", "服务时间待校准"],
 ] as [SyncHealth,string][])("explains %s independently from binary version", async (health,text) => {
  render(<RuntimeInfo health={health} syncedAt={null}/>); await open();
  expect(screen.getByText(text)).toBeTruthy();
  if (["uncertain","unavailable","clock-ahead"].includes(health)) expect(screen.getByText(/先按 C 收起存档盒/)).toBeTruthy();
 });
 it.each([404, 503, "offline", "html", "invalid"])("keeps save state intact when runtime metadata fails: %s", async failure => {
  if (typeof failure === "number") fetcher.mockResolvedValue(new Response("unavailable",{status:failure}));
  else if (failure === "offline") fetcher.mockRejectedValue(new TypeError("network failure"));
  else fetcher.mockResolvedValue(new Response(failure === "html" ? "<html>old backend</html>" : "{}"));
  render(<RuntimeInfo health="ready" syncedAt={Date.now()}/>); await open();
  expect(screen.getByText("最近同步正常")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("不改变上方同步结果");
  expect(document.querySelector("time")).toBeTruthy();
  expect(screen.queryByText("支持的存档格式")).toBeNull();
 });
 it("aborts on collapse, discards late responses and starts a fresh explicit read", async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<RuntimeInfo health="ready" syncedAt={null}/>); await open();
  const signal = fetcher.mock.calls[0][1]!.signal!;
  fireEvent.click(screen.getByRole("button",{name:"运行信息 · 收起"}));
  expect(signal.aborted).toBe(true);
  await open(); expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { finish(new Response(JSON.stringify({schema:999,build:{}}))); });
  expect(screen.getByText("schema 23")).toBeTruthy(); expect(screen.queryByText("schema 999")).toBeNull();
 });
 it("bounds a stalled read and aborts an in-flight read on unmount", async () => {
  fetcher.mockImplementation(() => new Promise(() => {}));
  const view=render(<RuntimeInfo health="corrupt" syncedAt={null}/>); await open();
  const signal=fetcher.mock.calls[0][1]!.signal!;
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(signal.aborted).toBe(true); expect(screen.getByText(/读取运行版本超时/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button",{name:"重新读取运行版本"})); });
  const next=fetcher.mock.calls[1][1]!.signal!; view.unmount(); expect(next.aborted).toBe(true);
 });
 it("represents an unstamped binary without inventing a revision or a clean build", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({schema:23,build:{}})));
  render(<RuntimeInfo health="ready" syncedAt={null}/>); await open();
  expect(within(screen.getByRole("region",{name:"运行信息"})).getAllByText("未记录提交标识")).toHaveLength(2);
  expect(screen.queryByText(/构建时工作区干净/)).toBeNull();
 });
});
describe("runtime metadata validation", () => {
 it.each([null, [], {}, {schema:0,build:{}}, {schema:1.5,build:{}}, {schema:23,build:[]},
  {schema:23,build:{revision:"bad"}}, {schema:23,build:{modified:"false"}}])("rejects malformed metadata %j", value => {
  expect(()=>runtimeReport(value)).toThrow();
 });
});
