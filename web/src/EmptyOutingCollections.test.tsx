import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FishAlbum } from "./FishingGame";
import { ParkAlbum } from "./WalkingGame";
import { fishCatalogFor } from "./fishing";
import { parkCatalog } from "./walk";
import type { PetState } from "./types";

const now = Date.now();
type Collections = Partial<Pick<PetState, "pond" | "park">>;
function pet(collections: Collections): PetState {
  return { schema: 17, revision: 1, species: 2, name: "空图鉴伙伴", createdAt: now,
    hatchedAt: now, lastTick: now, sleeping: false, needs: { hunger: 70, mood: 70, energy: 80, clean: 80 },
    careCount: 0, logs: [], ...collections };
}
afterEach(cleanup);
const cases: [string, Collections][] = [
  ["legacy absent", {}],
  ["nil slices", { pond: { since: now, fish: null }, park: { since: now, finds: null, walks: 0, lastWalkAt: 0 } }],
  ["omitted slices", { pond: { since: now }, park: { since: now, walks: 0, lastWalkAt: 0 } }],
  ["empty arrays", { pond: { since: now, fish: [] }, park: { since: now, finds: [], walks: 0, lastWalkAt: 0 } }],
];
for (const [label, collections] of cases) {
  it.each(fishCatalogFor({ schema: 17 }).map((_, page) => page))(`renders ${label} fish page %i without inventing discoveries or changing state`, page => {
    const saved = pet(collections), before = structuredClone(saved);
    render(<FishAlbum pet={saved} page={page} />);
    expect(screen.getByText("已发现 0 / 7")).toBeTruthy();
    expect(screen.getByText("还未遇见的小鱼")).toBeTruthy();
    expect(document.querySelectorAll(".fish-album-grid svg text")).toHaveLength(7);
    expect(document.querySelectorAll("button,a,input")).toHaveLength(0);
    expect(saved).toEqual(before);
  });
  it.each(parkCatalog.map((_, page) => page))(`renders ${label} park page %i without inventing discoveries or changing state`, page => {
    const saved = pet(collections), before = structuredClone(saved);
    render(<ParkAlbum pet={saved} page={page} />);
    expect(screen.getByText("0 / 6 种 · " + (page + 1) + " / 6")).toBeTruthy();
    expect(screen.getByText("还未遇见")).toBeTruthy();
    expect(document.querySelector(".park-art text")).toBeTruthy();
    expect(document.querySelectorAll("button,a,input")).toHaveLength(0);
    expect(saved).toEqual(before);
  });
}
