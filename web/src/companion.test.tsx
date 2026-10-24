import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { games } from "./games";
import { companionCompletionTotal, completedExperience, experienceWords, interestCue, interestSummary, recordNewDiscoveries, takeDiscoveryEcho } from "./companion";
import { CompanionPanel } from "./CompanionPanel";
import { PetScene } from "./PetScene";
import type { Companion, GameExperience } from "./types";
afterEach(cleanup);
const fresh = (): Companion => ({ since: 1792310000000, interests: games.map(g => ({kind:g.id,points:0,lastAt:0})) });
describe("bounded explainable shared interests", () => {
  it("does not infer old history or demand a fixed game", () => {
    const c=fresh(),before=structuredClone(c);
    const {container,rerender}=render(<CompanionPanel companion={c}/>);
    expect(container.textContent).toContain("还在慢慢了解彼此");
    expect(container.querySelectorAll('[data-points="0"]')).toHaveLength(games.length);
    expect(container.textContent).toContain("同一游戏间隔 30 分钟，每种最多记 5 次");
    expect(container.textContent).toContain("满额金币也会记住");
    expect(container.textContent).toContain("不补写旧经历");
    expect(container.querySelectorAll('button,a,input,[role="button"]')).toHaveLength(0);
    rerender(<CompanionPanel/>);expect(container.textContent).toContain("更新服务后");
    expect(c).toEqual(before);
  });
  it("explains ties and capped familiarity without rewriting personality", () => {
    const c=fresh();c.interests[0].points=1;expect(interestSummary(c)).toContain("还在慢慢");
    c.interests[0].points=5;expect(interestSummary(c)).toContain("更熟悉接星星");
    expect(interestSummary(c)).toContain("不是固定性格");
    c.interests[1].points=5;expect(interestSummary(c)).toContain("不止一种");
    const {container}=render(<CompanionPanel companion={c}/>);
    expect(container.querySelector('[data-interest="stars"]')?.getAttribute('data-points')).toBe("5");
  });
  it("ignores malformed familiarity values in the explanation", () => {
    const c = fresh();
    c.interests[0].points = 6;
    c.interests[1].points = 2.5;
    c.interests[2].points = -1;
    expect(interestSummary(c)).toBe("还在慢慢了解彼此，玩喜欢的就好。");
  });
  it("turns one meaningful shared interest into a passive quiet cue", () => {
    const c = fresh();
    c.interests.find(entry => entry.kind === "fishing")!.points = 2;
    expect(interestCue(c)).toEqual({ kind: "fishing", text: "它已经很熟悉池塘边的等待，发呆时也会听一会儿水声。" });
    c.interests.find(entry => entry.kind === "walk")!.points = 2;
    expect(interestCue(c)).toBeNull();
  });
  it("does not create a quiet cue before familiarity is meaningful or from malformed data", () => {
    const c = fresh();
    c.interests[0].points = 1;
    expect(interestCue(c)).toBeNull();
    c.interests[0].points = 2.5;
    expect(interestCue(c)).toBeNull();
  });
  it("shows the saved total only for a complete ordered game history", () => {
    const c = fresh();
    expect(companionCompletionTotal(c)).toBeNull();
    c.history = { since: c.since, completions: games.map((game, index) => ({ kind: game.id, count: index })) };
    expect(companionCompletionTotal(c)).toBe("21");
    const { container } = render(<CompanionPanel companion={c} />);
    expect(container.querySelector('[aria-label="共同游戏完成总数"]')?.textContent).toContain("共同完成 21 局");
  });

  it("does not invent a total from malformed or partial history", () => {
    const c = fresh();
    c.history = { since: c.since, completions: games.slice(0, -1).map((game) => ({ kind: game.id, count: 3 })) };
    expect(companionCompletionTotal(c)).toBeNull();
    const { container } = render(<CompanionPanel companion={c} />);
    expect(container.querySelector('[aria-label="共同游戏完成总数"]')).toBeNull();
  });
  it("requires this local settled session, feedback, and one-time delivery", () => {
    const x: GameExperience={kind:"stars",id:"saved-session",at:1},seen=new Set<string>();
    expect(completedExperience(undefined,x,true,seen)).toBeNull();
    expect(completedExperience("different",x,true,seen)).toBeNull();
    expect(completedExperience(x.id,x,false,seen)).toBeNull();
    expect(completedExperience(x.id,undefined,true,seen)).toBeNull();
    expect(completedExperience(x.id,x,true,seen)).toEqual(x);
    expect(completedExperience(x.id,x,true,seen)).toBeNull();
    for(let i=0;i<50;i++)completedExperience(`${i}`,{...x,id:`${i}`},true,seen);
    expect(seen.size).toBe(16);
  });
});
describe("home echoes respect anatomy and care priority", () => {
  it.each(games.map(g=>g.id))("renders %s only as a passive finite home response", echo => {
    for(let index=0;index<10;index++) for(const stage of ["baby","growing","adult"] as const){
      const {container,unmount}=render(<PetScene index={index} stage={stage} motion="idle" echo={echo} need="content" clipId={0} dirty={false} equipped={{accessory:"sky-bow",room:"moon-lamp",wallpaper:"starlit-wall",floor:"mint-floor"}}/>);
      expect(container.querySelector('.pet-scene')?.getAttribute('data-echo')).toBe(echo);
      expect(container.querySelector('.pet-scene')?.getAttribute('aria-label')).toContain(experienceWords[echo]);
      expect(container.querySelectorAll('.pet-sprite')).toHaveLength(1);
      expect(container.querySelectorAll('.equipped-accessory')).toHaveLength(1);
      expect(container.querySelectorAll('.room-surface')).toHaveLength(2);
      expect(container.querySelectorAll('.home-game-token')).toHaveLength(1);
      expect(container.querySelectorAll('button,[role="button"]')).toHaveLength(0);
      unmount();
    }
  });
  it.each(["hungry","tired","dirty"] as const)("never covers a %s signal", need=>{
    const {container}=render(<PetScene index={3} motion="idle" echo="fishing" need={need} clipId={0} dirty/>);
    expect(container.querySelector('[data-echo]')).toBeNull();
    expect(container.querySelector('[data-need]')?.getAttribute('data-need')).toBe(need);
  });
  it.each(["eating","bathing","sleeping","waking","celebrating"] as const)("never intrudes on %s",motion=>{
    const {container}=render(<PetScene index={2} motion={motion} echo="stars" clipId={1} dirty={false}/>);
    expect(container.querySelector('[data-echo]')).toBeNull();expect(container.querySelector('.home-game-token')).toBeNull();
  });
});

