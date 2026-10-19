import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReturnPanel } from './ReturnPanel';
import type { ReturnRecap } from './types';

afterEach(cleanup);
const snapshot = { needs: { hunger: 80, mood: 80, clean: 80, energy: 80 }, stage: 'baby' as const, form: '' as const, points: 1, rest: 0, trackedHours: 0 };
const recap: ReturnRecap = { id: 'sleep-history', from: 1, to: 3600001, before: snapshot, after: snapshot };
it.each([0,1])('page %s records true and false as distinct historical endpoints', page => {
 const { rerender } = render(<ReturnPanel recap={{...recap, before: {...snapshot,sleeping:true},after:{...snapshot,sleeping:false}}} page={page}/>);
 const context = screen.getByLabelText('历史睡眠状态');
 expect(context.textContent).toContain('离开时：睡眠');
 expect(context.textContent).toContain('结算结束时：清醒');
 expect(context.textContent).toContain('仅为两个时点的记录，不代表当前状态或整个离开期间。');
 rerender(<ReturnPanel recap={{...recap, before:{...snapshot,sleeping:false},after:{...snapshot,sleeping:true}}} page={page}/>);
 expect(context.textContent).toContain('离开时：清醒'); expect(context.textContent).toContain('结算结束时：睡眠');
 expect(document.querySelector('button,a,input')).toBeNull();
});
it.each([0,1])('page %s does not infer legacy mode from energy recovery', page => {
 render(<ReturnPanel recap={{...recap, after:{...snapshot,needs:{...snapshot.needs,energy:100}}}} page={page}/>);
 const context = screen.getByLabelText('历史睡眠状态');
 expect(context.textContent).toContain('离开时：未记录'); expect(context.textContent).toContain('结算结束时：未记录');
 expect(context.textContent).toContain('旧记录缺失的信息不作推测。');
});
it.each([0,1])('page %s preserves a partial legacy baseline without hiding the known endpoint', page => {
 render(<ReturnPanel recap={{...recap,after:{...snapshot,sleeping:false}}} page={page}/>);
 const context = screen.getByLabelText('历史睡眠状态');
 expect(context.textContent).toContain('离开时：未记录'); expect(context.textContent).toContain('结算结束时：清醒');
});
it.each([0,1])('page %s retains its stored endpoints during unrelated rerender', page => {
 const saved = {...recap,before:{...snapshot,sleeping:true},after:{...snapshot,sleeping:true}};
 const { rerender } = render(<ReturnPanel recap={saved} page={page}/>);
 const previous = screen.getByLabelText('历史睡眠状态').textContent;
 rerender(<ReturnPanel recap={saved} page={page} updated/>);
 expect(screen.getByLabelText('历史睡眠状态').textContent).toBe(previous);
});
