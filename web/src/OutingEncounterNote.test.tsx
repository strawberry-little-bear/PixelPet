import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FishingGame } from './FishingGame';
import { WalkingGame } from './WalkingGame';
import { emptyGrowth } from './growth';
import type { PetState } from './types';
afterEach(cleanup);
const at = Date.UTC(2026,9,20);
function fixture(kind: 'fishing'|'walk'): PetState {
 const id = kind==='fishing'?'00002400000000000000000000000001':'00001800000000000000000000000001';
 return {schema:14,revision:1,species:2,name:'伙伴',createdAt:at-2000,hatchedAt:at-2000,lastTick:at,sleeping:false,needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[],growth:emptyGrowth(),
 album:{since:at-2000,legacy:false,entries:[{kind:kind==='fishing'?'encounter-fishing-stars':'encounter-walk-kite',at,source:'shared',outingId:id}]},
 game:{id,kind,startedAt:at-1000,round:0,score:0,lastBeat:-1,
 ...(kind==='fishing'?{fishing:{spot:0,casts:1,catches:['reed-minnow'],phase:'result',step:3,waitMs:32000,elapsedMs:0,candidate:'reed-minnow',lastPulseAt:at,paused:true}}:
 {walking:{route:Array<'rock'>(12).fill('rock'),souvenirs:['leaf','shell','flower'],beat:24,step:25,cleared:0,pose:'',poseUntil:0,lastPulseAt:at,lastInputAt:0,paused:true}})}};
}
function view(pet:PetState,active=true) { return pet.game!.kind==='fishing'?<FishingGame pet={pet} active={active} choice={0}/>:<WalkingGame pet={pet} active={active} choice={0}/>; }
describe.each(['fishing','walk'] as const)('%s saved encounter summary',kind=>{
 it.each(['pause','inactive','done'] as const)('shows a read-only saved note at %s without changing the pet',phase=>{
  const p=fixture(kind);if(phase!=='pause'){if(p.game!.fishing){p.game!.fishing.paused=false;if(phase==='inactive')p.game!.fishing.phase='wait';if(phase==='done')p.game!.fishing.phase='done';}if(p.game!.walking){p.game!.walking.paused=false;if(phase==='done')p.game!.walking.beat=72;}}
  const before=structuredClone(p);const {container,rerender}=render(view(p,phase!=='inactive'));
  const note=container.querySelector('.outing-encounter');expect(note?.textContent).toContain('本局偶遇');expect(note?.textContent).toContain(kind==='fishing'?'星光涟漪':'晚霞纸鸢');expect(note?.textContent).toContain('已收进风景手记');
  expect(note?.querySelector('button,a,input,[aria-live]')).toBeNull();expect(note?.getAttribute('role')).toBeNull();rerender(view(structuredClone(p),phase!=='inactive'));expect(container.querySelectorAll('.outing-encounter')).toHaveLength(1);expect(p).toEqual(before);
 });
 it.each(['empty','different-session','wrong-kind','missing-id','wrong-source','before-session','future','legacy'] as const)('does not fabricate or borrow a summary: %s',mode=>{
  const p=fixture(kind),m=p.album!.entries[0];
  if(mode==='empty')p.album!.entries=[];if(mode==='different-session')m.outingId=m.outingId!.slice(0,31)+'2';if(mode==='wrong-kind')m.kind=kind==='fishing'?'encounter-walk-kite':'encounter-fishing-stars';if(mode==='missing-id')delete m.outingId;if(mode==='wrong-source')m.source='saved';if(mode==='before-session')m.at=p.game!.startedAt-1;if(mode==='future')m.at=at+1;if(mode==='legacy')p.schema=13;
  const {container}=render(view(p));expect(container.querySelector('.outing-encounter')).toBeNull();
 });
 it('treats a legacy nil album slice as an empty saved encounter list',()=>{
  const p=fixture(kind);p.album={...p.album!,entries:null} as unknown as PetState['album'];
  const {container}=render(view(p));expect(container.querySelector('.outing-encounter')).toBeNull();
 });
 it.each(['running','wait','bite'] as const)('does not compete with live controls: %s',phase=>{
  const p=fixture(kind);if(p.game!.fishing){p.game!.fishing.paused=false;p.game!.fishing.phase=phase==='running'?'result':phase;}if(p.game!.walking)p.game!.walking.paused=false;
  const {container}=render(view(p));expect(container.querySelector('.outing-encounter')).toBeNull();
 });
});
