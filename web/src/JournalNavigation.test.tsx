import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { PetState, Result } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
let saved: PetState, generation: string;
const result = (): Result => ({ state: structuredClone(saved), saveGeneration: generation, message: "", serverTime: Date.now() });
const diary = () => document.querySelector(".screen-journal")!;
const entry = (text: string, offset = 0) => ({ at: Date.now() - 60000 - offset * 1000, text });
const writes = () => api.mock.calls.filter(([path]) => ["action", "reset", "import", "recap/read"].includes(path));
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function mount() { await act(async () => { render(<App />); }); }
async function open() { await key("a"); for (let i = 0; i < 5; i++) await key("a"); await key("b"); }
async function refresh() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.mockReset(); generation = "a".repeat(32);
  saved = { schema: 11, revision: 1, species: 2, name: "日记伙伴", createdAt: Date.now() - 3600000,
    hatchedAt: Date.now() - 3500000, lastTick: Date.now(), sleeping: false, growth: emptyGrowth(),
    needs: { hunger: 60, mood: 80, clean: 60, energy: 80 }, careCount: 0,
    logs: [entry("一份饭团"), entry("一次泡泡澡", 1), entry("刚刚相遇", 2)] };
  api.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("reading recent care history without being displaced by sync", () => {
  it("has an honest empty state without an invented timestamp or 1 / 0", async () => {
    saved.logs = []; await mount(); await open();
    expect(diary().textContent).toContain("还没有日记");
    expect(diary().textContent).not.toContain("1 / 0");
    expect(diary().querySelector("time")).toBeNull();
    await key("a"); expect(diary().textContent).toContain("还没有日记");
    await key("c"); expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it.each([null, undefined])("accepts a nullish old response history (%s) without crashing", async logs => {
    saved.logs = logs as unknown as PetState["logs"]; await mount(); await open();
    expect(diary().textContent).toContain("还没有日记"); await key("a"); await key("b");
    expect(diary().textContent).toContain("还没有日记"); await key("c");
    expect(document.querySelector(".content-home")).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it("keeps the selected care entry when one or more new logs arrive", async () => {
    await mount(); await open(); await key("a"); expect(diary().textContent).toContain("一次泡泡澡");
    saved.logs = [entry("成长了", -2), entry("又睡了一觉", -1), ...saved.logs]; await refresh();
    expect(diary().querySelector("p")?.textContent).toBe("一次泡泡澡"); expect(diary().textContent).toContain("4 / 5");
    await key("a"); expect(diary().querySelector("p")?.textContent).toBe("刚刚相遇");
    await key("a"); expect(diary().querySelector("p")?.textContent).toBe("成长了");
    expect(writes()).toHaveLength(0);
  });
  it("keeps the newest entry still while reading rather than automatically following new logs", async () => {
    await mount(); await open(); saved.logs.unshift(entry("新的饭团", -1)); await refresh();
    expect(diary().querySelector("p")?.textContent).toBe("一份饭团"); expect(diary().textContent).toContain("2 / 4");
  });
  it("makes recent-history eviction explicit and selects a retained entry, never an invisible old record", async () => {
    saved.logs = Array.from({ length: 30 }, (_, i) => entry(`记录 ${i}`, i)); await mount(); await open();
    for (let i = 0; i < 29; i++) await key("a");
    saved.logs = [entry("新纪录", -1), ...saved.logs.slice(0, 29)]; await refresh();
    expect(diary().querySelector("p")?.textContent).toBe("记录 28");
    expect(diary().textContent).toContain("刚才那条已不在最近日记中"); expect(diary().textContent).toContain("30 / 30");
    expect(diary().textContent).not.toContain("记录 29");
    await key("a"); expect(diary().querySelector("p")?.textContent).toBe("新纪录");
    expect(diary().textContent).not.toContain("刚才那条"); expect(writes()).toHaveLength(0);
  });
  it("uses the saved event date, and distinguishes recent diary from permanent memories", async () => {
    await mount(); await open();
    expect(diary().querySelector("time")?.getAttribute("dateTime")).toBe(new Date(saved.logs[0].at).toISOString());
    expect(diary().textContent).toContain("最近 30 条"); expect(diary().textContent).toContain("并非逐条备份");
    expect(diary().querySelector("button,a,input")).toBeNull(); expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  });
  it("C returns home, and re-entry starts at the current newest record", async () => {
    await mount(); await open(); await key("a"); await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
    saved.logs.unshift(entry("这次的新日记", -1)); await refresh(); await open();
    expect(diary().querySelector("p")?.textContent).toBe("这次的新日记"); expect(diary().textContent).toContain("1 / 4");
  });
  it("replaces the diary on an authoritative same-pet import, not an old reading anchor", async () => {
    await mount(); await open(); await key("a"); generation = "b".repeat(32); saved.revision = 0; saved.logs = [entry("备份里的旧记录", 3)];
    await refresh(); expect(document.querySelector(".content-home")).toBeTruthy(); await open();
    expect(diary().querySelector("p")?.textContent).toBe("备份里的旧记录"); expect(diary().textContent).not.toContain("一次泡泡澡");
  });
  it("accepts the first actual log after an empty diary without inventing one beforehand", async () => {
    saved.logs = []; await mount(); await open(); saved.logs = [entry("之后真实记下的一顿饭")]; await refresh();
    expect(diary().querySelector("p")?.textContent).toBe("之后真实记下的一顿饭"); expect(diary().textContent).toContain("1 / 1");
    expect(diary().textContent).not.toContain("刚才那条"); expect(writes()).toHaveLength(0);
  });
});

it("uses A for older, B for newer, and C alone to return, without writing history", async () => {
  await mount(); await open(); const before = structuredClone(saved);
  expect(document.body.textContent).toContain("A 较早");
  expect(document.body.textContent).toContain("B 较新");
  expect(diary().textContent).toContain("首尾循环");
  await key("a"); expect(diary().querySelector("p")?.textContent).toBe("一次泡泡澡");
  await key("b"); expect(diary().querySelector("p")?.textContent).toBe("一份饭团");
  await key("b"); expect(diary().querySelector("p")?.textContent).toBe("刚刚相遇");
  await key("a"); expect(diary().querySelector("p")?.textContent).toBe("一份饭团");
  await key("c"); expect(document.querySelector(".content-home")).toBeTruthy();
  expect(writes()).toHaveLength(0); expect(saved).toEqual(before);
});

it("reverse browsing follows the same retained anchor through sync and eviction", async () => {
  await mount(); await open(); await key("a");
  saved.logs.unshift(entry("新的照顾", -1)); await refresh();
  await key("b"); expect(diary().querySelector("p")?.textContent).toBe("一份饭团");
  saved.logs = [saved.logs[0], saved.logs[3]]; await refresh();
  expect(diary().textContent).toContain("刚才那条已不在最近日记中");
  await key("b"); expect(diary().querySelector("p")?.textContent).toBe("新的照顾");
  expect(diary().textContent).not.toContain("刚才那条"); expect(writes()).toHaveLength(0);
});
