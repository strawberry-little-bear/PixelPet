import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlbumPanel, albumMemories, albumPageCount, memoryWords } from "./AlbumPanel";
import { emptyGrowth } from "./growth";
import type { Memory, PetState } from "./types";
afterEach(cleanup);
const now = Date.UTC(2026,9,18,12);
const pet = (): PetState => ({ schema:3, revision:1, species:2, name:"草莓兔", createdAt:now-86400000, hatchedAt:now-86400000, lastTick:now, needs:{hunger:80,mood:80,clean:80,energy:80}, sleeping:false, careCount:1, logs:[], growth:emptyGrowth("baby"), album:{since:now-86400000,legacy:false,entries:[{kind:"hatch",at:now-86400000,source:"shared"}]} });

describe("permanent album", () => {
 it("shows only collected memories, not a checklist or rewards", () => {
  const p=pet();render(<AlbumPanel pet={p} now={now} page={0} />);
  expect(screen.getByText("与你相识 1 天")).toBeTruthy();
  expect(screen.getByText("1 / 2")).toBeTruthy();
  expect(screen.getByText(/只收藏发生过的回忆/)).toBeTruthy();
  expect(document.querySelector("button")).toBeNull();
  expect(document.querySelector(".album-panel")?.textContent).not.toMatch(/解锁|领取|任务|签到/);
 });
 it("sorts a copy chronologically without changing the saved array", () => {
  const p=pet();p.album!.entries.unshift({kind:"meal",at:now,source:"shared"});
  const before=JSON.stringify(p);expect(albumMemories(p).map(m=>m.kind)).toEqual(["hatch","meal"]);
  expect(JSON.stringify(p)).toBe(before);expect(albumPageCount(p)).toBe(3);
 });
 it("labels old evolution time cautiously and does not invent historical care", () => {
  const p=pet();p.album!.legacy=true;p.album!.entries=[{kind:"growing",at:now,source:"saved"}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(screen.getByText(/可能来自旧版迁移/)).toBeTruthy();
  expect(document.querySelector('[data-rig-stage="growing"]')).toBeTruthy();
  expect(memoryWords({kind:"meal",at:now,source:"shared"},true).story).toContain("纪念册开启后记下的第一顿饭");
 });
 it("remembers zero-score companionship as warmly as a perfect game", () => {
  const p=pet();p.album!.entries=[{kind:"stars",at:now,source:"shared",score:0}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(screen.getByText(/接住了 0 颗/)).toBeTruthy();
  expect(screen.getByText(/记住的是一起玩/)).toBeTruthy();
 });
 it("distinguishes elapsed days from attendance", () => {
  const p=pet();p.album!.entries=[{kind:"days",at:now,source:"elapsed",days:7}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(screen.getByText("相识 7 天的小纪念")).toBeTruthy();
  expect(screen.getByText(/不代表连续登录/)).toBeTruthy();
  expect(screen.getByText(/不需要补上错过/)).toBeTruthy();
 });
 it.each(["balanced","lively","gentle","easygoing"] as const)("retains the %s adult form in its narrative", form => {
  const p=pet();p.album!.entries=[{kind:"adult",at:now,source:"shared",form}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(document.querySelector('[data-rig-stage="adult"]')).toBeTruthy();
  expect(screen.getByText(/模样已经定下/)).toBeTruthy();
 });
 it("handles a not-yet-upgraded server without fabricating cards", () => {
  const p=pet();delete p.album;p.schema=2;
  render(<AlbumPanel pet={p} now={now} page={0} />);
  expect(albumPageCount(p)).toBe(1);
  expect(screen.getByText(/纪念册尚未开启/)).toBeTruthy();
 });
 it("clamps the current card if another tab restores a shorter album", () => {
  render(<AlbumPanel pet={pet()} now={now} page={10} />);
  expect(screen.getByText("2 / 2")).toBeTruthy();
  expect(screen.getByText("小小的初次相遇")).toBeTruthy();
 });
 it("has warm copy for every recorded experience", () => {
  for(const kind of ["hatch","growing","adult","meal","bath","goodnight","stars","perfect-stars","days"] as Memory["kind"][]) {
   expect(memoryWords({kind,at:now,source:"shared",days:1000,score:5},false).story.length).toBeGreaterThan(12);
  }
 });
});
