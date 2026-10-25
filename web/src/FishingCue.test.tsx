import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { request } from './api';
import { RequestFailure } from './requestFailure';
import type { PetState, Result } from './types';
vi.mock('./api',()=>({request:vi.fn()}));
const api=vi.mocked(request), id='0123456789abcdef0123456789abcdef';
let saved:PetState, hidden=false, bite=true;
class AudioStub {
  static instances:AudioStub[]=[];
  state='running';currentTime=1;destination={};
  resume=vi.fn(async()=>{this.state='running';}); close=vi.fn(async()=>{this.state='closed';});
  gain={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};
  createGain=vi.fn(()=>this.gain);
  createOscillator=vi.fn(()=>({frequency:{value:0},type:'',connect:vi.fn(()=>this.gain),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),onended:null}));
  constructor(){AudioStub.instances.push(this);}
}
const context=()=>AudioStub.instances.at(-1)!;
const cues=()=>AudioStub.instances.flatMap(c=>c.createOscillator.mock.results.map(r=>r.value)).filter(n=>n.frequency.value===1040);
const result=():Result=>({state:structuredClone(saved),message:'',serverTime:Date.now()});
async function key(key:string){await act(async()=>{fireEvent.keyDown(window,{key});});}
async function clock(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function mount(phase:'ready'|'wait'|'bite'='ready'){
  saved.game!.fishing!.phase=phase; await act(async()=>{render(<App/>);});
}
async function cast(){await key('b');}
async function interrupt(reason:string){
  if(reason==='pause'||reason==='reel') await key(reason==='pause'?'c':'b');
  if(reason==='help'||reason==='tools') fireEvent.click(screen.getByRole('button',{name:reason==='help'?'玩法说明':/存档盒/}));
  if(reason==='hide'){hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
  if(reason==='blur') window.dispatchEvent(new Event('blur'));
  if(reason==='mute') fireEvent.click(screen.getByRole('button',{name:'关闭声音'}));
}
function pulse(){
  let deliver!:(r:Result)=>void, reject!:(e:Error)=>void;
  api.mockImplementationOnce(()=>new Promise<Result>((yes,no)=>{deliver=yes;reject=no;}));
  return {deliver:async(r:Result)=>{await act(async()=>{deliver(r);});},reject:async(e:Error)=>{await act(async()=>{reject(e);});}};
}
function makeBite(){saved.revision++;saved.game!.fishing!.step++;saved.game!.fishing!.phase='bite';saved.game!.fishing!.lastPulseAt=Date.now();return result();}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));localStorage.clear();localStorage.setItem('pixelpet-sound','on');
  hidden=false;bite=true;AudioStub.instances=[];api.mockReset();vi.stubGlobal('AudioContext',AudioStub);vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  saved={schema:13,revision:1,species:2,name:'鱼漂伙伴',createdAt:Date.now()-10000,hatchedAt:Date.now()-9000,lastTick:Date.now(),sleeping:false,
    needs:{hunger:80,mood:80,clean:80,energy:80},careCount:0,logs:[],game:{id,kind:'fishing',startedAt:Date.now()-1000,round:0,score:0,lastBeat:-1,
      fishing:{spot:0,casts:0,catches:[],phase:'ready',step:0,waitMs:32000,elapsedMs:0,candidate:'reed-minnow',lastPulseAt:Date.now(),paused:false}}};
  api.mockImplementation(async(path,body)=>{
    if(path==='action'){
      saved.revision++;const n=saved.game!.fishing!,kind=(body as {kind:string}).kind;n.step++;n.lastPulseAt=Date.now();
      if(kind==='fish-cast'){n.phase='wait';n.casts++;}
      if(kind==='fish-step'&&bite)n.phase='bite';
      if(kind==='fish-pause')n.paused=true;
      if(kind==='fish-resume')n.paused=false;
    }
    return result();
  });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('plays exactly once for a confirmed live wait-to-bite, never on later bite pulses',async()=>{
  await mount();await cast();expect(cues()).toHaveLength(0);await clock(1100);expect(cues()).toHaveLength(1);
  expect(document.querySelector('.fishing-bite')).toBeTruthy();await clock(2500);expect(cues()).toHaveLength(1);
  expect(saved.careCount).toBe(0);expect(saved.game!.fishing!.catches).toHaveLength(0);
});
it('does not invent a bite cue during wait',async()=>{bite=false;await mount();await cast();await clock(3500);expect(cues()).toHaveLength(0);});
it('default off never creates audio, while a real bite remains visible',async()=>{
  localStorage.clear();await mount();await cast();await clock(1100);expect(cues()).toHaveLength(0);expect(AudioStub.instances).toHaveLength(0);expect(document.querySelector('.fishing-bite')).toBeTruthy();
});
it.each(['bite','wait'] as const)('does not announce a saved %s on load or explicit resume',async phase=>{
  await mount(phase);expect(cues()).toHaveLength(0);await key('c');expect(cues()).toHaveLength(0);
  if(phase==='bite'){await clock(1100);expect(cues()).toHaveLength(0);}
});
it('polling a new bite cannot announce or automatically resume it',async()=>{
  await mount('wait');makeBite();await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  expect(cues()).toHaveLength(0);expect(document.querySelector('.fishing-pause')).toBeTruthy();
});
it.each(['help','tools','hide','blur','mute'])('a late bite after %s is silent',async reason=>{
  await mount();await cast();const pending=pulse();await clock(1100);const response=makeBite();
  await act(async()=>{await interrupt(reason);});await pending.deliver(response);expect(cues()).toHaveLength(0);
  if(reason!=='mute') expect(document.querySelector('.fishing-bite-announcement')?.textContent ?? '').toBe('');
});
it.each(['help','tools','hide','blur','mute','pause','reel'])('interrupting with %s cancels a currently playing bite',async reason=>{
  await mount();await cast();await clock(1100);const cue=cues()[0];expect(cue).toBeTruthy();
  await act(async()=>{await interrupt(reason);});expect(cue.stop).toHaveBeenCalledWith();expect(cue.disconnect).toHaveBeenCalled();
});
it.each(['suspended','closed'])('a %s audio context is not resumed or replaced by an automatic bite',async state=>{
  await mount();await cast();const original=context();original.state=state;await clock(1100);
  expect(cues()).toHaveLength(0);expect(original.resume).not.toHaveBeenCalled();expect(AudioStub.instances).toHaveLength(1);
});
it('an unknown pulse and successful reconciliation never replay a saved bite',async()=>{
  await mount();await cast();const pending=pulse();await clock(1100);makeBite();api.mockRejectedValueOnce(new RequestFailure('offline','unavailable'));await pending.reject(new RequestFailure('lost','unknown'));
  expect(document.querySelector('.save-recovery')).toBeTruthy();
  await key('b');expect(cues()).toHaveLength(0);expect(document.querySelector('.fishing-pause')).toBeTruthy();
});
it('a response from a different session cannot announce a bite',async()=>{
  await mount();await cast();const pending=pulse();await clock(1100);const response=makeBite();response.state.game!.id='f'.repeat(32);
  await pending.deliver(response);expect(cues()).toHaveLength(0);
});

