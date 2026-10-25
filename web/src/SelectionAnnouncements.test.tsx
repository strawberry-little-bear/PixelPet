import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { AlbumDirectory, AlbumPanel } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import { gameKeepsakes } from "./game-keepsakes";
import { KeepsakeCorner } from "./KeepsakeCorner";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.UTC(2026, 9, 25, 3);
let saved: PetState;
const status = (scope: string) => document.querySelector<HTMLElement>(`[data-selection-status="${scope}"]`)!;
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function sync() { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
 Object.defineProperty(document, "hidden", { configurable: true, value: false });
 saved = { schema: 22, revision: 1, species: 2, name: "听着慢慢选", createdAt: at - 7200000, hatchedAt: at - 7200000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
  growth: emptyGrowth("baby"), album: { since: at - 7200000, legacy: false, entries: gameKeepsakes.map(k => ({ kind: "keepsake", item: k.item, at: at - 1000, source: "shared" })) } };
 api.mockReset(); api.mockImplementation(async (): Promise<Result> => ({ state: structuredClone(saved), serverTime: Date.now(), message: "" }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("announces every care menu choice even within the first unchanged six-item window", async () => {
 await act(async () => { render(<App />); }); await key("a");
 const node = status("care-menu"), before = document.querySelector(".care-menu-pagination")!.textContent;
 expect(node?.textContent).toContain("第 1 / 13 项，吃点东西");
 const button = document.querySelector<HTMLButtonElement>(".button-a")!; button.focus();
 for(const [index, label] of ["一起玩耍", "洗个澡澡", "睡个好觉", "看看状态", "成长日记"].entries()) {
  await key("a"); expect(status("care-menu")).toBe(node);
  expect(node.textContent).toContain(`第 ${index + 2} / 13 项，${label}`);
  expect(document.querySelector(".care-menu-pagination")!.textContent).toBe(before);
  expect(document.activeElement).toBe(button);
 }
 expect(document.querySelectorAll(".care-menu-reading [aria-live],.care-menu-reading [role=status]")).toHaveLength(1);
 expect(node.getAttribute("role")).toBe("status"); expect(node.getAttribute("aria-live")).toBe("polite"); expect(node.getAttribute("aria-atomic")).toBe("true");
 expect(node.tabIndex).toBe(-1);
 expect(api.mock.calls.filter(([p]) => !["state", "visit"].includes(p))).toHaveLength(0);
});
it("keeps menu announcements unchanged on ordinary reads and updates the wake-up choice on real sleep changes", async () => {
 await act(async () => { render(<App />); }); await key("a"); for(let i=0;i<3;i++) await key("a");
 const node = status("care-menu"), before = node?.textContent;
 expect(before).toContain("睡个好觉"); saved.lastTick += 1000; saved.needs.energy -= .1;
 await sync(); expect(status("care-menu")).toBe(node); expect(node.textContent).toBe(before);
 saved.sleeping = true; await sync(); expect(node.textContent).toContain("起床啦"); expect(node.textContent).not.toContain("做一个软绵绵的梦");
});
it("announces directory destinations including the keepsake corner with their actual position", () => {
 const { rerender } = render(<AlbumDirectory pet={saved} choice={0} />); const node = status("album-directory");
 expect(node?.textContent).toContain("第 1 / 8 项，全部回忆");
 rerender(<AlbumDirectory pet={saved} choice={7} />); expect(status("album-directory")).toBe(node);
 expect(node.textContent).toContain("第 8 / 8 项，小窝纪念角"); expect(node.textContent).toContain("B 进入");
 saved.schema = 21; rerender(<AlbumDirectory pet={saved} choice={7} />);
 expect(node.textContent).toContain("第 1 / 7 项，全部回忆");
 expect(document.querySelectorAll(".album-directory [role=status]")).toHaveLength(1);
});
it("announces the album title and page without rereading its story or elapsed time", () => {
 saved.album!.entries.forEach((memory, index) => { memory.at = at - 1000 + index; });
 const { rerender } = render(<AlbumPanel pet={saved} now={at} page={1} category="play" />);
 const node = status("album-page"); expect(node?.textContent).toContain("第 2 / 8 页"); expect(node?.textContent).toContain("接星星的小缎带");
 expect(node.textContent).not.toContain(gameKeepsakes[0].story);
 rerender(<AlbumPanel pet={saved} now={at + 15000} page={2} category="play" />);
 expect(status("album-page")).toBe(node); expect(node.textContent).toContain("连连看的小篮子");
 rerender(<AlbumPanel pet={saved} now={at + 30000} page={0} category="play" missing />);
 expect(node.textContent).toContain("同步时未找到刚才那条回忆"); expect(node.textContent).toContain("封面");
 expect(document.querySelectorAll(".album-panel [role=status]")).toHaveLength(1);
});
it("distinguishes two previews with the same action prompt and announces only the confirmed display", () => {
 const { rerender } = render(<KeepsakeCorner pet={saved} choice="star-ribbon" />); const node = status("keepsake-corner");
 expect(node?.textContent).toContain("第 2 / 8 项，接星星的小缎带"); expect(node.textContent).toContain("现在摆着：暂时留空");
 const action = document.querySelector(".corner-action")!.textContent;
 rerender(<KeepsakeCorner pet={saved} choice="tile-basket" />);
 expect(status("keepsake-corner")).toBe(node); expect(node.textContent).toContain("第 3 / 8 项，连连看的小篮子");
 expect(document.querySelector(".corner-action")!.textContent).toBe(action);
 expect(node.textContent).toContain("现在摆着：暂时留空");
 saved.album!.displayItem = "tile-basket";
 rerender(<KeepsakeCorner pet={saved} choice="tile-basket" />);
 expect(node.textContent).toContain("现在摆着：连连看的小篮子"); expect(node.textContent).toContain("已经是这个布置");
 expect(document.querySelectorAll(".keepsake-corner [aria-live],.keepsake-corner [role=status]")).toHaveLength(1);
 expect(document.querySelectorAll("button,a,input,[tabindex]")).toHaveLength(0);
});
it("announces selected album memories through physical keys, preserves their identity on sync, and never writes", async () => {
 await act(async () => { render(<App />); }); await key("a"); for(let i=0;i<8;i++) await key("a"); await key("b");
 for(let i=0;i<3;i++) await key("a"); await key("b"); await key("b");
 const node = status("album-page"), before = node?.textContent;
 expect(before).toContain("一起玩过"); expect(before).toContain("小方块"); // equal timestamps sort by saved identity
 saved.album!.entries.reverse(); saved.lastTick += 1000; await sync();
 expect(status("album-page")).toBe(node); expect(node.textContent).toBe(before);
 await key("b"); expect(node.textContent).not.toBe(before); await key("a"); expect(node.textContent).toBe(before);
 expect(api.mock.calls.filter(([p]) => !["state", "visit"].includes(p))).toHaveLength(0);
 expect(document.querySelectorAll(".lcd button,.lcd a,.lcd input,.lcd [role=button]")).toHaveLength(0);
});

it.each([
 [0, "吃点东西"], [1, "一起玩耍"], [2, "洗个澡澡"],
] as const)("explains the sleeping restriction before confirming menu choice %s / %s", async (index, label) => {
 saved.sleeping = true;
 await act(async () => { render(<App />); }); await key("a");
 for (let i = 0; i < index; i++) await key("a");
 const node = status("care-menu");
 expect(node.textContent).toContain(label);
 expect(node.textContent).toContain("最近读取：先叫醒它");
 expect(node.textContent).not.toContain("B 确认");
 expect(document.querySelector(".lcd-bottom")?.textContent).toContain("最近读取：先叫醒它");
 expect(document.querySelector(".care-preview")?.textContent).toContain("起床啦");
 expect(document.querySelectorAll(".care-menu-reading [role=status]")).toHaveLength(1);
 const before = node.textContent;
 saved.lastTick += 1000; saved.needs.energy += .1; await sync();
 expect(node.textContent).toBe(before);
 saved.sleeping = false; await sync();
 expect(status("care-menu")).toBe(node); expect(node.textContent).toContain("B 确认");
 expect(document.querySelector(".care-preview")?.textContent).not.toContain("起床啦");
 expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
});
it.each([
 [0, "hunger", 96, "暂不能喂食"], [2, "clean", 99, "暂不用洗澡"],
] as const)("updates the %s confirmation only when snapshot availability changes", async (index, need, full, restriction) => {
 saved.needs[need] = full;
 await act(async () => { render(<App />); }); await key("a");
 for (let i = 0; i < index; i++) await key("a");
 const node = status("care-menu"), button = document.querySelector<HTMLButtonElement>(".button-b")!;
 button.focus();
 expect(node.textContent).toContain(`最近读取：${restriction}`);
 expect(button.disabled).toBe(false);
 const before = node.textContent;
 saved.lastTick += 1000; saved.needs[need] += .1;
 await sync(); expect(node.textContent).toBe(before);
 saved.needs[need] = full - .1; await sync();
 expect(status("care-menu")).toBe(node);
 expect(node.textContent).toContain("B 确认"); expect(node.textContent).not.toContain(restriction);
 expect(document.activeElement).toBe(button);
 expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
});
it("keeps B available for server confirmation when the last reading still shows full food", async () => {
 saved.needs.hunger = 96;
 await act(async () => { render(<App />); }); await key("a");
 expect(status("care-menu").textContent).toContain("最近读取：暂不能喂食");
 await key("b");
 const actions = api.mock.calls.filter(([path]) => path === "action");
 expect(actions).toHaveLength(1); expect(actions[0][1]).toMatchObject({ kind: "feed" });
});
