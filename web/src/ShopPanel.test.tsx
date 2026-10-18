import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dailyClaimed, ShopPanel } from "./ShopPanel";
import { emptyGrowth } from "./growth";
import { PetArt } from "./PetArt";
import { AlbumPanel, memoryWords } from "./AlbumPanel";
import type { GrowthStage, PetState, Shop } from "./types";

const now = Date.UTC(2026, 9, 18, 23, 59, 59);
const pet = (): PetState => ({ schema: 4, revision: 1, species: 2, name: "草莓兔", createdAt: now - 2000, hatchedAt: now - 1000, lastTick: now, sleeping: false, needs: { hunger: 80, clean: 80, mood: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth("baby"), economy: { coins: 10, lastDailyAt: now, lastGameAt: now, gameCoins: 8, owned: ["leaf-pin"], equipped: { accessory: "leaf-pin", room: "" } } });
const shop: Shop = { dailyCoins: 10, gameDailyLimit: 30, catalog: [{ id: "leaf-pin", name: "嫩叶胸针", slot: "accessory", price: 12, description: "一小片春天" }] };
afterEach(cleanup);
describe("shop rules and saved visual equipment", () => {
  it("uses UTC boundaries rather than the browser's local date, with no catchup", () => {
    const p = pet();
    expect(dailyClaimed(p, now)).toBe(true);
    expect(dailyClaimed(p, now + 1000)).toBe(false);
    expect(dailyClaimed(p, now + 10 * 86400000)).toBe(false);
    expect(dailyClaimed(p, now - 86400000)).toBe(true);
  });
  it("shows the true remaining daily game allowance and resets only its display on a new day", () => {
    const p = pet();
    const { rerender } = render(<ShopPanel pet={p} shop={shop} page={0} now={now} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 22 币")).toBeTruthy();
    rerender(<ShopPanel pet={p} shop={shop} page={0} now={now + 1000} confirm={false} />);
    expect(screen.getByText("今日游戏还可得 30 币")).toBeTruthy();
    expect(p.economy!.coins).toBe(10);
    expect(p.economy!.gameCoins).toBe(8);
  });
  it("renders all 10 species and all three stages with a single non-duplicated accessory", () => {
    for (let index = 0; index < 10; index++) for (const stage of ["baby", "growing", "adult"] as GrowthStage[]) {
      for (const accessory of ["leaf-pin", "berry-scarf", "star-badge"]) {
        const view = render(<PetArt index={index} stage={stage} accessory={accessory} />);
        expect(view.container.querySelectorAll(".pet-sprite")).toHaveLength(1);
        expect(view.container.querySelectorAll(".equipped-accessory")).toHaveLength(1);
        expect(view.container.querySelector(".equipped-accessory")?.getAttribute("data-item")).toBe(accessory);
        view.unmount();
      }
    }
  });
  it("shows the original saved accessory in a memory even after equipment was replaced", () => {
    const p = pet();
    p.economy!.equipped.accessory = "star-badge";
    p.album = { since: p.createdAt, legacy: false, entries: [{ kind: "outfit", at: now, source: "shared", item: "leaf-pin" }] };
    render(<AlbumPanel pet={p} now={now} page={1} />);
    expect(document.querySelector('.album-picture [data-item="leaf-pin"]')).not.toBeNull();
    expect(document.querySelector('.album-picture [data-item="star-badge"]')).toBeNull();
    expect(memoryWords(p.album.entries[0], false)?.title).toBe("第一次选好小装扮");
  });
});