it.each([1500,1501])('bounds cue freshness after a delayed live reply (%sms)',async delay=>{
  await mount();await cast();const time=vi.spyOn(performance,'now').mockReturnValue(0),pending=pulse();await clock(1100);
  const response=makeBite();time.mockReturnValue(delay);await pending.deliver(response);expect(cues()).toHaveLength(delay===1500?1:0);
});
it('unmuting after a silent bite does not replay it on subsequent pulses',async()=>{
  localStorage.clear();await mount();await cast();await clock(1100);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'打开声音'}));});
  await clock(1100);expect(cues()).toHaveLength(0);expect(AudioStub.instances).toHaveLength(0);
});
it('resuming an existing bite does not repeat its cue',async()=>{
  await mount();await cast();await clock(1100);expect(cues()).toHaveLength(1);
  await key('c');await key('c');await clock(1100);expect(cues()).toHaveLength(1);
});
it('after resuming a saved wait, a new confirmed bite may sound once',async()=>{
  await mount('wait');await key('c');expect(cues()).toHaveLength(0);await clock(1100);expect(cues()).toHaveLength(1);
});
it('explains optional cues on the existing sound toggle without adding LCD controls',async()=>{
  await mount();expect(screen.getByRole('button',{name:'关闭声音'}).getAttribute('aria-describedby')).toBe('sound-description');
  expect(document.getElementById('sound-description')?.textContent).toContain('静音不影响文字提示和三键游玩');
  expect(document.querySelectorAll('.physical-button')).toHaveLength(3);expect(document.querySelector('.lcd button,.lcd a,.lcd input')).toBeNull();
});
