import { describe, expect, it } from "vitest";
import { albumView, nextAlbum, previousAlbum, reconcileAlbum, startAlbum } from "./album-reading";
import type { AlbumCursor } from "./album-reading";
import type { Memory, PetState } from "./types";
const pet = (...entries: Memory[]): PetState => ({ album: { since: 1, legacy: false, entries } } as PetState);
const hatch: Memory = { kind: "hatch", at: 1, source: "shared" };
const meal: Memory = { kind: "meal", at: 2, source: "shared" };
const bath: Memory = { kind: "bath", at: 2, source: "shared" };
const selected = (kind: Memory["kind"], days?: number): AlbumCursor => ({ selected: { kind, days }, missing: false });

describe("permanent-memory identity cursor", () => {
  it("starts on a cover, not a fabricated memory", () => {
    expect(albumView(pet(hatch), "all", startAlbum())).toEqual({ cursor: startAlbum(), page: 0 });
  });
  it("anchors tied timestamps by kind rather than numeric position", () => {
    expect(albumView(pet(hatch, meal), "all", selected("meal")).page).toBe(2);
    expect(albumView(pet(hatch, meal, bath), "all", selected("meal")).page).toBe(3);
  });
  it("anchors elapsed milestones by both kind and day count", () => {
    const one: Memory = { kind: "days", days: 1, at: 3, source: "elapsed" };
    const seven: Memory = { kind: "days", days: 7, at: 4, source: "elapsed" };
    expect(albumView(pet(seven), "days", selected("days", 7)).page).toBe(1);
    expect(albumView(pet(seven, one), "days", selected("days", 7)).page).toBe(2);
    expect(albumView(pet(one), "days", selected("days", 7))).toEqual({ cursor: { selected: null, missing: true }, page: 0 });
  });
  it("does not confuse a memory from another category with a visible record", () => {
    expect(albumView(pet(hatch, meal), "care", selected("hatch")).cursor.missing).toBe(true);
    expect(albumView(pet(hatch, meal), "care", selected("meal")).page).toBe(1);
  });
  it("reads updated authoritative contents at the same identity, not a saved snapshot", () => {
    const current = selected("meal");
    const p = pet({ ...meal, at: 3 });
    expect(reconcileAlbum(p, "all", current)).toBe(current);
    expect(current.selected).toEqual({ kind: "meal", days: undefined });
  });
  it("keeps cover position when entries are appended or reordered", () => {
    expect(albumView(pet(meal, hatch, bath), "all", startAlbum()).page).toBe(0);
  });
  it("advances through chronological pages then wraps to cover", () => {
    const p = pet(meal, hatch, bath); let cursor = startAlbum();
    const sequence = Array.from({ length: 5 }, () => { const page = albumView(p, "all", cursor).page; cursor = nextAlbum(p, "all", cursor); return page; });
    expect(sequence).toEqual([0, 1, 2, 3, 0]);
  });
  it("advances from the new position, not the pre-sync index", () => {
    const p = pet(hatch, meal, bath);
    expect(nextAlbum(p, "all", selected("meal"))).toEqual(startAlbum());
    expect(nextAlbum(p, "all", selected("bath"))).toEqual(selected("meal"));
  });
  it("falls back to cover with a retained explanation rather than a neighbouring ghost", () => {
    const cursor = reconcileAlbum(pet(hatch), "all", selected("meal"));
    expect(cursor).toEqual({ selected: null, missing: true });
    expect(reconcileAlbum(pet(hatch), "all", cursor)).toBe(cursor);
    expect(nextAlbum(pet(hatch), "all", cursor)).toEqual(selected("hatch"));
  });
  it("supports missing and empty legacy albums and clears the notice on explicit advance", () => {
    for (const p of [pet(), {} as PetState]) {
      const current = reconcileAlbum(p, "all", selected("meal"));
      expect(albumView(p, "all", current).page).toBe(0);
      expect(nextAlbum(p, "all", current)).toEqual(startAlbum());
    }
  });
  it("never mutates saved order, memory contents or the previous cursor", () => {
    const p = pet(meal, hatch, bath), cursor = selected("meal"), before = structuredClone({ p, cursor });
    albumView(p, "all", cursor); nextAlbum(p, "all", cursor); reconcileAlbum(p, "growth", cursor);
    expect({ p, cursor }).toEqual(before);
  });
});


describe("bidirectional permanent-memory cursor", () => {
  it("goes back through the cover and wraps to the latest saved memory", () => {
    const p = pet(meal, hatch, bath); let cursor = startAlbum();
    const sequence = Array.from({ length: 5 }, () => {
      const page = albumView(p, "all", cursor).page; cursor = previousAlbum(p, "all", cursor); return page;
    });
    expect(sequence).toEqual([0, 3, 2, 1, 0]);
  });
  it.each(["all", "care", "growth"] as const)("both directions undo each other in %s", category => {
    const p = pet(meal, hatch, bath), before = structuredClone(p); let cursor = startAlbum();
    for (let i = 0; i < 6; i++) {
      expect(previousAlbum(p, category, nextAlbum(p, category, cursor))).toEqual(cursor);
      expect(nextAlbum(p, category, previousAlbum(p, category, cursor))).toEqual(cursor);
      cursor = nextAlbum(p, category, cursor);
    }
    expect(p).toEqual(before);
  });
  it("uses the updated identity when tied-date memories arrive before the selected one", () => {
    const p = pet(hatch, meal, bath), cursor = selected("meal"), before = structuredClone(cursor);
    expect(previousAlbum(p, "all", cursor)).toEqual(selected("bath"));
    expect(cursor).toEqual(before);
  });
  it("does not confuse day milestones when reversing", () => {
    const p = pet({kind:"days",days:1,at:1,source:"elapsed"}, {kind:"days",days:7,at:2,source:"elapsed"});
    expect(previousAlbum(p, "days", selected("days", 7))).toEqual(selected("days", 1));
    expect(previousAlbum(p, "days", startAlbum())).toEqual(selected("days", 7));
  });
  it("reconciles a missing record before reversing, clearing the explanation only on deliberate input", () => {
    const p = pet(hatch, bath), cursor = reconcileAlbum(p, "all", selected("meal"));
    expect(cursor.missing).toBe(true);
    expect(previousAlbum(p, "all", cursor)).toEqual(selected("bath"));
    expect(cursor.missing).toBe(true);
  });
  it.each([{}, {album:{since:1,legacy:false,entries:[]}}])("empty or legacy albums stay on the cover (%s)", fixture => {
    expect(previousAlbum(fixture as PetState, "all", {selected:null,missing:true})).toEqual(startAlbum());
  });
});
