import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlbumPanel, albumMemories, memoryWords } from "./AlbumPanel";
import { albumView, nextAlbum, previousAlbum, startAlbum } from "./album-reading";
import { gameKeepsakes } from "./game-keepsakes";
import { completedGameOutcome } from "./game-outcome";
import { GameOutcome } from "./GameOutcome";
import { lifeSummary } from "./LifeSummary";
import { validCoreResponse } from "./response";
import type { Memory, PetState, Result } from "./types";
const at = Date.UTC(2026, 9, 25), id = "0123456789abcdef0123456789abcdef";
const pet = (): PetState => ({ schema: 21, revision: 1, species: 2, name: "收好小事", createdAt: at-10000, hatchedAt: at-9000,
  lastTick: at, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, careCount: 0, logs: [],
  album: { since: at-9000, legacy: false, entries: gameKeepsakes.flatMap(k => [
    { kind: k.game, at, source: "shared" } as Memory, { kind: "keepsake", item: k.item, at, source: "shared" } as Memory]) } });
afterEach(cleanup);
it.each(gameKeepsakes)("renders $item with distinct art, factual text and no LCD controls", entry => {
  const p = pet(), original = structuredClone(p), memories = albumMemories(p, "play");
  const page = memories.findIndex(m => m.item === entry.item) + 1;
  render(<AlbumPanel pet={p} now={at} page={page} category="play" />);
  expect(screen.getByText(entry.title)).toBeTruthy();
  expect(document.querySelector(`[data-keepsake-art="${entry.item}"]`)).toBeTruthy();
  expect(document.querySelector("button,a,input,[role=button]")).toBeNull();
  expect(screen.getByText(/每种只留一件，不必集齐/)).toBeTruthy();
  expect(memoryWords(memories[page-1], true).story).not.toMatch(/第一次|签到|奖励|解锁/);
  expect(p).toEqual(original);
});
it("keeps seven same-time items independent across forward, backward and authoritative reordering", () => {
  const p = pet(), pages = albumMemories(p,"play"), identities: string[] = [];
  let cursor = startAlbum();
  for (let n=0;n<pages.length;n++) {
    cursor = nextAlbum(p,"play",cursor);
    const selected = pages[albumView(p,"play",cursor).page-1];
    identities.push(`${selected.kind}:${selected.item ?? ""}`);
    const updated = structuredClone(p); updated.album!.entries.reverse();
    expect(albumView(updated,"play",cursor).page).toBe(n+1);
  }
  expect(new Set(identities).size).toBe(14);
  cursor = previousAlbum(p,"play",nextAlbum(p,"play",cursor));
  expect(albumView(p,"play",cursor).page).toBe(14);
  const selected = nextAlbum(p,"play",nextAlbum(p,"play",nextAlbum(p,"play",startAlbum())));
  // Reconcile a selected specific item, never substitute a neighbouring keepsake.
  const chosen = selected.selected;
  expect(chosen?.kind).toBe("keepsake");
  const removed = structuredClone(p); removed.album!.entries = removed.album!.entries.filter(m => m.kind !== "keepsake" || m.item !== chosen!.item);
  expect(albumView(removed,"play",selected)).toMatchObject({page:0,cursor:{missing:true}});
});
it("does not fabricate items in older saves or inflate completed-game categories", () => {
  const p=pet();
  expect(lifeSummary(p,at).gameMemories).toBe(7);
  p.schema=20; p.album!.entries=p.album!.entries.filter(m=>m.kind!=="keepsake");
  expect(albumMemories(p,"play")).toHaveLength(7);
  expect(albumMemories(p,"play").some(m=>m.kind==="keepsake")).toBe(false);
});
it("accepts display-safe memories and safely renders an unknown item fallback", () => {
  const p=pet(), reply={state:p,serverTime:at,message:""}, before=structuredClone(reply);
  expect(validCoreResponse(reply)).toBe(true); expect(reply).toEqual(before);
  expect(memoryWords({kind:"keepsake",at,source:"shared",item:"future-item"},false).story).toContain("暂不可用");
});
function settlement() {
  const before=pet(); before.album!.entries=before.album!.entries.filter(m=>m.kind!=="keepsake");
  before.game={id,kind:"snake",startedAt:at,round:0,score:0,lastBeat:-1};
  const after=pet(); after.companion={since:at,interests:[],recent:{kind:"snake",id,at}};
  const result:Result={state:after,message:"已结算，实得 +0 金币",serverTime:at};
  return {before,result};
}
it("notices only the matching newly saved item on a confirmed settlement, including +0 coins", () => {
  const {before,result}=settlement();
  const outcome=completedGameOutcome("snake-finish",before,result);
  expect(outcome?.keepsake).toBe("fruit-leaf");
  render(<GameOutcome outcome={outcome} />);
  expect(screen.getByText(/一起收好了「果园里的叶子」/)).toBeTruthy();
  expect(screen.getByText(/纪念册「一起玩过」/)).toBeTruthy();
});
it.each(["repeat","old time","not shared","no album","old schema","wrong item"])("does not claim a new item for %s", condition => {
  const {before,result}=settlement();
  if(condition==="repeat") before.album!.entries=structuredClone(result.state.album!.entries);
  if(condition==="old time") result.state.album!.entries.forEach(m=>{if(m.kind==="keepsake")m.at--});
  if(condition==="not shared") delete result.state.companion!.recent;
  if(condition==="no album") delete before.album;
  if(condition==="old schema") result.state.schema=20;
  if(condition==="wrong item") result.state.album!.entries=result.state.album!.entries.filter(m=>m.item!=="fruit-leaf");
  expect(completedGameOutcome("snake-finish",before,result)?.keepsake).toBeUndefined();
});
