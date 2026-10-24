import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { request } from "./api";
import { albumDestinations } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import { gameKeepsakes } from "./game-keepsakes";
import { HomeKeepsake, KeepsakeCorner, ownedKeepsakes, keepsakeOptions } from "./KeepsakeCorner";
import { validCoreResponse } from "./response";
import type { PetState, Result } from "./types";
vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request), at = Date.UTC(2026, 9, 25, 2);
const pet = (): PetState => ({ schema: 22, revision: 1, species: 2, name: "小窝伙伴", createdAt: at - 7200000,
  hatchedAt: at - 7200000, lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 },
  careCount: 0, logs: [], growth: emptyGrowth("baby"), album: { since: at - 7200000, legacy: false,
    entries: gameKeepsakes.map(k => ({ kind: "keepsake", item: k.item, at: at - 1000, source: "shared" })) } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(gameKeepsakes)("previews and displays the owned $item with its original date", item => {
  const saved = pet(); saved.album!.displayItem = item.item; const before = structuredClone(saved);
  render(<><KeepsakeCorner pet={saved} choice={item.item} /><HomeKeepsake pet={saved} /></>);
  expect(document.querySelector(".corner-date time")?.getAttribute("datetime")).toBe(new Date(at - 1000).toISOString());
  expect(document.querySelector(".corner-action")?.textContent).toContain("已经是这个布置");
  expect(document.querySelector(".home-keepsake")?.textContent).toContain(item.title);
  expect(document.querySelectorAll(`[data-keepsake-art="${item.item}"]`)).toHaveLength(2);
  expect(document.querySelectorAll("button,input,a,[role=button]")).toHaveLength(0);
  expect(saved).toEqual(before);
});
it.each(["old", "future", "invalid date", "unknown", "saved source", "no album", "unowned"])("hides an invalid display: %s", condition => {
  const saved = pet(); saved.album!.displayItem = "star-ribbon"; saved.album!.entries = [saved.album!.entries[0]];
  if (condition === "old") saved.schema = 21;
  if (condition === "future") saved.album!.entries[0].at = at + 1;
  if (condition === "invalid date") saved.album!.entries[0].at = NaN;
  if (condition === "unknown") saved.album!.displayItem = "future-item";
  if (condition === "saved source") saved.album!.entries[0].source = "saved";
  if (condition === "no album") delete saved.album;
  if (condition === "unowned") saved.album!.entries = [];
  render(<HomeKeepsake pet={saved} />); expect(document.querySelector(".home-keepsake")).toBeNull();
});
it("offers only unique owned records, a clear empty option, and no progress pressure", () => {
  const saved = pet(); saved.album!.entries.push(saved.album!.entries[0]);
  expect(keepsakeOptions(saved)).toHaveLength(8); saved.album!.entries = [];
  render(<KeepsakeCorner pet={saved} choice="star-ribbon" />);
  expect(document.querySelector(".keepsake-corner")?.textContent).toContain("以后一起玩时");
  expect(document.querySelector(".keepsake-corner")?.getAttribute("data-corner-choice")).toBe("");
  expect(ownedKeepsakes(saved)).toEqual([]); expect(keepsakeOptions(saved)).toEqual([""]);
  saved.schema = 21; expect(albumDestinations(saved).some(d => d.id === "keepsakes")).toBe(false);
});
it.each([undefined, "", "star-ribbon", "future-item", 5, null, {}])("guards optional display response shape %j", displayItem => {
  const state = pet(); Object.assign(state.album!, { displayItem });
  expect(validCoreResponse({ state, serverTime: at, message: "" })).toBe(displayItem === undefined || typeof displayItem === "string");
});
it("uses A/B/C to place, sync, return home and put away without writing during browsing", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const saved = pet(); api.mockReset();
  api.mockImplementation(async (path, body): Promise<Result> => {
    if (path === "action") { const a = body as { kind: string; item: string }; expect(a.kind).toBe("display-keepsake"); saved.album!.displayItem = a.item; saved.revision++; }
    return { state: structuredClone(saved), serverTime: at, message: "" };
  });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  const open = async () => { await key("a"); for (let i=0;i<8;i++) await key("a"); await key("b"); for(let i=0;i<7;i++) await key("a"); await key("b"); };
  await act(async () => { render(<App />); }); await open();
  expect(document.querySelector(".keepsake-corner")).not.toBeNull();
  expect(api.mock.calls.filter(([p]) => p === "action")).toHaveLength(0);
  await key("a"); await key("b"); expect(saved.album!.displayItem).toBe("star-ribbon");
  await key("b"); expect(api.mock.calls.filter(([p]) => p === "action")).toHaveLength(1);
  saved.album!.entries.reverse(); saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".keepsake-corner")?.getAttribute("data-corner-choice")).toBe("star-ribbon");
  await key("c"); expect(document.querySelector(".album-directory")?.getAttribute("data-album-directory")).toBe("keepsakes");
  await key("c"); expect(document.querySelector(".home-keepsake")?.textContent).toContain("接星星的小缎带");
  // Another page updates the display; the home reflects the authoritative snapshot.
  saved.album!.displayItem = "pond-shell"; saved.revision++;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(document.querySelector(".home-keepsake")?.textContent).toContain("池塘边的小贝壳");
  await open(); for(let i=0;i<3;i++) await key("a"); // pond-shell -> path-button -> forest-token -> empty
  expect(document.querySelector(".keepsake-corner")?.getAttribute("data-corner-choice")).toBe("");
  await key("b"); expect(saved.album!.displayItem).toBe("");
  await key("c"); await key("c"); expect(document.querySelector(".home-keepsake")).toBeNull();
  expect(api.mock.calls.filter(([p]) => p === "action")).toHaveLength(2);
  expect(document.querySelectorAll(".lcd button,.lcd input,.lcd a,.lcd [role=button]")).toHaveLength(0);
});
