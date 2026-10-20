import { albumMemories, type AlbumCategory } from "./AlbumPanel";
import type { Memory, PetState } from "./types";

// The save guarantees one memory per kind, except elapsed-day milestones.
// Anchor to that identity, not timestamp/order or a stale copy of the contents.
type MemoryIdentity = Pick<Memory, "kind" | "days">;
export type AlbumCursor = { selected: MemoryIdentity | null; missing: boolean };
export const startAlbum = (): AlbumCursor => ({ selected: null, missing: false });
const sameMemory = (a: MemoryIdentity, b: MemoryIdentity) => a.kind === b.kind && (a.days ?? 0) === (b.days ?? 0);
export function reconcileAlbum(pet: PetState, category: AlbumCategory, cursor: AlbumCursor): AlbumCursor {
  if (!cursor.selected || albumMemories(pet, category).some(memory => sameMemory(memory, cursor.selected!))) return cursor;
  // Never keep showing a memory absent from the authoritative save or silently
  // substitute its old numeric neighbour. This is not the rolling diary.
  return { selected: null, missing: true };
}
export function albumView(pet: PetState, category: AlbumCategory, cursor: AlbumCursor) {
  const memories = albumMemories(pet, category), current = reconcileAlbum(pet, category, cursor);
  const page = current.selected ? memories.findIndex(memory => sameMemory(memory, current.selected!)) + 1 : 0;
  return { cursor: current, page };
}
function turnAlbum(pet: PetState, category: AlbumCategory, cursor: AlbumCursor, direction: 1 | -1): AlbumCursor {
  const memories = albumMemories(pet, category), { page } = albumView(pet, category, cursor);
  const nextPage = (page + direction + memories.length + 1) % (memories.length + 1);
  const next = memories[nextPage - 1];
  return next ? { selected: { kind: next.kind, days: next.days }, missing: false } : startAlbum();
}

export function nextAlbum(pet: PetState, category: AlbumCategory, cursor: AlbumCursor): AlbumCursor {
  return turnAlbum(pet, category, cursor, 1);
}
export function previousAlbum(pet: PetState, category: AlbumCategory, cursor: AlbumCursor): AlbumCursor {
  return turnAlbum(pet, category, cursor, -1);
}
