import { gameKeepsake, type GameKeepsakeItem } from "./game-keepsakes";
import { games } from "./games";
import { fishCatalog, fishCatalogFor } from "./fishing";
import { parkCatalog } from "./walk";
import { memoryWords } from "./AlbumPanel";
import { isOutingMemory } from "./outing-memory";
import { recordedMemoryItem } from "./memory-item";
import type { FishDiscovery, Memory, PetState, Shop } from "./types";

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

export type QuietMemory = { key: string; title: string; reply: string; at: number; source: "album" | "game" | "fish" | "park"; discovery?: string; keepsake?: GameKeepsakeItem };
const itemReplies = {
  outfit: (name: string) => `它开心地晃了晃：还记得你选的「${name}」，那份心意一直暖暖的。`,
  wallpaper: (name: string) => `它望着你：还记得一起铺好「${name}」的时光，小窝里的回忆也收好了。`,
  floor: (name: string) => `它轻轻靠近：还记得一起选的「${name}」，那时布置小窝的心意也留着呢。`,
  decoration: (name: string) => `它望着你：还记得一起摆好的「${name}」，那份小小的温暖一直留着。`,
} satisfies Partial<Record<Memory["kind"], (name: string) => string>>;

const fishReplies = {
  "reed-minnow": "它望着你：还记得「青苇小鲦」吗？芦苇影子里，那条细细的银线也留在回忆里了。",
  "sun-carp": "它眨眨眼：想起「暖阳小鲤」，像把那一小片暖阳也带回了小窝。",
  "ribbon-loach": "它轻轻晃了晃：还记得「丝带泥鳅」绕过水草的样子，像给那段等待打了个小结。",
  "lotus-fish": "它望着你：想起「荷花小鱼」，荷叶下探出来的小身影，还想和你再聊一会儿。",
  "moon-perch": "它安静地靠近：还记得「月纹小鲈」身上的弯弯纹路，那段岸边的时光也很安静。",
  "pebble-goby": "它眨眨眼：想起「石斑虾虎」，圆石头旁的小邻居，也成了我们的小回忆。",
  "rain-koi": "它望着你：还记得「雨珠小鲤」吗？游戏雨景里的那点银蓝色，一直收在图鉴里。",
  "willow-darter": "它轻轻靠近：想起「柳影小鳉」，柳影间的小身影，让那段等待有了特别的回忆。",
} satisfies Record<typeof fishCatalog[number]["id"], string>;
const parkReplies = {
  leaf: "它轻轻晃了晃：还记得「银杏叶」吗？扇形的小叶片，把一起走过的小路也留住了一点。",
  pinecone: "它望着你：想起「小松果」，树荫下那次小发现，慢慢走也能遇见惊喜呢。",
  feather: "它眨眨眼：还记得「落羽」，轻轻的一根，也装得下那段一起散步的时光。",
  flower: "它安静地靠近：想起「落花」，那朵留在小路上的花，也被我们好好记住了。",
  shell: "它望着你：还记得「水边贝壳」吗？浅水道边的小发现，也想和你再说一遍。",
  pebble: "它轻轻晃了晃：想起「圆石子」，平常的小路上，也有值得一起记住的小东西。",
} satisfies Record<typeof parkCatalog[number]["id"], string>;
const savedTime = (n: number | undefined): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 8.64e15;

function discoveryMemories(pet: PetState): QuietMemory[] {
  if (!savedTime(pet.hatchedAt)) return [];
  const memories: QuietMemory[] = [];
  // A catalog discovery is saved at the encounter, even if the game is later
  // abandoned. Recall its first record without claiming a completed session.
  const append = (source: "fish" | "park", since: number | undefined, entries: FishDiscovery[] | null | undefined,
    catalog: readonly { id: string; name: string }[], replies: Readonly<Record<string, string>>) => {
    if (!savedTime(since) || since > pet.lastTick) return;
    const seen = new Set<string>();
    for (const entry of entries ?? []) {
      const item = catalog.find(item => item.id === entry.id);
      if (!item || seen.has(entry.id) || !savedTime(entry.firstAt) || !savedTime(entry.lastAt) ||
        entry.firstAt < Math.max(since, pet.hatchedAt) || entry.lastAt < entry.firstAt || entry.lastAt > pet.lastTick ||
        !Number.isInteger(entry.count) || entry.count < 1 || entry.count > 9999) continue;
      seen.add(entry.id);
      memories.push({ key: `${source}:${entry.id}:${entry.firstAt}`, source, discovery: item.id,
        title: `初次遇见「${item.name}」`, reply: replies[item.id], at: entry.firstAt });
    }
  };
  if (pet.schema >= 8) append("fish", pet.pond?.since, pet.pond?.fish, fishCatalogFor(pet), fishReplies);
  if (pet.schema >= 11) append("park", pet.park?.since, pet.park?.finds, parkCatalog, parkReplies);
  return memories;
}
const newestFirst = (a: QuietMemory, b: QuietMemory) => b.at - a.at || a.key.localeCompare(b.key);

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
  memories.push(...discoveryMemories(pet));
  memories.sort(newestFirst);
  // A repeated completion can remain meaningful after the first-game album
  // entry or capped familiarity stops changing. Use only the saved session,
  // never infer a completion from interest points, counts or the local clock.
  const recent = pet.companion?.recent;
  if (!recent || typeof recent.id !== "string" || !recent.id.trim() || !savedTime(recent.at) ||
    !savedTime(pet.hatchedAt) || !savedTime(pet.companion?.since) ||
    recent.at < Math.max(pet.hatchedAt, pet.companion.since) || recent.at > pet.lastTick) return memories;
  const game = games.find(game => game.id === recent.kind);
  // The first completed session is already represented by its album entry.
  const alreadyRemembered = memories.some(m => m.at === recent.at &&
    (m.key === `${recent.kind}:${recent.at}` || (recent.kind === "stars" && m.key === `perfect-stars:${recent.at}`)));
  if (game && !alreadyRemembered) memories.push({ key: `game:${recent.id}:${recent.at}`, at: recent.at, source: "game",
    title: `最近一次一起玩「${game.title}」`, reply: replies[game.id] });
  return memories.sort(newestFirst);
}

export function nextQuietMemory(memories: QuietMemory[], current: string | null): string | null {
  if (!memories.length) return null;
  const index = memories.findIndex(m => m.key === current);
  return memories[(index + 1) % memories.length].key;
}
