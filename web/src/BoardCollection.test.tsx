import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnakeGame } from "./SnakeGame";
import { TetrisGame } from "./TetrisGame";
import type { PetState } from "./types";
const now = Date.parse("2026-10-21T12:00:00Z");
function fixture(kind: "snake" | "tetris"): PetState {
  return { schema:17, revision:1, species:2, name:"棋盘伙伴", createdAt:now-3600000, hatchedAt:now-3600000,
    lastTick:now, sleeping:false, needs:{hunger:80,mood:80,clean:80,energy:80}, careCount:0, logs:[],
    game:{ id:"collection-session", kind, startedAt:now, round:0,score:0,lastBeat:-1,
      ...(kind==="snake" ? { snake:{body:[{x:4,y:5},{x:3,y:5},{x:2,y:5}],food:{x:9,y:5},eaten:0,step:0,direction:0,paused:false,lastMoveAt:now} }
        : { tetris:{board:Array<number>(96).fill(0),active:{kind:3,rotation:0,x:2,y:0},next:1,bag:[4,5,6,7],lines:0,pieces:0,step:0,paused:false,lastFallAt:now} }) } };
}
function increase(pet:PetState) {
  const next=structuredClone(pet); next.revision++;
  if(next.game?.snake) next.game.snake.eaten++;
  if(next.game?.tetris) next.game.tetris.lines++;
  return next;
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe.each(["snake","tetris"] as const)("%s collection at a pause boundary",kind=>{
  const view=(pet:PetState,active:boolean)=>kind==="snake"?<SnakeGame pet={pet} now={now} active={active} turn={0}/>:<TetrisGame pet={pet} now={now} active={active} choice={0}/>;
  const collecting=()=>document.querySelector(`.${kind}-companion`)?.getAttribute("data-motion");
  it("clears an active pulse immediately when the local session stops, with no replay on resume",()=>{
    let pet=fixture(kind);const page=render(view(pet,true));pet=increase(pet);page.rerender(view(pet,true));
    expect(collecting()).toBe("collecting");page.rerender(view(pet,false));expect(collecting()).toBe("waiting");
    page.rerender(view(pet,true));expect(collecting()).toBe("waiting");
  });
  it("accepts a late saved count while locally paused without creating a pulse after resume",()=>{
    const pet=fixture(kind),page=render(view(pet,true));page.rerender(view(pet,false));
    const next=increase(pet);page.rerender(view(next,false));expect(collecting()).toBe("waiting");
    page.rerender(view(next,true));expect(collecting()).toBe("waiting");
    expect(document.querySelector(`.${kind}-game header`)?.textContent).toContain("1/8");
  });
  it("also respects the server pause flag when the local active flag has not yet changed",()=>{
    let pet=fixture(kind);const page=render(view(pet,true));pet=increase(pet);page.rerender(view(pet,true));
    expect(collecting()).toBe("collecting");pet=structuredClone(pet);
    (pet.game!.snake??pet.game!.tetris)!.paused=true;page.rerender(view(pet,true));expect(collecting()).toBe("waiting");
  });
  it("keeps an uninterrupted pulse for 900ms, and the next genuinely saved collection still works",async()=>{
    let pet=fixture(kind);const page=render(view(pet,true));expect(collecting()).toBe("waiting");
    pet=increase(pet);page.rerender(view(pet,true));expect(collecting()).toBe("collecting");
    await act(async()=>{await vi.advanceTimersByTimeAsync(899);});expect(collecting()).toBe("collecting");
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(collecting()).toBe("waiting");
    page.rerender(view(pet,false));page.rerender(view(pet,true));pet=increase(pet);page.rerender(view(pet,true));
    expect(collecting()).toBe("collecting");
  });
});
