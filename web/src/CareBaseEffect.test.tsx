import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CarePreview, careBaseEffect } from './CarePreview';
import { validCareRules } from './StatusGuide';
import { emptyGrowth } from './growth';
import type { CareRules, PetState } from './types';
const rules:CareRules={awake:{hunger:-3,mood:-2.5,clean:-2,energy:-2},sleeping:{hunger:-3,mood:0,clean:-2,energy:14},maxOfflineHours:12,
 actions:{feed:{hunger:20,mood:3,clean:-3,energy:0},clean:{hunger:0,mood:4,clean:35,energy:0}}};
const pet=():PetState=>({schema:12,revision:1,species:2,name:'照顾基准',createdAt:1,hatchedAt:1,lastTick:Date.now(),sleeping:false,
 needs:{hunger:60,mood:99,clean:60,energy:80},careCount:0,growth:emptyGrowth(),logs:[]});
afterEach(cleanup);
for(const stage of ['baby','growing','adult'] as const)it.each(['feed','clean'] as const)(`${stage} %s displays authoritative base deltas without predicting growth`,kind=>{
 const p=pet();p.growth=emptyGrowth(stage);if(stage==='adult'){p.growth.form='gentle';p.growth.points=72;}
 const before=structuredClone(p),r=structuredClone(rules);
 render(<CarePreview pet={p} kind={kind} hint="" rules={rules}/>);
 const section=screen.getByLabelText('本次照顾的基准变化');
 expect(section.querySelector('[data-need="hunger"] dd')?.textContent).toBe(kind==='feed'?'+20':'不变');
 expect(section.querySelector('[data-need="mood"] dd')?.textContent).toBe(kind==='feed'?'+3':'+4');
 expect(section.querySelector('[data-need="clean"] dd')?.textContent).toBe(kind==='feed'?'−3':'+35');
 expect(section.querySelector('[data-need="energy"] dd')?.textContent).toBe('不变');
 expect(section.textContent).toContain('各项到 0 / 100 为止');expect(section.textContent).toContain('不是操作后的预测');expect(section.textContent).toContain('不含时间结算');
 expect(p).toEqual(before);expect(rules).toEqual(r);expect(document.querySelector('button,a,input')).toBeNull();
});
it.each(['feed','clean'] as const)('reads supplied %s numbers, not a duplicate client table',kind=>{
 const r=structuredClone(rules);r.actions![kind].mood=1.25;
 render(<CarePreview pet={pet()} kind={kind} hint="" rules={r}/>);
 expect(screen.getByLabelText('本次照顾的基准变化').querySelector('[data-need="mood"] dd')?.textContent).toBe('+1.25');
});
it.each(['egg','sleeping','game','full-feed','full-clean','sleep','menu'])('does not imply an instant action result for %s',mode=>{
 const p=pet();let kind='feed';
 if(mode==='egg')p.hatchedAt=0;if(mode==='sleeping')p.sleeping=true;
 if(mode==='game')p.game={startedAt:Date.now(),round:0,score:0,lastBeat:-1};
 if(mode==='full-feed')p.needs.hunger=96;if(mode==='full-clean'){kind='clean';p.needs.clean=99;}
 if(mode==='sleep')kind='sleep';if(mode==='menu')kind='growth';
 render(<CarePreview pet={p} kind={kind} hint="菜单说明" rules={rules}/>);
 expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
});
it.each([undefined,null,{},[],{feed:null},{feed:{}},{feed:{...rules.actions!.feed,mood:NaN}},
 {feed:{...rules.actions!.feed,mood:Infinity}},{feed:{...rules.actions!.feed,mood:'3'}},
 {feed:{...rules.actions!.feed,mood:101}},{feed:{...rules.actions!.feed,clean:-101}},
])('keeps legacy preview text and passive metadata when action metadata is absent/invalid (%j)',actions=>{
 const r={...rules,actions} as unknown as CareRules;
 expect(validCareRules(r)).toBe(true);expect(careBaseEffect(pet(),'feed',r)).toBeNull();
 render(<CarePreview pet={pet()} kind="feed" hint="" rules={r}/>);
 expect(screen.getByLabelText('所选菜单说明').textContent).toContain('补充饱食');expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();
});
it('does not discard a valid selected action just because another optional action is missing',()=>{
 const r={...rules,actions:{feed:rules.actions!.feed}} as CareRules;
 expect(careBaseEffect(pet(),'feed',r)).toEqual(rules.actions!.feed);expect(careBaseEffect(pet(),'clean',r)).toBeNull();
});
it('shows base deltas in the cooldown too, without promising habit credit',()=>{
 const p=pet();p.growth!.care.lastFeed=p.lastTick-100;
 render(<CarePreview pet={p} kind="feed" hint="" rules={rules}/>);
 expect(screen.getByLabelText('本次照顾的基准变化')).toBeTruthy();expect(screen.getByLabelText('所选菜单说明').textContent).toContain('间隔内');
 expect(screen.getByLabelText('所选菜单说明').textContent).toContain('是否记习惯以实际结果为准');
});
it('supports legacy current growth and absent rule books without inventing numbers',()=>{
 const p=pet();delete p.growth;const {rerender}=render(<CarePreview pet={p} kind="feed" hint=""/>);
 expect(screen.queryByLabelText('本次照顾的基准变化')).toBeNull();rerender(<CarePreview pet={p} kind="feed" hint="" rules={rules}/>);
 expect(screen.getByLabelText('本次照顾的基准变化')).toBeTruthy();expect(screen.getByLabelText('所选菜单说明').textContent).toContain('成长记录尚未读到');
});
