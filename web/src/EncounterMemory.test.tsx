import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlbumPanel, albumMemories } from "./AlbumPanel";
import { albumView, nextAlbum, startAlbum } from "./album-reading";
import { emptyGrowth } from "./growth";
import { validCoreResponse } from "./response";
import { previewBackup } from "./backup";
import type { Memory, PetState } from "./types";

afterEach(cleanup);
const at = Date.UTC(2026, 9, 20);
const pet = (): PetState => ({ schema: 14, revision: 1, species: 2, name: "偶遇伙伴", createdAt: at - 1000, hatchedAt: at - 1000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth(),
  album: { since: at - 1000, legacy: false, entries: [] } });
const cases = [
  ["encounter-fishing-stars", "偶遇 · 星光涟漪", "00002400000000000000000000000001"],
  ["encounter-walk-kite", "偶遇 · 晚霞纸鸢", "00001800000000000000000000000001"],
] as const;
describe.each(cases)("saved %s", (kind, title, outingId) => {
  it("reads only the actual saved encounter, with no unfinished checklist or reward claim", () => {
    const p = pet(); p.album!.entries = [{ kind, at, source: "shared", outingId }];
    const before = structuredClone(p);
    expect(validCoreResponse({ state: p, serverTime: at, message: "" })).toBe(true);
    expect(albumMemories(p, "scenery")).toEqual(p.album!.entries);
    render(<AlbumPanel pet={p} now={at} category="scenery" page={1} />);
    expect(screen.getByText(title)).toBeTruthy(); expect(document.querySelector("time")?.dateTime).toBe(new Date(at).toISOString());
    expect(document.querySelector(".album-panel")?.textContent).not.toMatch(/金币|成长 \+|未解锁|限时/);
    expect(document.querySelector("button,a,input")).toBeNull(); expect(document.querySelectorAll("[data-selection-status=album-page]")).toHaveLength(1); expect(p).toEqual(before);
  });
  it("preserves optional provenance through backup preview without inventing or discarding fields", () => {
    const p = pet(); p.album!.entries = [{ kind, at, source: "shared", outingId }];
    expect(previewBackup(JSON.stringify(p)).data).toEqual(p);
  });
  it("keeps the selected encounter anchored when another saved card arrives", () => {
    const p = pet(); p.album!.entries = [{ kind, at, source: "shared", outingId }];
    const cursor = nextAlbum(p, "scenery", startAlbum());
    p.album!.entries.unshift({ kind: "scenery-walk-clear", at: at - 1, source: "shared" });
    expect(albumView(p, "scenery", cursor).cursor.selected?.kind).toBe(kind);
    expect(albumView(p, "scenery", cursor).page).toBe(2);
  });
});
it.each([12, 13, 14])("does not fabricate encounters from an eligible current session (schema %s)", schema => {
  const p = pet(); p.schema = schema;
  p.game = { kind: "walk", id: cases[1][2], startedAt: at, round: 0, score: 0, lastBeat: -1 };
  p.park = { since: at - 1000, walks: 1, lastWalkAt: at, finds: [{ id: "leaf", firstAt: at, lastAt: at, count: 1 }] };
  render(<AlbumPanel pet={p} now={at} category="scenery" page={0} />);
  expect(document.querySelector(".album-panel")?.textContent).toContain("还没有留下风景手记");
  expect(document.querySelector("time")).toBeNull(); expect(albumMemories(p, "scenery")).toEqual([]);
});
it.each([{}, [], 3, null])("does not accept malformed optional encounter provenance %j", outingId => {
  const p = pet(); p.album!.entries = [{ kind: cases[0][0], at, source: "shared", outingId } as unknown as Memory];
  expect(validCoreResponse({ state: p, serverTime: at, message: "" })).toBe(false);
});
