// Six first-discovery cards, not 48 season/time tasks. These keys are saved by
// the server only when a catch or a park discovery actually happens.
export const outingMemoryWords = {
  'scenery-fishing-clear': { title: '晴光里的小鱼', story: '在虚构的晴光里，第一次钓到了一条鱼。水面的光和岸边的陪伴，一起收进手记。' },
  'scenery-fishing-cloud': { title: '云影下的一次钓获', story: '在虚构的云影下，第一次钓到了一条鱼。小伙伴望着水面：等候也可以是一段好时光。' },
  'scenery-fishing-rain': { title: '细雨里的钓获', story: '在虚构的细雨里，第一次钓到了一条鱼。雨纹不是咬钩信号，真正提竿的那一刻被记住了。' },
  'scenery-walk-clear': { title: '晴光里的沿途发现', story: '在虚构的晴光里，走到了一个沿途发现点。小伙伴把路上的小小惊喜，留在这页手记。' },
  'scenery-walk-cloud': { title: '云影下的小路惊喜', story: '在虚构的云影下，走到了一个沿途发现点。云影走在前头，小伙伴就在身边。' },
  'scenery-walk-rain': { title: '细雨里的沿途发现', story: '在虚构的细雨里，走到了一个沿途发现点。步子不用赶，小小惊喜也会被好好收下。' },
} as const;
export type OutingMemoryKind = keyof typeof outingMemoryWords;
export function isOutingMemory(kind: string): kind is OutingMemoryKind {
  return Object.hasOwn(outingMemoryWords, kind);
}
