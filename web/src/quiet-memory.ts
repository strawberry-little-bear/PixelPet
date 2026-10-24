import { gameKeepsake, type GameKeepsakeItem } from "./game-keepsakes";
import { games } from "./games";
import { memoryWords } from "./AlbumPanel";
import { isOutingMemory } from "./outing-memory";
import { recordedMemoryItem } from "./memory-item";
import type { Memory, PetState, Shop } from "./types";

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

export type QuietMemory = { key: string; title: string; reply: string; at: number; source: "album" | "game"; keepsake?: GameKeepsakeItem };
const itemReplies = {
  outfit: (name: string) => `它开心地晃了晃：还记得你选的「${name}」，那份心意一直暖暖的。`,
  wallpaper: (name: string) => `它望着你：还记得一起铺好「${name}」的时光，小窝里的回忆也收好了。`,
  floor: (name: string) => `它轻轻靠近：还记得一起选的「${name}」，那时布置小窝的心意也留着呢。`,
  decoration: (name: string) => `它望着你：还记得一起摆好的「${name}」，那份小小的温暖一直留着。`,
} satisfies Partial<Record<Memory["kind"], (name: string) => string>>;

export function quietMemories(pet: PetState, shop?: Shop | null): QuietMemory[] {
  if (!Number.isSafeInteger(pet.lastTick) || pet.lastTick <= 0) return [];
  const memories: QuietMemory[] = (pet.album?.entries ?? [])
    .filter(m => m.source === "shared" && m.kind !== "days"
      && Number.isSafeInteger(m.at) && m.at > 0 && m.at <= pet.lastTick)
    .slice().sort((a, b) => b.at - a.at || a.kind.localeCompare(b.kind) || (a.item ?? "").localeCompare(b.item ?? ""))
    .flatMap(m => {
      const keepsake = m.kind === "keepsake" && pet.schema >= 21 ? gameKeepsake(m.item) : undefined;
      if (m.kind === "keepsake" && !keepsake) return [];
      const words = memoryWords(m, pet.album?.legacy ?? false);
      const itemName = recordedMemoryItem(m, shop)?.name.trim();
      const itemReply = itemName && Object.hasOwn(itemReplies, m.kind)
        ? itemReplies[m.kind as keyof typeof itemReplies](itemName) : undefined;
      const reply = keepsake?.reply ?? itemReply ?? (isOutingMemory(m.kind)
        ? "它翻着风景手记：那一页里的小小惊喜，想和你再记起一次。"
        : Object.hasOwn(replies, m.kind) ? replies[m.kind as keyof typeof replies] : undefined);
      return words && reply ? [{ key: `${m.kind}:${m.at}${keepsake ? `:${keepsake.item}` : ""}`, title: words.title, reply, at: m.at, source: "album" as const, ...(keepsake && { keepsake: keepsake.item }) }] : [];
    });
  // A repeated completion can remain meaningful after the first-game album
  // entry or capped familiarity stops changing. Use only the saved session,
  // never infer a completion from interest points, counts or the local clock.
  const recent = pet.companion?.recent;
  const savedTime = (n: number | undefined): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;
  if (!recent || typeof recent.id !== "string" || !recent.id.trim() || !savedTime(recent.at) ||
    !savedTime(pet.hatchedAt) || !savedTime(pet.companion?.since) ||
    recent.at < Math.max(pet.hatchedAt, pet.companion.since) || recent.at > pet.lastTick) return memories;
  const game = games.find(game => game.id === recent.kind);
  // The first completed session is already represented by its album entry.
  const alreadyRemembered = memories.some(m => m.at === recent.at &&
    (m.key === `${recent.kind}:${recent.at}` || (recent.kind === "stars" && m.key === `perfect-stars:${recent.at}`)));
  if (game && !alreadyRemembered) memories.push({ key: `game:${recent.id}:${recent.at}`, at: recent.at, source: "game",
    title: `最近一次一起玩「${game.title}」`, reply: replies[game.id] });
  return memories.sort((a, b) => b.at - a.at);
}

export function nextQuietMemory(memories: QuietMemory[], current: string | null): string | null {
  if (!memories.length) return null;
  const index = memories.findIndex(m => m.key === current);
  return memories[(index + 1) % memories.length].key;
}
