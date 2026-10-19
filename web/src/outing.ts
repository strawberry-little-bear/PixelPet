import type { PetState } from './types';

const skies = [
  { id: 'clear', name: '晴', fishing: '晴光落在水面，陪你慢慢等。', walking: '晴光铺满小路，一起慢慢走。' },
  { id: 'cloud', name: '云', fishing: '云影停在池边，等候也有陪伴。', walking: '云影走在前头，小伙伴就在身边。' },
  { id: 'rain', name: '雨', fishing: '细雨落在池面，不是咬钩信号。', walking: '细雨点着小路，步子不用赶。' },
] as const;
const seasons = [
  { id: 'spring', name: '春', foliage: '#9eaf82', bank: '#b0be96', story: '新芽把沿途染成浅绿。' },
  { id: 'summer', name: '夏', foliage: '#748e60', bank: '#a8b689', story: '树荫留出一小片清凉。' },
  { id: 'autumn', name: '秋', foliage: '#b19d6b', bank: '#b9b18a', story: '落叶给沿途添了暖色。' },
  { id: 'winter', name: '冬', foliage: '#99aaa0', bank: '#bfcabc', story: '远处的树披着淡淡冬色。' },
] as const;
const lights = [
  { id: 'dawn', name: '晨光', sky: '#dfd9b8', dialogue: '伙伴说：“有你在，开头就很好。”' },
  { id: 'day', name: '白昼', sky: '#c6d5ac', dialogue: '伙伴说：“平常的一刻也值得记住。”' },
  { id: 'dusk', name: '晚霞', sky: '#dfc9b9', dialogue: '伙伴说：“晚霞再美，也不必赶着看。”' },
  { id: 'night', name: '月夜', sky: '#bdc9cc', dialogue: '伙伴说：“月色安静，我们也慢慢来。”' },
] as const;

// Fictional pocket scenery, not local weather, season or a real-time gate.
// A server-saved session ID selects scenery independently of real-world time.
// No RNG call, clock, local storage or save writes; refresh/pause cannot reroll it.
export function outingScenery(game: PetState['game']) {
  if (!game || (game.kind !== 'fishing' && game.kind !== 'walk') || !game.id || game.id.length !== 32 || !/^[0-9a-f]{32}$/.test(game.id)) return null;
  const index = parseInt(game.id.slice(0, 6), 16) % 48;
  const weather = skies[index % 3], season = seasons[Math.floor(index / 3) % 4], light = lights[Math.floor(index / 12)];
  // Ambient copy is read only while paused/finished, never a new discovery or time gate.
  return { key: `${season.id}-${weather.id}-${light.id}`, weather, season, light,
    label: `${season.name} · ${weather.name} · ${light.name}`,
    story: `${game.kind === 'fishing' ? weather.fishing : weather.walking}${season.story}${light.dialogue}` };
}
export type OutingScenery = ReturnType<typeof outingScenery>;
