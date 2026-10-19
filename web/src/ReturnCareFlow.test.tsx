import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { request } from './api';
import { RequestFailure } from './requestFailure';
import { emptyGrowth } from './growth';
import type { PetState, Result, ReturnRecap } from './types';

vi.mock('./api', () => ({request:vi.fn()}));
const api=vi.mocked(request);
let saved:PetState, recap:ReturnRecap, pending:boolean, generation:string;
const result=():Result=>({state:structuredClone(saved),serverTime:Date.now(),message:'',saveGeneration:generation,
  returnRecap:structuredClone(recap),recapPending:pending});
const writes=()=>api.mock.calls.filter(([p])=>['action','import','reset','recap/read'].includes(p));
const advice=()=>screen.getByLabelText('现在的照顾建议').textContent;
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key});});}
async function mount(){await act(async()=>{render(<App/>);});}
async function review(){await key('a');for(let i=0;i<7;i++)await key('a');await key('b');await key('a');}
async function sync(){await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});}
const counter=()=>document.querySelector('.return-panel header span')?.textContent;
beforeEach(()=>{
  vi.useFakeTimers();localStorage.clear();api.mockReset();pending=false;generation='a'.repeat(32);
  const now=Date.now();saved={schema:12,revision:10,species:2,name:'回访照顾',createdAt:now-10000,hatchedAt:now-9000,
    lastTick:now,sleeping:false,needs:{hunger:10,mood:80,clean:80,energy:80},growth:emptyGrowth(),careCount:0,logs:[]};
  const snapshot={needs:{hunger:80,mood:80,clean:10,energy:100},stage:'baby' as const,form:'' as const,points:12,rest:1,trackedHours:1,sleeping:true};
  recap={id:'last',from:now-3600000,to:now-60000,before:snapshot,after:{...snapshot,points:13}};
  api.mockImplementation(async(path,body)=>{
    if(path==='recap/read'){pending=false;return {...result(),recapClaimed:true};}
    if(path==='action'&&(body as {kind:string}).kind==='feed'){saved.needs.hunger+=24;saved.careCount++;saved.revision++;}
    return result();
  });
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it.each([false,true])('manual/automatic reading never acts on the advice (automatic=%s)',async automatic=>{
  pending=automatic;const history=structuredClone(recap);await mount();if(automatic)await key('b');else await review();
  expect(counter()).toBe('2 / 2');expect(advice()).toContain('吃点东西');expect(advice()).toContain('清醒中');
  expect(screen.getByLabelText('历史睡眠状态').textContent).toContain('结算结束时：睡眠');
  await key('a');expect(counter()).toBe('1 / 2');expect(screen.queryByLabelText('现在的照顾建议')).toBeNull();
  await key('b');await key('b');expect(document.querySelector('.content-home')).toBeTruthy();
  expect(writes().map(([p])=>p)).toEqual(automatic?['recap/read']:[]);expect(recap).toEqual(history);expect(saved.careCount).toBe(0);
});
it('refreshes advice from accepted same-record current reads but keeps page/history',async()=>{
  await mount();await review();const history=structuredClone(recap);expect(advice()).toContain('吃点东西');
  saved.needs.hunger=80;saved.needs.energy=10;saved.revision++;await sync();
  expect(counter()).toBe('2 / 2');expect(advice()).toContain('适合休息');
  saved.sleeping=true;saved.needs.energy=100;saved.revision++;await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(advice()).toContain('体力已满');expect(advice()).toContain('起床啦');expect(advice()).toContain('正在睡觉');
  expect(recap).toEqual(history);expect(writes()).toHaveLength(0);
});
it('does not use a stale reply to roll current advice back',async()=>{
  await mount();await review();const stale=result();stale.state.revision--;stale.state.needs.hunger=80;stale.state.needs.energy=10;
  api.mockResolvedValueOnce(stale);await sync();expect(counter()).toBe('2 / 2');expect(advice()).toContain('吃点东西');expect(writes()).toHaveLength(0);
});
it('a replaced recap goes back to page one, with advice only after continuing',async()=>{
  await mount();await review();recap={...recap,id:'new'};saved.needs.hunger=80;saved.needs.clean=10;saved.revision++;await sync();
  expect(counter()).toBe('1 / 2');expect(screen.queryByLabelText('现在的照顾建议')).toBeNull();
  await key('b');expect(advice()).toContain('适合洗澡');expect(writes()).toHaveLength(0);
});
it('failed read removes actionable advice until explicit read recovery',async()=>{
  await mount();await review();api.mockRejectedValueOnce(new RequestFailure('离线','unavailable'));await sync();
  expect(screen.queryByLabelText('现在的照顾建议')).toBeNull();expect(document.querySelector('.save-recovery')).toBeTruthy();
  await key('b');expect(counter()).toBe('2 / 2');expect(advice()).toContain('吃点东西');
  expect(writes()).toHaveLength(0);
});
it('following the suggestion requires returning and explicitly confirming a menu action',async()=>{
  await mount();await review();await key('b');expect(saved.careCount).toBe(0);await key('a');expect(saved.careCount).toBe(0);
  await key('b');expect(saved.careCount).toBe(1);expect(writes().map(([p])=>p)).toEqual(['action']);
  await key('c');await review();expect(recap.after.needs.hunger).toBe(80);expect(saved.needs.hunger).toBe(34);
});
