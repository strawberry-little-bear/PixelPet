import { memoryWords } from "./AlbumPanel";
import { isOutingMemory } from "./outing-memory";
import type { Memory, PetState } from "./types";

// Speak about a saved experience without assigning it to today or promising a reward.
const replies = {
  hatch: "它轻轻靠近：从第一次见面起，有你在的小窝就很安心。",
  growing: "它晃了晃身子：慢慢长大的时候，一直有你陪着呢。",
  adult: "它望着你：长大以后，也还想和你一起过平常的日子。",
  meal: "它眨眨眼：还记得一起吃饭的时光，暖暖的陪伴也收好了。",
  bath: "它轻轻晃了晃：想起那些泡泡，和你慢慢照顾它的时光。",
  goodnight: "它安静地靠近：那声晚安被好好记着，有你在就很安心。",
  rested: "它舒展了一下：记得好好休息过，也记得醒来有你陪伴。",
  stars: "它抬起头：一起接过的星光，想起来还是亮亮的。",
  "perfect-stars": "它开心地晃了晃：那一把星光，是一起接住的小默契。",
  walk: "它轻轻靠近：还记得一起走过的小路，慢慢走也很开心。",
  fishing: "它望着你：一起在岸边等候的时光，也被好好收起来了。",
  tetris: "它晃了晃身子：那些一起想办法摆好的积木，还记着呢。",
  snake: "它眨眨眼：还记得一起在果园转弯，陪你找路也很开心。",
  tiles: "它轻轻点头：一对对小图案，是一起耐心找出来的。",
  treasure: "它望着你：森林里一起找过的小发现，还留在回忆里呢。",
  outfit: "它开心地晃了晃：记得你挑小装扮时的心意，一直暖暖的。",
  wallpaper: "它环顾小窝：记得一起选墙纸的时光，回忆也留在这里。",
  floor: "它轻轻挪了挪：还记得为小窝选地板，那份心意收好了。",
  decoration: "它环顾小窝：一起挑过的小摆件，让回忆也有了住处。",
} satisfies Partial<Record<Memory["kind"], string>>;

export type QuietMemory = { key: string; title: string; reply: string };
export function quietMemories(pet: PetState): QuietMemory[] {
  if (!Number.isSafeInteger(pet.lastTick) || pet.lastTick <= 0) return [];
  return (pet.album?.entries ?? [])
    .filter(m => m.source === "shared" && m.kind !== "days"
      && Number.isSafeInteger(m.at) && m.at > 0 && m.at <= pet.lastTick)
    .slice().sort((a, b) => b.at - a.at || a.kind.localeCompare(b.kind))
    .flatMap(m => {
      const words = memoryWords(m, pet.album?.legacy ?? false);
      const reply = isOutingMemory(m.kind)
        ? "它翻着风景手记：那一页里的小小惊喜，想和你再记起一次。"
        : Object.hasOwn(replies, m.kind) ? replies[m.kind as keyof typeof replies] : undefined;
      return words && reply ? [{ key: `${m.kind}:${m.at}`, title: words.title, reply }] : [];
    });
}

export function nextQuietMemory(memories: QuietMemory[], current: string | null): string | null {
  if (!memories.length) return null;
  const index = memories.findIndex(m => m.key === current);
  return memories[(index + 1) % memories.length].key;
}
