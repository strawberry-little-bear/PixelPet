import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { emptyGrowth } from "./growth";
import type { PetState } from "./types";

let saved: PetState;
const calls: { path: string; body: Record<string, unknown> | undefined }[] = [];
const item = { id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一片小叶子" };
async function key(key: string) { await act(async () => { fireEvent.keyDown(window, { key }); }); }
async function open() { await key("a"); for(let i=0;i<9;i++) await key("a"); await key("b"); }
const writes = () => calls.filter(c => c.path === "action");
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); calls.length = 0;
  saved = { schema: 17, revision: 2, species: 2, name: "草莓兔", createdAt: Date.now()-2000, hatchedAt: Date.now()-1000,
    lastTick: Date.now(), sleeping: false, needs: { hunger: 70, mood: 70, clean: 80, energy: 80 }, careCount: 0,
    growth: emptyGrowth(), logs: [], economy: { coins: 30, lastDailyAt: 0, lastGameAt: 0, gameCoins: 0,
      owned: [], equipped: { accessory: "", room: "" } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/", ""), body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ path, body });
    if (path === "action") {
      expect(body.kind).toBe("buy"); expect(body.item).toBe(item.id);
      saved.economy!.coins -= item.price; saved.economy!.owned = [item.id]; saved.revision++;
    }
    return new Response(JSON.stringify({ state: saved, serverTime: Date.now(), message: "",
      shop: { catalog: [item], dailyCoins: 10, gameDailyLimit: 30, maxCoins: 1000000 } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([null, undefined, []])("empty ownership %j can browse/confirm/cancel/buy through A/B/C", async owned => {
  Object.assign(saved.economy!, { owned });
  await act(async () => { render(<App/>); }); await open();
  expect(document.querySelector(".shop-panel")).toBeTruthy();
  for(let i=0;i<7;i++) await key("a"); await key("b");
  expect(document.querySelector(".shop-panel")?.textContent).toContain("这里还空着呢");
  await key("c"); for(let i=0;i<2;i++) await key("a"); await key("b");
  expect(document.querySelector(".shop-panel h3")?.textContent).toContain(item.name);
  await key("b"); expect(writes()).toHaveLength(0);
  expect(document.querySelector(".shop-panel")?.getAttribute("data-confirm")).toBe("true");
  await key("c"); expect(writes()).toHaveLength(0);
  await key("b"); await key("b"); expect(writes()).toHaveLength(1);
  expect(saved.economy!.coins).toBe(18); expect(saved.economy!.owned).toEqual([item.id]);
  expect(document.querySelector(".shop-panel")?.textContent).toContain("已拥有");
  expect(document.querySelectorAll(".physical-button")).toHaveLength(3);
  expect(document.querySelector(".lcd button,.lcd a,.lcd input")).toBeNull();
});
