import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ButtonAudio } from './buttonAudio';

let audio: ButtonAudio;
let hidden = false;
class FakeContext {
  static instances: FakeContext[] = [];
  state: AudioContextState = 'running';
  currentTime = 12;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  notes: ReturnType<FakeContext['createNote']>[] = [];
  private createNote() {
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(() => gain), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as null | (() => void) };
    return { oscillator, gain };
  }
  createOscillator = vi.fn(() => { const note = this.createNote(); this.notes.push(note); return note.oscillator; });
  createGain = vi.fn(() => this.notes.at(-1)!.gain);
  constructor() { FakeContext.instances.push(this); }
}
const ctx = () => FakeContext.instances.at(-1)!;
async function suspended() {
  await audio.play(); ctx().notes.at(-1)!.oscillator.onended!();
  const context = ctx(); context.state = 'suspended';
  let resolve!: () => void, reject!: (error: Error) => void;
  context.resume.mockImplementationOnce(() => new Promise<void>((yes, no) => {
    resolve = () => { context.state = 'running'; yes(); }; reject = no;
  }));
  return { context, resolve: () => resolve(), reject: () => reject(new Error('blocked')) };
}
beforeEach(() => {
  FakeContext.instances = []; hidden = false;
  vi.stubGlobal('AudioContext', FakeContext); vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  audio = new ButtonAudio(); audio.setEnabled(true);
});
afterEach(() => { audio.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('defaults to silent and creates no audio context', async () => {
  const silent = new ButtonAudio(); await silent.play(); expect(FakeContext.instances).toHaveLength(0); silent.dispose();
});
it.each([false,true])('keeps the existing short, quiet key tone (confirm=%s)', async confirm => {
  await audio.play(confirm); const {oscillator,gain} = ctx().notes[0];
  expect(oscillator.frequency.value).toBe(confirm?740:520); expect(oscillator.type).toBe('sine');
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(.045,12);
  expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(.001,12.09);
  expect(oscillator.stop).toHaveBeenCalledWith(12.1); expect(ctx().resume).not.toHaveBeenCalled();
  oscillator.onended!(); expect(oscillator.disconnect).toHaveBeenCalledOnce(); expect(gain.disconnect).toHaveBeenCalledOnce();
});
it('does not schedule nodes before resume succeeds', async () => {
  const s=await suspended(), playing=audio.play(true); expect(s.context.notes).toHaveLength(1);
  s.resolve(); await playing; expect(s.context.notes).toHaveLength(2); expect(s.context.notes[1].oscillator.frequency.value).toBe(740);
});
it('contains a rejected resume and allows a later key to retry', async () => {
  const s=await suspended(), playing=audio.play(); s.reject(); await expect(playing).resolves.toBeUndefined();
  expect(s.context.notes).toHaveLength(1); await audio.play(); expect(s.context.resume).toHaveBeenCalledTimes(2); expect(s.context.notes).toHaveLength(2);
});
it('shares pending permission and only plays the latest key, not a burst', async () => {
  const s=await suspended(), a=audio.play(), b=audio.play(true), c=audio.play();
  expect(s.context.resume).toHaveBeenCalledOnce(); s.resolve(); await Promise.all([a,b,c]);
  expect(s.context.notes).toHaveLength(2); expect(s.context.notes[1].oscillator.frequency.value).toBe(520);
});
it.each(['mute','hide','cancel','dispose'])('does not replay a pending key after %s', async reason => {
  const s=await suspended(), playing=audio.play();
  if(reason==='mute') {audio.setEnabled(false);audio.setEnabled(true);}
  if(reason==='hide') hidden=true;
  if(reason==='cancel') audio.cancel();
  if(reason==='dispose') {audio.dispose();audio.setEnabled(true);}
  s.resolve(); await playing; expect(s.context.notes).toHaveLength(1);
});
it('muting immediately stops and disconnects a playing note', async () => {
  await audio.play(); const {oscillator,gain}=ctx().notes[0]; audio.setEnabled(false);
  expect(oscillator.stop).toHaveBeenCalledWith(); expect(oscillator.disconnect).toHaveBeenCalledOnce(); expect(gain.disconnect).toHaveBeenCalledOnce();
  await audio.play(); expect(ctx().notes).toHaveLength(1);
});
it('hidden presses cannot open an audio context', async () => {
  hidden=true; await audio.play(); expect(FakeContext.instances).toHaveLength(0);
});
it('suspends an unlocked context and resumes only after a later user key', async () => {
  await audio.play(); const context = ctx(); audio.suspend();
  expect(context.suspend).toHaveBeenCalledOnce(); expect(context.state).toBe('suspended');
  await audio.play(); expect(context.resume).toHaveBeenCalledOnce();
  expect(context.notes).toHaveLength(2);
});
it('contains a failed background suspend without affecting the next key', async () => {
  await audio.play(); const context = ctx(); context.suspend.mockRejectedValueOnce(Error('blocked'));
  expect(() => audio.suspend()).not.toThrow(); await Promise.resolve();
  await audio.play(); expect(context.resume).not.toHaveBeenCalled();
});
it('finishes a pending resume as suspended when backgrounding races it', async () => {
  const s = await suspended(); const playing = audio.play(); audio.suspend(); s.resolve(); await playing;
  expect(s.context.suspend).toHaveBeenCalledOnce(); expect(s.context.notes).toHaveLength(1);
  await audio.play(); expect(s.context.resume).toHaveBeenCalledTimes(2); expect(s.context.notes).toHaveLength(2);
});
it('disposal closes the owned context and later initialization can start cleanly', async () => {
  await audio.play(); const first=ctx(); audio.dispose(); expect(first.close).toHaveBeenCalledOnce();
  audio.setEnabled(true); await audio.play(); expect(FakeContext.instances).toHaveLength(2);
});
it('recreates an externally closed context on the next key', async () => {
  await audio.play(); ctx().state='closed'; await audio.play(); expect(FakeContext.instances).toHaveLength(2);
});
it.each(['missing','constructor','resume','oscillator','gain','start','stop','disconnect','close'])('isolates %s audio failure', async failure => {
  if(failure==='missing') vi.stubGlobal('AudioContext',undefined);
  else if(failure==='constructor') vi.stubGlobal('AudioContext',class {constructor(){throw Error('unavailable');}});
  else {
    await audio.play(); const context=ctx();
    if(failure==='resume') {context.state='suspended'; context.resume.mockImplementationOnce(()=>{throw Error('blocked');});}
    if(failure==='oscillator') context.createOscillator.mockImplementationOnce(()=>{throw Error('node');});
    if(failure==='gain') context.createGain.mockImplementationOnce(()=>{throw Error('node');});
    if(['start','stop','disconnect'].includes(failure)) {
      context.createOscillator.mockImplementationOnce(()=>{
        const note={...context.notes[0].oscillator, [failure]: vi.fn(()=>{throw Error('node');})};return note;
      });
    }
    if(failure==='close') context.close.mockRejectedValueOnce(Error('blocked close'));
  }
  await expect(audio.play()).resolves.toBeUndefined(); expect(()=>audio.dispose()).not.toThrow(); await Promise.resolve();
});
it('does not play if a resume resolves but the context remains suspended', async () => {
  await audio.play(); ctx().state='suspended';ctx().resume.mockResolvedValueOnce();await audio.play();expect(ctx().notes).toHaveLength(1);
});
it.each([250,251])('bounds delayed feedback to 250ms, including its boundary (%sms)', async delay => {
  const s=await suspended(), clock=vi.spyOn(performance,'now').mockReturnValue(0), playing=audio.play();
  clock.mockReturnValue(delay);s.resolve();await playing;expect(s.context.notes).toHaveLength(delay===250?2:1);
});
it('disconnects a partially created oscillator when gain creation fails', async () => {
  await audio.play();const context=ctx();context.createGain.mockImplementationOnce(()=>{throw Error('gain');});
  await audio.play();expect(context.notes[1].oscillator.disconnect).toHaveBeenCalledOnce();expect(context.notes[1].oscillator.start).not.toHaveBeenCalled();
});

it('replaces a still-playing key tone instead of stacking rapid feedback', async () => {
  await audio.play();
  const first = ctx().notes[0].oscillator;
  await audio.play(true);
  expect(first.stop).toHaveBeenCalledWith();
  expect(ctx().notes).toHaveLength(2);
  expect(ctx().notes[1].oscillator.frequency.value).toBe(740);
});


it('a bite cannot create a context or request permission', () => {
  audio.bite(); expect(FakeContext.instances).toHaveLength(0);
});
it('plays a distinct quiet bite tone only in an already-running context', async () => {
  await audio.play(); audio.bite();
  const { oscillator, gain } = ctx().notes[1];
  expect(oscillator.type).toBe('sine'); expect(oscillator.frequency.value).toBe(1040);
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(.03,12);
  expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(.001,12.12);
  expect(oscillator.stop).toHaveBeenCalledWith(12.14); expect(ctx().resume).not.toHaveBeenCalled();
  oscillator.onended!(); expect(oscillator.disconnect).toHaveBeenCalledOnce(); expect(gain.disconnect).toHaveBeenCalledOnce();
});
it.each(['mute','hide','suspended','closed','disposed'])('a bite stays silent when %s without resuming or replaying', async reason => {
  await audio.play(); const context=ctx();
  if(reason==='mute') audio.setEnabled(false);
  if(reason==='hide') hidden=true;
  if(reason==='suspended'||reason==='closed') context.state=reason;
  if(reason==='disposed') audio.dispose();
  audio.bite(); expect(context.notes).toHaveLength(1); expect(context.resume).not.toHaveBeenCalled();
  hidden=false; audio.setEnabled(true); context.state='running'; await Promise.resolve();
  expect(context.notes).toHaveLength(1); expect(FakeContext.instances).toHaveLength(1);
});
it('a bite does not wait for pending audio permission', async () => {
  const s=await suspended(), playing=audio.play(); audio.bite(); s.resolve(); await playing;
  expect(s.context.notes).toHaveLength(2); expect(s.context.notes[1].oscillator.frequency.value).toBe(520);
});
it('cancel stops a bite already playing', async () => {
  await audio.play(); audio.bite(); const note=ctx().notes[1]; audio.cancel();
  expect(note.oscillator.stop).toHaveBeenCalledWith(); expect(note.oscillator.disconnect).toHaveBeenCalledOnce(); expect(note.gain.disconnect).toHaveBeenCalledOnce();
});
it('replaces a repeated bite without changing key feedback', async () => {
  await audio.play(); audio.bite(); const first = ctx().notes[1].oscillator;
  audio.bite();
  expect(first.stop).toHaveBeenCalledWith();
  expect(ctx().notes).toHaveLength(3);
  expect(ctx().notes[2].oscillator.frequency.value).toBe(1040);
});
it.each(['oscillator','gain','start','stop'])('bite %s failures are optional and isolated', async failure => {
  await audio.play(); const context=ctx();
  if(failure==='oscillator') context.createOscillator.mockImplementationOnce(()=>{throw Error('node');});
  if(failure==='gain') context.createGain.mockImplementationOnce(()=>{throw Error('gain');});
  if(failure==='start'||failure==='stop') context.createOscillator.mockImplementationOnce(()=>({...context.notes[0].oscillator,[failure]:vi.fn(()=>{throw Error('node');})}));
  expect(()=>audio.bite()).not.toThrow();
});
