import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StatusReading } from "./StatusReading";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([undefined, null, false, true, "1792450000000", {}, [], 0, -1, NaN, Infinity, -Infinity, 1.5, 8.64e15 + 1, Number.MAX_SAFE_INTEGER])("does not invent a time for invalid input %#", at => {
  const { container } = render(<StatusReading at={at as number} />);
  expect(container.querySelector("time")).toBeNull();
  expect(container.textContent).toBe("状态记录时间尚未读到，不按本机时间补写。");
  expect(container.textContent).not.toMatch(/Invalid|NaN|1970/);
});
it.each([1, 1767225599000, 1792450000123, 8.64e15])("uses a valid saved millisecond timestamp, including date-range edges %#", at => {
  const { container } = render(<StatusReading at={at} />);
  const time = container.querySelector("time")!;
  expect(time.dateTime).toBe(new Date(at).toISOString());
  expect(time.textContent).toBe(new Date(at).toLocaleString("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }));
  expect(container.querySelector("button,a,input,[tabindex],[aria-live],[role=button]")).toBeNull();
});
it("is pure display even when the browser clock moves", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
  const at = 1792450000123;
  const view = render(<StatusReading at={at} />), before = view.container.innerHTML;
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  view.rerender(<StatusReading at={at} />);
  expect(view.container.innerHTML).toBe(before);
  expect(vi.getTimerCount()).toBe(0);
});
