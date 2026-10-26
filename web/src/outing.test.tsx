import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { outingScenery } from './outing';
import { OutingCaption, OutingSky } from './OutingScenery';
import { FishingGame } from './FishingGame';
import { WalkingGame } from './WalkingGame';
import { emptyGrowth } from './growth';
import type { PetState, Fishing, Walking } from './types';

const session = (index = 0, kind: 'fishing' | 'walk' = 'fishing'): NonNullable<PetState['game']> => ({
  id: index.toString(16).padStart(6, '0') + '0'.repeat(26), kind,
  startedAt: 1, round: 0, score: 0, lastBeat: -1,
});
const fish = (): Fishing => ({ spot: 0, casts: 0, catches: [], phase: 'ready', step: 0, waitMs: 32000,
  elapsedMs: 0, candidate: 'reed-minnow', lastPulseAt: 1, paused: false });
const walk = (): Walking => ({ route: Array(12).fill('rock'), souvenirs: ['leaf', 'shell', 'flower'],
  beat: 0, step: 0, cleared: 0, pose: '', poseUntil: 0, lastPulseAt: 1, lastInputAt: 0, paused: false });
const pet = (index = 0, kind: 'fishing' | 'walk' = 'fishing'): PetState => ({
  schema: 12, revision: 1, species: 0, name: '伙伴', createdAt: 1, hatchedAt: 1, lastTick: 1000,
  sleeping: false, needs: { hunger: 80, mood: 80, energy: 80, clean: 80 }, careCount: 0,
  growth: emptyGrowth('baby'), logs: [], pond: { since: 1, fish: [] }, park: { since: 1, finds: [], walks: 0, lastWalkAt: 0 },
  game: { ...session(index, kind), ...(kind === 'fishing' ? { fishing: fish() } : { walking: walk() }) },
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('fictional outing selection', () => {
  it('covers all 48 distinct weather/season/light combinations', () => {
    const scenes = Array.from({ length: 48 }, (_, i) => outingScenery(session(i))!);
    expect(new Set(scenes.map(s => s.key)).size).toBe(48);
    expect(new Set(scenes.map(s => s.weather.id)).size).toBe(3);
    expect(new Set(scenes.map(s => s.season.id)).size).toBe(4);
    expect(new Set(scenes.map(s => s.light.id)).size).toBe(4);
  });
  it.each(['fishing', 'walk'] as const)('%s stories reflect all seasons and times without changing the live label', kind => {
    const scenes = Array.from({ length: 48 }, (_, i) => outingScenery(session(i, kind))!);
    expect(new Set(scenes.map(s => s.story)).size).toBe(48);
    const seasonal = ['新芽把沿途染成浅绿。', '树荫留出一小片清凉。', '落叶给沿途添了暖色。', '远处的树披着淡淡冬色。'];
    const dialogue = ['伙伴说：“有你在，开头就很好。”', '伙伴说：“平常的一刻也值得记住。”', '伙伴说：“晚霞再美，也不必赶着看。”', '伙伴说：“月色安静，我们也慢慢来。”'];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      expect(scene.story).toContain(seasonal[Math.floor(i / 3) % 4]);
      expect(scene.story).toContain(dialogue[Math.floor(i / 12)]);
      if (kind === 'fishing' && i % 3 === 2) expect(scene.story).toContain('不是咬钩信号');
      const { container, unmount } = render(<OutingCaption scenery={scene} compact />);
      expect(container.textContent).toBe(`本局风景（虚构） · ${scene.label}`);
      expect(container.querySelector('[aria-live]')).toBeNull();
      unmount();
    }
  });
  it.each([undefined, '', '0', 'g'.repeat(32), 'F'.repeat(32), '0'.repeat(31), '0'.repeat(33), '0'.repeat(32) + '\n', ' 00000000000000000000000000000000'])('leaves old/invalid id %s unchanged', id => {
    expect(outingScenery({ ...session(), id })).toBeNull();
  });
  it.each([undefined, 'tiles', 'snake', 'tetris'] as const)('does not decorate other game kind %s', kind => {
    expect(outingScenery({ ...session(), kind })).toBeNull();
    expect(outingScenery(undefined)).toBeNull();
  });
  it('accepts both hexadecimal boundaries', () => {
    expect(outingScenery(session())?.key).toBe('spring-clear-dawn');
    expect(outingScenery({ ...session(), id: 'f'.repeat(32) })?.key).toBe('summer-clear-day');
  });
  it('ignores clock, randomness and non-id session fields, without mutation', () => {
    const game = { ...session(47), fishing: fish() }, before = structuredClone(game);
    const clock = vi.spyOn(Date, 'now'), random = vi.spyOn(Math, 'random');
    const first = outingScenery(game);
    for (const spot of [0, 1, 2]) for (const paused of [true, false]) {
      expect(outingScenery({ ...game, startedAt: 9999999999999, score: 8, fishing: { ...fish(), spot, paused, step: 92, elapsedMs: 40000 } })).toEqual(first);
    }
    expect(clock).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(game).toEqual(before);
  });
  it('uses the same scene after JSON reload, with game-specific story only', () => {
    const game = session(47), first = outingScenery(game)!;
    expect(outingScenery(JSON.parse(JSON.stringify(game)))).toEqual(first);
    const walking = outingScenery({ ...game, kind: 'walk' })!;
    expect(walking.key).toBe(first.key); expect(walking.story).not.toBe(first.story);
    expect(first.story).toContain('不是咬钩信号');
  });
});

describe('decorative scenery components', () => {
  it('renders nothing for older/unsupported sessions', () => {
    const { container } = render(<><svg><OutingSky scenery={null} /></svg><OutingCaption scenery={null} /></>);
    expect(container.querySelector('svg')?.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });
  it('shows the story in reading captions but keeps only the label on the live scene', () => {
    const scenery = outingScenery(session(47))!;
    const { container, rerender } = render(<OutingCaption scenery={scenery} />);
    expect(container.textContent).toContain('每局独立生成的想象风景，不对应现实天气、季节或当前时间，也不代表连续变化。');
    expect(container.textContent).toContain(scenery.story);
    rerender(<OutingCaption scenery={scenery} compact />);
    expect(container.textContent).not.toContain(scenery.story);
    expect(container.querySelector('.outing-compact')).toBeTruthy();
  });
  it.each(Array.from({ length: 48 }, (_, i) => i))('renders labeled, static scene %i in both games without recording a discovery', index => {
    for (const kind of ['fishing', 'walk'] as const) {
      const state = pet(index, kind), before = structuredClone(state), scenery = outingScenery(state.game)!;
      const { container, unmount } = render(kind === 'fishing' ? <FishingGame pet={state} active choice={0} /> : <WalkingGame pet={state} active choice={0} />);
      expect(container.querySelector('.outing-caption')?.textContent).toBe(`本局风景（虚构） · ${scenery.label}`);
      const sky = container.querySelector('.outing-sky')!;
      expect(sky.getAttribute('data-weather')).toBe(scenery.weather.id);
      expect(sky.getAttribute('data-light')).toBe(scenery.light.id);
      expect(sky.closest('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(sky.querySelectorAll('animate, animateTransform, [tabindex], [role=status]')).toHaveLength(0);
      expect(container.querySelectorAll('button, a, input, [role=button], [tabindex]')).toHaveLength(0);
      expect(container.querySelector('svg > path[fill="' + scenery.light.sky + '"]')).toBeTruthy();
      expect(state).toEqual(before); expect(state.pond?.fish).toHaveLength(0); expect(state.park?.finds).toHaveLength(0);
      unmount();
    }
  });
  it.each(Array.from({ length: 10 }, (_, i) => i))('keeps scene through poses, phases and pause for species %i', species => {
    for (const kind of ['fishing', 'walk'] as const) {
      const state = pet(47, kind); state.species = species;
      const variants = kind === 'fishing' ? ['ready', 'wait', 'bite', 'result', 'done'] : ['', 'jump', 'duck', 'done'];
      for (const variant of variants) for (const active of [true, false]) {
        if (state.game?.fishing) Object.assign(state.game.fishing, { phase: variant, casts: variant === 'done' ? 3 : 1 });
        if (state.game?.walking) Object.assign(state.game.walking, { pose: variant === 'done' ? '' : variant, beat: variant === 'done' ? 72 : 12 });
        const { container, unmount } = render(kind === 'fishing' ? <FishingGame pet={state} active={active} choice={0} /> : <WalkingGame pet={state} active={active} choice={0} />);
        expect(container.querySelector('.outing-caption')?.getAttribute('data-scenery')).toBe('winter-rain-night');
        expect(container.querySelectorAll('.fishing-bite')).toHaveLength(kind === 'fishing' && variant === 'bite' && active ? 1 : 0);
        unmount();
      }
    }
  });
});
