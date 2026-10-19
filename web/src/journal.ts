import type { PetState } from "./types";

export type JournalEntry = Readonly<PetState["logs"][number]>;
// Go permits empty/nil histories in valid saves. Do not fabricate an entry for
// a null or omitted legacy response, even though normal new saves have an array.
export type JournalLogs = readonly JournalEntry[] | null | undefined;
export type JournalCursor = Readonly<{ entry: JournalEntry | null; olderMatches: number; trimmed: boolean }>;
const sameEntry = (a: JournalEntry, b: JournalEntry) => a.at === b.at && a.text === b.text;
function cursorAt(entries: readonly JournalEntry[], index: number, trimmed = false): JournalCursor {
  const entry = entries[index] ?? null;
  return { entry, olderMatches: entry ? entries.slice(index + 1).filter(other => sameEntry(other, entry)).length : 0, trimmed };
}
export function startJournal(logs: JournalLogs): JournalCursor {
  return cursorAt(logs ?? [], 0);
}
// Diary entries have no portable IDs. Timestamp + text anchors ordinary updates.
// Count identical entries from the older end so all duplicates remain browsable
// and prepending another identical log doesn't silently reset navigation. Their
// identity after arbitrary removal/reordering is unknowable; never invent IDs.
export function reconcileJournal(logs: JournalLogs, cursor: JournalCursor): JournalCursor {
  const entries = logs ?? [], selected = cursor.entry;
  if (!selected) return entries.length ? cursorAt(entries, cursor.trimmed ? entries.length - 1 : 0, cursor.trimmed) : cursor;
  const matches = entries.filter(entry => sameEntry(entry, selected)).length;
  if (matches) return cursor.olderMatches < matches ? cursor : { ...cursor, olderMatches: matches - 1 };
  // A rolling diary is not a permanent archive. Never keep displaying an entry
  // removed from the authoritative save, or silently jump to a newer one.
  return cursorAt(entries, entries.length - 1, true);
}
export function journalView(logs: JournalLogs, cursor: JournalCursor) {
  const entries = logs ?? [], current = reconcileJournal(entries, cursor), selected = current.entry;
  let index = -1, remaining = current.olderMatches;
  if (selected) for (let i = entries.length - 1; i >= 0; i--) {
    if (sameEntry(entries[i], selected) && remaining-- === 0) { index = i; break; }
  }
  return { cursor: current, index, entry: entries[index] ?? null };
}
export function nextJournal(logs: JournalLogs, cursor: JournalCursor): JournalCursor {
  const entries = logs ?? [], { index } = journalView(entries, cursor);
  return cursorAt(entries, entries.length ? (index + 1) % entries.length : 0);
}
