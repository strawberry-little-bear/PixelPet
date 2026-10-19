import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AlbumPanel, AlbumDirectory, albumMemories, albumCategories } from './AlbumPanel';
import { outingMemoryWords, isOutingMemory } from './outing-memory';
import { nextAlbum, startAlbum, albumView } from './album-reading';
import { validCoreResponse } from './response';
import type { Memory, PetState } from './types';
import { emptyGrowth } from './growth';
afterEach(cleanup);
const at = Date.UTC(2026, 9, 19);
const pet = (): PetState => ({ schema: 14, revision: 1, species: 2, name: '手记伙伴', createdAt: at-1000, hatchedAt: at-1000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [], growth: emptyGrowth('baby'),
  album: { since: at-1000, legacy: false, entries: [] } });
it.each(Object.keys(outingMemoryWords) as (keyof typeof outingMemoryWords)[])('reads saved %s without inventing another card or write control', kind => {
  const p = pet(); p.album!.entries.push({ kind, at, source: 'shared' });
  const before = structuredClone(p);
  expect(validCoreResponse({state:p,serverTime:at,message:""})).toBe(true);
  expect(albumMemories(p,'scenery')).toEqual(p.album!.entries);
  render(<AlbumPanel pet={p} now={at} page={1} category="scenery" />);
  expect(screen.getByText(outingMemoryWords[kind].title)).toBeTruthy();
  expect(screen.getByText(outingMemoryWords[kind].story)).toBeTruthy();
  expect(screen.getByText(/真实发现时的虚构风景/)).toBeTruthy();
  expect(document.querySelector('button,a,input')).toBeNull();
  expect(p).toEqual(before);
});
it('adds a reachable category without changing existing category positions', () => {
  expect(albumCategories.map(c=>c.id)).toEqual(['all','growth','care','play','home','days','scenery']);
  render(<AlbumDirectory pet={pet()} choice={6} />);
  expect(document.querySelector('[data-album-directory="scenery"]')).toBeTruthy();
});
it.each([12,13])('never backfills old discovery collections (schema %s)', schema => {
  const p=pet(); p.schema=schema; p.pond={since:at-1000,fish:[{id:'sun-carp',firstAt:at,lastAt:at,count:1}]};
  render(<AlbumPanel pet={p} now={at} page={0} category="scenery" />);
  expect(screen.getByText(/还没有留下风景手记/)).toBeTruthy();
  expect(document.querySelector('time')).toBeNull();
  expect(albumMemories(p,'scenery')).toEqual([]);
  if(schema===12) expect(screen.getByText(/不会补写过去的风景/)).toBeTruthy();
});
it('keeps a stable per-kind reading anchor across synchronization and missing records', () => {
  const p=pet(); const entries:Memory[]=[{kind:'scenery-walk-rain',at,source:'shared'}]; p.album!.entries=entries;
  const cursor=nextAlbum(p,'scenery',startAlbum());
  entries.unshift({kind:'scenery-fishing-clear',at:at-500,source:'shared'});
  expect(albumView(p,'scenery',cursor).page).toBe(2);
  entries.pop(); expect(albumView(p,'scenery',cursor)).toEqual({page:0,cursor:{selected:null,missing:true}});
});
it.each(['scenery-walk-snow','scenery-fishing-clear\n','__proto__','constructor'])('rejects unsupported saved story key %j', kind => {
  expect(isOutingMemory(kind)).toBe(false);
  const p=pet(); p.album!.entries=[{kind,at,source:'shared'} as Memory];
  expect(validCoreResponse({state:p,serverTime:at,message:""})).toBe(false);
});
