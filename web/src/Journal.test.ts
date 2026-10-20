import { describe, expect, it } from "vitest";
import { journalView, nextJournal, previousJournal, reconcileJournal, startJournal } from "./journal";
import type { JournalCursor } from "./journal";

const logs = Object.freeze([{ at: 3000, text: "饭团" }, { at: 2000, text: "泡泡" }, { at: 1000, text: "相遇" }].map(entry => Object.freeze(entry)));
describe("read-only diary cursor", () => {
  it.each([[], null, undefined])("has no entry for empty history %s", entries => {
    const cursor = startJournal(entries);
    expect(journalView(entries, cursor)).toMatchObject({ entry: null, index: -1 });
    expect(nextJournal(entries, cursor)).toEqual(cursor);
    expect(reconcileJournal(entries, cursor)).toBe(cursor);
  });
  it("matches timestamp and text, not array index or the response's object identity", () => {
    const selected = nextJournal(logs, startJournal(logs));
    const updated = [{ at: 4000, text: "长大" }, ...structuredClone(logs)];
    expect(journalView(updated, selected)).toMatchObject({ entry: logs[1], index: 2 });
    expect(reconcileJournal(updated, selected)).toBe(selected);
    expect(nextJournal(updated, selected).entry).toEqual(logs[2]);
  });
  it.each([
    { at: 2000, text: "不是原来的泡泡" }, { at: 1999, text: "泡泡" },
  ])("does not mistake a partial match for the same entry: %j", entry => {
    const selected = nextJournal(logs, startJournal(logs));
    const current = reconcileJournal([entry, logs[2]], selected);
    expect(current).toEqual({ entry: logs[2], olderMatches: 0, trimmed: true });
  });
  it("anchors the retained fallback, rather than repeatedly following the oldest entry", () => {
    let current = reconcileJournal(logs.slice(0, 2), { entry: logs[2], olderMatches: 0, trimmed: false });
    expect(current).toEqual({ entry: logs[1], olderMatches: 0, trimmed: true });
    const appended = [...logs.slice(0, 2), { at: 1500, text: "另一条保留的历史" }];
    expect(reconcileJournal(appended, current)).toBe(current);
    current = nextJournal(appended, current); expect(current.trimmed).toBe(false);
  });
  it("shows a retained oldest record after clearing and refilling, never a deleted record", () => {
    const empty = reconcileJournal([], startJournal(logs));
    expect(empty).toEqual({ entry: null, olderMatches: 0, trimmed: true });
    expect(reconcileJournal(logs, empty)).toEqual({ entry: logs[2], olderMatches: 0, trimmed: true });
  });
  it("can browse duplicate saved entries without inventing portable event IDs", () => {
    const duplicated = [logs[0], { ...logs[0] }, logs[1]];
    const current = nextJournal(duplicated, startJournal(duplicated));
    expect(journalView(duplicated, current).entry).toEqual(logs[0]);
    expect(current.trimmed).toBe(false); expect(duplicated).toHaveLength(3);
    expect(nextJournal(duplicated, current).entry).toEqual(logs[1]);
  });
  it("keeps duplicate position when another indistinguishable entry is prepended", () => {
    const duplicated = [logs[0], { ...logs[0] }, logs[1]];
    const current = nextJournal(duplicated, startJournal(duplicated));
    const updated = [{ ...logs[0] }, ...duplicated];
    expect(journalView(updated, current).index).toBe(2);
    expect(nextJournal(updated, current).entry).toBe(logs[1]);
    expect(journalView(duplicated.slice(1), startJournal(duplicated)).index).toBe(0);
  });
  it("clears a trim notice on explicit navigation and wraps to newest", () => {
    const cursor: JournalCursor = { entry: logs[2], olderMatches: 0, trimmed: true };
    expect(nextJournal(logs, cursor)).toEqual(startJournal(logs));
  });
});

describe("bidirectional diary navigation", () => {
  it.each([[], null, undefined])("keeps an empty history honest in reverse (%s)", entries => {
    const cursor = startJournal(entries);
    expect(previousJournal(entries, cursor)).toEqual(cursor);
  });
  it("goes one entry newer, wraps at newest, and is reversible", () => {
    const oldest = previousJournal(logs, startJournal(logs));
    expect(journalView(logs, oldest).index).toBe(2);
    const middle = previousJournal(logs, oldest);
    expect(journalView(logs, middle).index).toBe(1);
    expect(previousJournal(logs, middle)).toEqual(startJournal(logs));
    for (let cursor = startJournal(logs), i = 0; i < logs.length; i++, cursor = nextJournal(logs, cursor)) {
      expect(previousJournal(logs, nextJournal(logs, cursor))).toEqual(cursor);
      expect(nextJournal(logs, previousJournal(logs, cursor))).toEqual(cursor);
    }
  });
  it("keeps a single record in place without mutating it", () => {
    const only = Object.freeze([logs[0]]);
    expect(previousJournal(only, startJournal(only))).toEqual(startJournal(only));
  });
  it("moves from the reconciled entry after prepending new history", () => {
    const middle = nextJournal(logs, startJournal(logs));
    const updated = [Object.freeze({ at: 4000, text: "长大" }), ...logs];
    expect(journalView(updated, previousJournal(updated, middle))).toMatchObject({ entry: logs[0], index: 1 });
  });
  it("moves from a retained fallback and clears eviction notice", () => {
    const retained = logs.slice(0, 2);
    const cursor = { entry: logs[2], olderMatches: 0, trimmed: false };
    expect(previousJournal(retained, cursor)).toEqual(startJournal(retained));
  });
  it("visits identical saved entries in reverse even after a duplicate prepend", () => {
    const duplicated = [logs[0], { ...logs[0] }, logs[1]];
    const second = nextJournal(duplicated, startJournal(duplicated));
    const updated = [{ ...logs[0] }, ...duplicated];
    const newer = previousJournal(updated, second);
    expect(journalView(updated, newer).index).toBe(1);
    expect(journalView(updated, previousJournal(updated, newer)).index).toBe(0);
    expect(journalView(updated, previousJournal(updated, startJournal(updated))).index).toBe(3);
  });
});
