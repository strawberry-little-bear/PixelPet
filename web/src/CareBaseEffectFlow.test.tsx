import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { request } from './api';
import { RequestFailure } from './requestFailure';
import { emptyGrowth } from './growth';
import type { CareRules, PetState, Result } from './types';
vi.mock('./api',()=>({request:vi.fn()}));const api=vi.mocked(request);
let saved:PetState,rules:CareRules|undefined;
const result=():Result=>({state:structuredClone(saved),serverTime:Date.now(),message:'',careRules:structuredClone(rules)});
const writes=()=>api.mock.calls.filter(([p])=>['action','import','reset','recap/read'].includes(p));
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key});});}
async function sync(){await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});}
async function mount(){await act(async()=>{render(<App/>);});await key('a');}
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();api.mockReset();const now=Date.now();saved={schema:12,revision:10,species:2,name:'照顾说明',createdAt:now-10000,hatchedAt:now-9000,lastTick:now,
 sleeping:false,needs:{hunger:95,mood:99,clean:98,energy:80},careCount:0,growth:emptyGrowth(),logs:[]};
 rules={awake:{hunger:-3,mood:-2.5,clean:-2,energy:-2},sleeping:{hunger:-3,mood:0,clean:-2,energy:14},maxOfflineHours:12,actions:{feed:{hunger:20,mood:3,clean:-3,energy:0},clean:{hunger:0,mood:4,clean:35,energy:0}}};
 api.mockImplementation(async(path,body)=>{if(path==='action'&&(body as {kind:string}).kind==='feed'){saved.needs.hunger=100;saved.needs.mood=100;saved.needs.clean-=3;saved.careCount++;saved.revision++;}return result();});
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('browses base effects without writing, then only B confirms actual clamped care',async()=>{
 await mount();expect(screen.getByLabelText('本次照顾的基准变化').textContent).toContain('+20');expect(writes()).toHaveLength(0);expect(saved.needs.hunger).toBe(95);
 await key('b');expect(saved.needs.hunger).toBe(100);expect(saved.needs.mood).toBe(100);expect(saved.careCount).toBe(1);expect(writes()).toHaveLength(1);
});
it('accepted new metadata updates, stale replies do not roll the numeric guide back',async()=>{
 await mount();const stale=result();rules!.actions!.feed.hunger=10;saved.revision++;await sync();
 expect(screen.getByLabelText('本次照顾的基准变化').textContent).toContain('+10');api.mockResolvedValueOnce(stale);await sync();
 expect(screen.getByLabelText('本次照顾的基准变化').textContent).toContain('+10');expect(writes()).toHaveLength(0);
});
it('omitted metadata clears old numbers, with legacy text still available',async()=>{
 await mount();rules=undefined;saved.revision++;await sync();expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
 expect(screen.getByLabelText('所选菜单说明').textContent).toContain('补充饱食');expect(writes()).toHaveLength(0);
});
it('current full and sleep snapshots remove effects, without auto care or wake',async()=>{
 await mount();saved.needs.hunger=100;saved.revision++;await sync();expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
 saved.needs.hunger=60;saved.sleeping=true;saved.revision++;await sync();expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
 expect(screen.getByLabelText('所选菜单说明').textContent).toContain('先选「起床啦」');expect(writes()).toHaveLength(0);
});
it('failed reads hide cached numeric effects until explicit read recovery',async()=>{
 await mount();api.mockRejectedValueOnce(new RequestFailure('断线','unavailable'));await sync();expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
 await key('b');expect(screen.getByLabelText('本次照顾的基准变化')).toBeTruthy();expect(writes()).toHaveLength(0);
});
