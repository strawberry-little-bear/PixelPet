import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumPanel } from "./AlbumPanel";
import App from "./App";
import { request } from "./api";
import { emptyGrowth } from "./growth";
import type { Memory, PetState, Result, Shop, ShopItem } from "./types";

vi.mock("./api", () => ({ request: vi.fn() }));
const api = vi.mocked(request);
const now = Date.UTC(2026, 9, 21, 4);
const items: ShopItem[] = [
  { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一小片春天" },
  { id: "clover-pot", name: "四叶草盆栽", slot: "room", price: 16, description: "窗边的绿" },
  { id: "meadow-wall", name: "小叶墙纸", slot: "wallpaper", price: 18, description: "一面墙" },
  { id: "honey-floor", name: "蜂蜜木地板", slot: "floor", price: 18, description: "小小木纹" },
];
const kinds = ["outfit", "decoration", "wallpaper", "floor"] as const;
const shop = (): Shop => ({ maxCoins: 1000000, dailyCoins: 10, gameDailyLimit: 30, catalog: structuredClone(items) });
const pet = (kind: Memory["kind"] = "outfit", item: string | undefined = "leaf-pin"): PetState => ({
  schema: 18, revision: 1, species: 2, name: "小窝伙伴", createdAt: now - 3600000, hatchedAt: now - 3600000, lastTick: now,
  sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 1, logs: [], growth: emptyGrowth("baby"),
  economy: { coins: 9, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0, owned: [...items.map(i => i.id), "berry-scarf", "moon-lamp", "starlit-wall", "mint-floor"], equipped: { accessory: "berry-scarf", room: "moon-lamp", wallpaper: "starlit-wall", floor: "mint-floor" } },
  album: { since: now - 3600000, legacy: false, entries: [{ kind, at: now - 1000, source: "shared", item }] },
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("reading the actual saved home memory without relying on its picture", () => {
  it.each(kinds)("names the saved %s item, not the currently equipped one", kind => {
    const item = items[kinds.indexOf(kind)], p = pet(kind, item.id), catalog = shop();
    const before = JSON.stringify({ p, catalog });
    const { container } = render(<AlbumPanel pet={p} shop={catalog} now={now} page={1} category="home" />);
    expect(screen.getByText(`当时选用：${item.name}`)).toBeTruthy();
    expect(container.querySelector(".album-item")?.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
    expect(JSON.stringify({ p, catalog })).toBe(before);
  });
  it.each(["missing catalog", "removed item", "wrong slot", "missing recorded id"])("keeps the memory without guessing a name: %s", scenario => {
    const p = pet(), catalog = shop();
    if (scenario === "removed item") catalog.catalog = catalog.catalog.filter(i => i.id !== "leaf-pin");
    if (scenario === "wrong slot") catalog.catalog[0].slot = "room";
    if (scenario === "missing recorded id") delete p.album!.entries[0].item;
    render(<AlbumPanel pet={p} shop={scenario === "missing catalog" ? undefined : catalog} now={now} page={1} category="home" />);
    expect(screen.getByText("第一次选好小装扮")).toBeTruthy();
    expect(screen.getByText("当时选用：名称暂不可用")).toBeTruthy();
    expect(document.querySelector(".album-item")?.textContent).not.toMatch(/嫩叶|草莓|leaf-pin|berry-scarf/);
  });
  it.each([undefined, null])("keeps old responses with a %j catalog readable", catalog => {
    const rules = shop(); Object.assign(rules, { catalog });
    render(<AlbumPanel pet={pet()} shop={rules} now={now} page={1} category="home" />);
    expect(screen.getByText("当时选用：名称暂不可用")).toBeTruthy();
  });
  it.each(["", "   "])("uses the unavailable label rather than an empty name (%j)", name => {
    const rules = shop(); rules.catalog[0].name = name;
    render(<AlbumPanel pet={pet()} shop={rules} now={now} page={1} category="home" />);
    expect(screen.getByText("当时选用：名称暂不可用")).toBeTruthy();
  });
  it("resolves the recorded ID against refreshed server names, not a guessed local catalog", () => {
    const p = pet(), catalog = shop();
    const { rerender } = render(<AlbumPanel pet={p} shop={catalog} now={now} page={1} category="home" />);
    expect(screen.getByText("当时选用：嫩叶胸针")).toBeTruthy();
    catalog.catalog[0].name = "服务端的新名称";
    rerender(<AlbumPanel pet={p} shop={catalog} now={now} page={1} category="home" />);
    expect(screen.getByText("当时选用：服务端的新名称")).toBeTruthy();
    expect(screen.queryByText("当时选用：嫩叶胸针")).toBeNull();
  });
  it("does not turn covers or unrelated legacy extra item fields into home memories", () => {
    const p = pet("meal"), catalog = shop();
    const { rerender } = render(<AlbumPanel pet={p} shop={catalog} now={now} page={1} />);
    expect(document.querySelector(".album-item")).toBeNull();
    rerender(<AlbumPanel pet={pet()} shop={catalog} now={now} page={0} category="home" />);
    expect(document.querySelector(".album-item")).toBeNull();
  });
});

describe("home memories through the three-key application", () => {
  let saved: PetState, catalog: Shop;
  const reply = (): Result => ({ state: structuredClone(saved), shop: structuredClone(catalog), message: "", serverTime: now });
  const key = async (key: string) => { await act(async () => { fireEvent.keyDown(window, { key }); }); };
  const refresh = async () => { saved.revision++; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    saved = pet(); catalog = shop(); api.mockReset(); api.mockImplementation(async () => reply());
  });
  it("uses the response catalog, keeps the recorded item after wardrobe updates and reload, and never writes while browsing", async () => {
    const open = async () => {
      await key("a"); for (let i = 0; i < 8; i++) await key("a"); await key("b");
      for (let i = 0; i < 4; i++) await key("a"); await key("b"); await key("b");
    };
    await act(async () => { render(<App />); }); await open();
    expect(screen.getByText("当时选用：嫩叶胸针")).toBeTruthy();
    saved.economy!.equipped.accessory = ""; await refresh();
    expect(screen.getByText("当时选用：嫩叶胸针")).toBeTruthy();
    catalog.catalog[0].name = "当前目录里的嫩叶胸针"; await refresh();
    expect(screen.getByText("当时选用：当前目录里的嫩叶胸针")).toBeTruthy();
    catalog.catalog = []; await refresh();
    expect(screen.getByText("当时选用：名称暂不可用")).toBeTruthy();
    cleanup(); catalog = shop(); await act(async () => { render(<App />); }); await open();
    expect(screen.getByText("当时选用：嫩叶胸针")).toBeTruthy();
    expect(saved.album!.entries).toHaveLength(1);
    expect(api.mock.calls.filter(([path]) => !["state", "visit"].includes(path))).toHaveLength(0);
  });
});
