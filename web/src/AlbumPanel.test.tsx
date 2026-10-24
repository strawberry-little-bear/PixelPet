import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AlbumDirectory, AlbumPanel, albumCategories, albumMemories, albumPageCount, memoryWords } from "./AlbumPanel";
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
 it.each(["balanced","lively","gentle","easygoing"] as const)("retains the saved %s adult form in its narrative and portrait", form => {
  const p=pet();p.album!.entries=[{kind:"adult",at:now,source:"shared",form}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(document.querySelector('[data-rig-stage="adult"]')).toBeTruthy();
  expect(screen.getByText(/模样已经定下/)).toBeTruthy();
  expect(document.querySelector(`[data-album-form="${form}"] .growth-form-emblem`)).toBeTruthy();
 });
 it("uses the current locked form only on the cover, and follows later synchronization", () => {
  const p=pet();p.growth={...emptyGrowth("adult"),form:"gentle"};
  const view=render(<AlbumPanel pet={p} now={now} page={0} />);
  expect(document.querySelector('[data-album-form="gentle"] .growth-form-emblem')).toBeTruthy();
  view.rerender(<AlbumPanel pet={{...p,growth:{...p.growth,form:"lively"}}} now={now} page={0} />);
  expect(document.querySelector('[data-album-form="lively"] .growth-form-emblem')).toBeTruthy();
  expect(document.querySelector('[data-album-form="gentle"]')).toBeNull();
 });
 it.each(["hatch","growing","meal"] as const)("does not put today's adult form on a %s memory", kind => {
  const p=pet();p.growth={...emptyGrowth("adult"),form:"gentle"};
  p.album!.entries=[{kind,at:now,source:"shared"}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(document.querySelector(".album-form")).toBeNull();
 });
 it("does not infer a missing recorded form from today's pet", () => {
  const p=pet();p.growth={...emptyGrowth("adult"),form:"gentle"};
  p.album!.entries=[{kind:"adult",at:now,source:"saved"}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(document.querySelector(".album-form")).toBeNull();
  expect(screen.getByText(/已经长成成年伙伴/)).toBeTruthy();
  expect(screen.queryByText(/均衡型|恬静型/)).toBeNull();
 });
 it("preserves the recorded form rather than replacing it with a different current form", () => {
  const p=pet();p.growth={...emptyGrowth("adult"),form:"gentle"};
  p.album!.entries=[{kind:"adult",at:now,source:"saved",form:"easygoing"}];
  render(<AlbumPanel pet={p} now={now} page={1} />);
  expect(document.querySelector('[data-album-form="easygoing"] .growth-form-emblem')).toBeTruthy();
  expect(document.querySelector('[data-album-form="gentle"]')).toBeNull();
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


describe("album categories", () => {
 it("partitions every kind once, keeping all cards including repeated elapsed milestones", () => {
  const p=pet();
  const groups={growth:["hatch","growing","adult"],care:["meal","bath","goodnight"],play:["stars","perfect-stars","tiles","snake","tetris","fishing","walk"],home:["outfit","decoration","wallpaper","floor"],days:["days","days"],scenery:["scenery-fishing-clear","scenery-fishing-cloud","scenery-fishing-rain","scenery-walk-clear","scenery-walk-cloud","scenery-walk-rain"]} as const;
  p.album!.entries=Object.values(groups).flat().map((kind,i)=>({kind,at:now-i*1000,source:kind==="days"?"elapsed":"shared",days:kind==="days"?i:undefined}));
  const before=structuredClone(p);
  for (const category of albumCategories.slice(1)) {
   expect(albumMemories(p,category.id).map(m=>m.kind).sort()).toEqual([...groups[category.id as keyof typeof groups]].sort());
   expect(albumPageCount(p,category.id)).toBe(groups[category.id as keyof typeof groups].length+1);
  }
  const partitions=albumCategories.slice(1).flatMap(c=>albumMemories(p,c.id));
  expect(partitions.sort((a,b)=>a.at-b.at)).toEqual(albumMemories(p));
  expect(p).toEqual(before);
 });
 it("shows directory navigation as noninteractive reading content, with a safe old-server notice", () => {
  const p=pet();delete p.album;
  render(<AlbumDirectory pet={p} choice={2} />);
  expect(screen.getByLabelText("纪念册分类")).toBeTruthy();
  expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("日常照顾");
  expect(document.querySelectorAll("li")).toHaveLength(7);
  expect(document.querySelector("button,a,input")).toBeNull();
  expect(screen.getByText(/纪念册尚未开启/)).toBeTruthy();
 });
 it("leaves empty categories empty and clamps a page after records become shorter", () => {
  const p=pet();render(<AlbumPanel pet={p} now={now} page={99} category="play" />);
  expect(screen.getByText("1 / 1")).toBeTruthy();
  expect(screen.getByText(/这里还没有留下回忆/)).toBeTruthy();
  expect(p.album!.entries).toHaveLength(1);
  expect(document.querySelector('[data-album-category="play"]')).toBeTruthy();
 });
 it("retains source labels and recorded adult form within filtered cards", () => {
  const p=pet();p.album!.legacy=true;p.album!.entries=[{kind:"adult",at:now,source:"saved",form:"gentle"},{kind:"days",at:now,source:"elapsed",days:7}];
  const {rerender}=render(<AlbumPanel pet={p} now={now} page={1} category="growth" />);
  expect(screen.getByText(/可能来自旧版迁移/)).toBeTruthy();
  expect(screen.getByText(/恬静型/)).toBeTruthy();
  rerender(<AlbumPanel pet={p} now={now} page={1} category="days" />);
  expect(screen.getByText(/不代表连续登录/)).toBeTruthy();
 });
 it("says 今天 instead of 相识 0 天 on the first day, and tolerates a live fractional clock", () => {
  const p=pet();p.hatchedAt=now-3600000;
  render(<AlbumPanel pet={p} now={now+0.6} page={0} category="play" />);
  expect(screen.getByText("今天刚刚相识")).toBeTruthy();
  expect(document.querySelector(".album-panel")?.textContent).not.toContain("相识 0 天");
 });
});