describe("discovery echoes stay local to a real outing", () => {
  const found = (id: string) => ({ id, firstAt: 1, lastAt: 1, count: 1 });
  it("records a first fish or park item, ignores repeat counts, and consumes once", () => {
    const pending = new Map<string, "fish-discovery" | "park-discovery">();
    const seen = new Set<string>();
    expect(recordNewDiscoveries("fish", "fishing-session", [], [found("sun-carp")], pending, seen)).toBe(true);
    expect(recordNewDiscoveries("fish", "fishing-session", [found("sun-carp")], [{ ...found("sun-carp"), count: 2 }], pending, seen)).toBe(false);
    expect(takeDiscoveryEcho("fish", "fishing-session", pending)).toBe("fish-discovery");
    expect(takeDiscoveryEcho("fish", "fishing-session", pending)).toBeNull();
    expect(recordNewDiscoveries("park", "walk-session", [], [found("leaf")], pending, seen)).toBe(true);
    expect(takeDiscoveryEcho("park", "walk-session", pending)).toBe("park-discovery");
  });
  it("does not infer a discovery when there is no local session", () => {
    const pending = new Map<string, "fish-discovery" | "park-discovery">();
    const seen = new Set<string>();
    expect(recordNewDiscoveries("fish", undefined, [], [found("sun-carp")], pending, seen)).toBe(false);
    expect(pending.size).toBe(0);
  });
});
