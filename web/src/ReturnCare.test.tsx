import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ReturnPanel } from './ReturnPanel';
import { careAdvice } from './CareAdvice';
import { emptyGrowth } from './growth';
import type { PetState, ReturnRecap } from './types';

afterEach(cleanup);
const now = Date.now();
const base: PetState = { schema: 12, revision: 1, species: 2, name: '回来的伙伴', createdAt: now-10000, hatchedAt: now-9000,
  lastTick: now, sleeping: false, needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, growth: emptyGrowth(), careCount: 0, logs: [] };
const snapshot = { needs: { hunger: 10, mood: 80, clean: 80, energy: 100 }, stage: 'baby' as const, form: '' as const, points: 12, rest: 1, trackedHours: 1, sleeping: true };
const recap: ReturnRecap = { id: 'history', from: now-3600000, to: now-60000, before: snapshot, after: {...snapshot, points: 13} };
const modes = [
  { name: 'hungry', needs: {hunger:10}, sleeping:false },
  { name: 'dirty', needs: {clean:10}, sleeping:false },
  { name: 'tired', needs: {energy:10}, sleeping:false },
  { name: 'playful', needs: {mood:10}, sleeping:false },
  { name: 'comfortable', needs: {}, sleeping:false },
  { name: 'sleep hungry', needs: {hunger:10,energy:50}, sleeping:true },
  { name: 'sleep dirty', needs: {clean:10,energy:50}, sleeping:true },
  { name: 'sleep full', needs: {energy:100}, sleeping:true },
  { name: 'sleep restoring', needs: {energy:50}, sleeping:true },
];
for (const stage of ['baby','growing','adult'] as const) it.each(modes)(`${stage} $name reuses current advice, not historical needs`, ({needs,sleeping}) => {
  const pet = {...base, sleeping, needs: {...base.needs,...needs}, growth: emptyGrowth(stage)};
  if(stage==='adult') {pet.growth.points=72;pet.growth.form='gentle';}
  const history = structuredClone(recap), saved = structuredClone(pet);
  render(<ReturnPanel recap={recap} page={1} pet={pet} />);
  const advice=screen.getByLabelText('现在的照顾建议');
  expect(advice.textContent).toContain('现在怎么照顾');
  expect(advice.textContent).toContain(`最近读取：${sleeping?'正在睡觉':'清醒中'}`);
  expect(advice.textContent).toContain(careAdvice(pet));
  expect(advice.textContent).toContain('不是上方的历史记录');
  expect(advice.textContent).toContain('B / C 回小窝，再从菜单选择');
  expect(recap).toEqual(history);expect(pet).toEqual(saved);
  expect(document.querySelector('button,a,input')).toBeNull();
});
it('keeps the needs page historical and puts advice only on the last page',()=>{
  render(<ReturnPanel recap={recap} page={0} pet={base} />);
  expect(screen.queryByLabelText('现在的照顾建议')).toBeNull();
  expect(screen.getByLabelText('回访小结').textContent).toContain('10.0 → 10.0');
});
it('never substitutes recap needs when the current snapshot is unavailable',()=>{
  render(<ReturnPanel recap={recap} page={1}/>);
  expect(screen.getByLabelText('现在的照顾建议').textContent).toContain('当前状态尚未读到，回小窝后再查看。');
  expect(screen.queryByLabelText('照顾建议')).toBeNull();
});
it('updates current advice on a fresh read without rewriting saved sleep/needs',()=>{
  const {rerender}=render(<ReturnPanel recap={recap} page={1} pet={base}/>);
  const historical=screen.getByLabelText('历史睡眠状态').textContent;
  expect(screen.getByLabelText('照顾建议').textContent).toContain('很舒适');
  rerender(<ReturnPanel recap={recap} page={1} pet={{...base,sleeping:true,needs:{...base.needs,hunger:10}}}/>);
  expect(screen.getByLabelText('照顾建议').textContent).toContain('起床啦');
  expect(screen.getByLabelText('历史睡眠状态').textContent).toBe(historical);
});
it('uses legacy current needs even when growth was not supplied',()=>{
  const pet={...base,needs:{...base.needs,energy:10}};delete pet.growth;
  render(<ReturnPanel recap={recap} page={1} pet={pet}/>);
  expect(screen.getByLabelText('照顾建议').textContent).toContain('休息');
});
