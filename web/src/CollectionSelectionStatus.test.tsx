import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FishAlbum } from "./FishingGame";
import { ParkAlbum } from "./WalkingGame";
import { fishCatalogFor } from "./fishing";
import { parkCatalog } from "./walk";
import type { PetState } from "./types";

const now = Date.UTC(2026, 9, 25);
const cases = [
  { kind: "fish", schema: 14, count: 6 },
  { kind: "fish", schema: 18, count: 7 },
  { kind: "fish", schema: 23, count: 8 },
  { kind: "park", schema: 23, count: 6 },
] as const;
function pet(schema: number): PetState {
  return { schema, revision: 1, species: 2, name: "图鉴伙伴", createdAt: now, hatchedAt: now,
    lastTick: now, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 }, careCount: 0, logs: [] };
}
function discover(saved: PetState) {
  const records = (ids: string[]) => ids.map(id => ({ id, count: 1, firstAt: now, lastAt: now }));
  saved.pond = { since: now, fish: records(fishCatalogFor(saved).map(f => f.id)) };
  saved.park = { since: now, finds: records(parkCatalog.map(p => p.id)), walks: 1, lastWalkAt: now };
}
function panel(kind: string, saved: PetState, page = 0) {
  return kind === "fish" ? <FishAlbum pet={saved} page={page}/> : <ParkAlbum pet={saved} page={page}/>;
}
function status(kind: string) { return document.querySelector(`[data-selection-status="${kind}-album"]`)!; }
afterEach(cleanup);
it.each(cases)("$kind schema=$schema announces each known/unknown page without revealing undiscovered names", ({ kind, schema, count }) => {
  const saved = pet(schema), catalog = kind === "fish" ? fishCatalogFor(saved) : parkCatalog;
  const before = structuredClone(saved), view = render(panel(kind, saved));
  const region = status(kind);
  expect(region.getAttribute("role")).toBe("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.getAttribute("aria-atomic")).toBe("true");
  for (let page = 0; page < count; page++) {
    view.rerender(panel(kind, saved, page));
    expect(status(kind)).toBe(region);
    expect(region.textContent).toContain(`第 ${page + 1} / ${count} 页：还未遇见`);
    expect(region.textContent).toContain("A 上一页，B 下一页，C 返回小窝");
    for (const item of catalog) expect(region.textContent).not.toContain(item.name);
  }
  expect(saved).toEqual(before);
  discover(saved);
  for (let page = 0; page < count; page++) {
    view.rerender(panel(kind, saved, page));
    expect(status(kind)).toBe(region);
    expect(region.textContent).toContain(`第 ${page + 1} / ${count} 页：${catalog[page].name}`);
    expect(region.textContent).not.toContain(catalog[page].story);
  }
  expect(document.querySelectorAll("button,a,input,[role=button]")).toHaveLength(0);
});
it.each(cases)("$kind schema=$schema ordinary sync does not mutate the mounted announcement", async ({ kind, schema }) => {
  const saved = pet(schema); discover(saved);
  const view = render(panel(kind, saved)), region = status(kind), announced = region.textContent;
  const changed = vi.fn(), observer = new MutationObserver(changed);
  observer.observe(region, { subtree: true, characterData: true, childList: true });
  const updated = structuredClone(saved); updated.revision++; updated.lastTick += 60000; updated.needs.hunger--;
  for (const record of [...updated.pond!.fish!, ...updated.park!.finds!]) {
    record.count++; record.lastAt += 60000; record.firstAt -= 86400000;
  }
  await act(async () => { view.rerender(panel(kind, updated)); });
  expect(status(kind)).toBe(region); expect(region.textContent).toBe(announced);
  expect(changed).not.toHaveBeenCalled(); observer.disconnect();
});
it.each(["fish", "park"])("%s distinguishes returning to a paused game from returning home", kind => {
  const saved = pet(23), view = render(panel(kind, saved)), region = status(kind);
  expect(region.textContent).toContain("C 返回小窝");
  saved.game = { id: "a".repeat(32), kind: kind === "fish" ? "fishing" : "walk", startedAt: now,
    round: 0, score: 0, lastBeat: -1 };
  view.rerender(panel(kind, saved));
  expect(status(kind)).toBe(region); expect(region.textContent).toContain("C 返回暂停菜单");
  expect(document.querySelector(`.${kind}-album > small:last-child`)?.textContent).toContain("C 返回暂停菜单");
  delete saved.game; view.rerender(panel(kind, saved));
  expect(region.textContent).toContain("C 返回小窝");
});
