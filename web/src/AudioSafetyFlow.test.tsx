import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { request } from './api';
import { emptyGrowth } from './growth';
import type { PetState } from './types';
vi.mock('./api',()=>({request:vi.fn()}));
const api=vi.mocked(request);
let saved: PetState, hidden=false, resolveResume: ()=>void;
class AudioStub {
  static instances: AudioStub[]=[];
  state='suspended';currentTime=1;destination={};
  resume=vi.fn(()=>new Promise<void>(resolve=>{resolveResume=()=>{this.state='running';resolve();};}));
  suspend=vi.fn(async()=>{this.state='suspended';});
  close=vi.fn(async()=>{this.state='closed';});
  gain={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};
  createGain=vi.fn(()=>this.gain);
  createOscillator=vi.fn(()=>({frequency:{value:0},connect:vi.fn(()=>this.gain),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),onended:null}));
  constructor(){AudioStub.instances.push(this);}
}
const context=()=>AudioStub.instances.at(-1)!;
async function key(key:string, init:KeyboardEventInit={}){await act(async()=>{fireEvent.keyDown(window,{key,...init});});}
async function mount(strict=false){await act(async()=>{render(strict?<StrictMode><App/></StrictMode>:<App/>);});}
async function toggle(){await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'关闭声音'}));});}
async function resume(){await act(async()=>{resolveResume();});}
const writes=()=>api.mock.calls.filter(([p])=>['action','import','reset','recap/read'].includes(p));
beforeEach(()=>{
  vi.useFakeTimers();localStorage.clear();localStorage.setItem('pixelpet-sound','on');api.mockReset();hidden=false;AudioStub.instances=[];
  vi.stubGlobal('AudioContext',AudioStub);vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  saved={schema:12,revision:1,species:2,name:'安静的小伙伴',createdAt:Date.now()-10000,hatchedAt:Date.now()-9000,lastTick:Date.now(),
    sleeping:false,needs:{hunger:60,mood:80,clean:60,energy:80},careCount:0,growth:emptyGrowth(),logs:[]};
  api.mockImplementation(async(path,body)=>{
    if(path==='action'&&(body as {kind:string}).kind==='feed'){saved.needs.hunger+=20;saved.careCount++;saved.revision++;}
    return {state:structuredClone(saved),message:'',serverTime:Date.now()};
  });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('keeps default-off silent, with no eager AudioContext or extra save',async()=>{
  localStorage.clear();await mount();await key('a');await key('b');expect(saved.careCount).toBe(1);expect(AudioStub.instances).toHaveLength(0);expect(writes()).toHaveLength(1);
});
it('does not await audio permission to navigate or save a confirmed care action',async()=>{
  await mount();await key('a');expect(document.querySelector('.content-menu')).toBeTruthy();expect(context().createOscillator).not.toHaveBeenCalled();
  await key('b');expect(saved.careCount).toBe(1);expect(writes()).toHaveLength(1);expect(context().resume).toHaveBeenCalledOnce();
  await resume();expect(context().createOscillator).toHaveBeenCalledOnce();
});
it('no delayed sound survives a mute/unmute, while three-key movement still works',async()=>{
  await mount();await key('a');const original=context();await toggle();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'打开声音'}));});
  await resume();expect(original.createOscillator).not.toHaveBeenCalled();await key('a');expect(original.createOscillator).toHaveBeenCalledOnce();expect(writes()).toHaveLength(0);
});
it('backgrounding cancels pending feedback even if the page is foreground again before permission arrives',async()=>{
  await mount();await key('a');hidden=true;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  hidden=false;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  await resume();expect(context().createOscillator).not.toHaveBeenCalled();await key('a');await resume();expect(context().createOscillator).toHaveBeenCalledOnce();expect(writes()).toHaveLength(0);
});
it('backgrounding suspends an unlocked context and the next key restores it',async()=>{
  await mount();await key('a');await resume();const audio=context();
  hidden=true;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  expect(audio.suspend).toHaveBeenCalledOnce();expect(audio.state).toBe('suspended');
  hidden=false;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  await key('a');await resume();expect(audio.resume).toHaveBeenCalledTimes(2);expect(audio.createOscillator).toHaveBeenCalledTimes(2);
});
it('rejected permission is contained, and the next key still confirms care exactly once',async()=>{
  await mount();await key('a');await resume();context().state='suspended';context().resume.mockRejectedValueOnce(Error('denied'));
  await key('b');expect(saved.careCount).toBe(1);expect(writes()).toHaveLength(1);expect(context().createOscillator).toHaveBeenCalledOnce();
});
it.each(['missing','constructor'])('plays normally without %s audio support',async failure=>{
  vi.stubGlobal('AudioContext',failure==='missing'?undefined:class{constructor(){throw Error('disabled');}});
  await mount();await key('a');await key('b');expect(saved.careCount).toBe(1);expect(writes()).toHaveLength(1);
});
it('closes owned audio on unmount without playing its pending note',async()=>{
  await mount();await key('a');const original=context();await act(async()=>{cleanup();});expect(original.close).toHaveBeenCalledOnce();await resume();expect(original.createOscillator).not.toHaveBeenCalled();
});
it('survives StrictMode effect teardown and keeps remembered sound preference',async()=>{
  await mount(true);await key('a');await resume();expect(context().createOscillator).toHaveBeenCalledOnce();expect(localStorage.getItem('pixelpet-sound')).toBe('on');await toggle();expect(localStorage.getItem('pixelpet-sound')).toBe('off');expect(writes()).toHaveLength(0);
});
it('ignored IME and repeat events create neither nodes nor contexts',async()=>{
  await mount();await key('a',{isComposing:true});await key('a',{repeat:true});expect(AudioStub.instances).toHaveLength(0);expect(writes()).toHaveLength(0);
});
