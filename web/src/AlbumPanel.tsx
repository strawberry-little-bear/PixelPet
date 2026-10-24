import { gameKeepsake } from "./game-keepsakes";
import { GameKeepsakeArt } from "./GameKeepsakeArt";
import { isOutingMemory, outingMemoryWords } from "./outing-memory";
import { RoomDecoration, RoomSurfaceArt } from "./EquipmentArt";
import { BookOpen, Heart, Moon, Sparkles, Utensils, Waves } from "lucide-react";
import type { Memory, PetState, Shop } from "./types";
import { formNames } from "./growth";
import { memoryItemSlots, recordedMemoryItem } from "./memory-item";
import { PetArt } from "./PetArt";
import { FormEmblem } from "./GrowthOutfit";
import "./album.css";

export const albumCategories = [
  { id: "all", label: "全部回忆", detail: "按时间翻看所有已保存的共同经历。" },
  { id: "growth", label: "长大时光", detail: "相遇、成长和定下模样的那一天。" },
  { id: "care", label: "日常照顾", detail: "饭团、泡泡和好好休息的小事。" },
  { id: "play", label: "一起玩过", detail: "收藏已经收好的游戏与散步回忆。" },
  { id: "home", label: "小窝装扮", detail: "穿戴与布置留下的真实纪念。" },
  { id: "days", label: "相识日子", detail: "按相遇日期记录，不代表连续登录。" },
  { id: "scenery", label: "风景手记", detail: "真实发现时的虚构风景，不对应现实天气。" },
] as const;
export type AlbumCategory = typeof albumCategories[number]["id"];
const memoryCategory: Record<Memory["kind"], Exclude<AlbumCategory, "all">> = {
  hatch: "growth", growing: "growth", adult: "growth",
  meal: "care", bath: "care", goodnight: "care", rested: "care",
  stars: "play", "perfect-stars": "play", tiles: "play", snake: "play", tetris: "play", fishing: "play", walk: "play", treasure: "play", keepsake: "play",
  outfit: "home", decoration: "home", wallpaper: "home", floor: "home",
  days: "days",
  "scenery-fishing-clear": "scenery", "scenery-fishing-cloud": "scenery", "scenery-fishing-rain": "scenery",
  "encounter-fishing-stars": "scenery", "encounter-walk-kite": "scenery",
  "scenery-walk-clear": "scenery", "scenery-walk-cloud": "scenery", "scenery-walk-rain": "scenery",
};
// Filter/sort copies: browsing never edits or reorders the saved event array.
export const albumMemories = (pet: PetState, category: AlbumCategory = "all") => (pet.album?.entries ?? [])
  .filter(memory => category === "all" || memoryCategory[memory.kind] === category)
  .sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind) || (a.item ?? "").localeCompare(b.item ?? ""));
export const albumPageCount = (pet: PetState, category: AlbumCategory = "all") => 1 + albumMemories(pet, category).length;
export function AlbumDirectory({ pet, choice }: { pet: PetState; choice: number }) {
  const selected = albumCategories[choice] ?? albumCategories[0];
  return <section className="album-panel album-directory" aria-label="纪念册分类" data-album-directory={selected.id}>
    <header><strong>我们的纪念册</strong><span>回忆分类</span></header>
    <ul>{albumCategories.map(category => <li key={category.id} aria-current={selected.id === category.id ? "true" : undefined}>
      <span aria-hidden="true">{selected.id === category.id ? "▸" : ""}</span>{category.label}
    </li>)}</ul>
    <p>{selected.detail}</p>
    <small className="album-source">{pet.album ? "只翻看发生过的回忆，不需要集齐。" : "纪念册尚未开启，请更新服务后再来看看。"}</small>
  </section>;
}
export function memoryWords(m: Memory, legacy: boolean) {
  if (isOutingMemory(m.kind)) return outingMemoryWords[m.kind];
  switch (m.kind) {
    case "treasure": return { title: "林间的小小发现", story: "第一次一起收好森林探索的经历。不必找齐，陪伴本身就值得纪念。" };
    case "keepsake": {
      return gameKeepsake(m.item) ?? { title: "一起收好的小纪念物", story: "这件纪念物的说明暂不可用，保存的记录仍在。" };
    }
    case "hatch": return { title: "小小的初次相遇", story: "从这一天起，小窝里多了一位等你回来的伙伴。" };
    case "growing": return { title: "一起走进成长期", story: "从小小一团到勇敢迈步，这段长大被好好留了下来。" };
    case "adult": return { title: "长大了，也陪着你", story: `${m.form ? `成为了${formNames[m.form]}` : "已经长成成年伙伴"}。模样已经定下，往后的日子仍能一起慢慢过。` };
    case "meal": return { title: "一份暖暖的小饭团", story: `${legacy ? "纪念册开启后记下的第一顿饭" : "你们一起吃的第一顿饭"}，啊呜一口，小窝也暖了起来。` };
    case "bath": return { title: "泡泡里的小陪伴", story: `${legacy ? "纪念册开启后记下的第一次洗澡" : "你们的第一次泡泡澡"}，把这份温柔收好。` };
    case "goodnight": return { title: "轻轻说一声晚安", story: `${legacy ? "纪念册开启后第一次道晚安" : "你第一次轻轻道晚安"}。放心休息，小窝一直在这里。` };
    case "rested": return { title: "睡饱后的小小伸展", story: "这一觉真正恢复了体力，睡饱后你轻轻叫醒了小伙伴。记下这次小小伸展，不用每次都等到满格。" };
    case "stars": return { title: "一起追过的星光", story: `${legacy ? "纪念册里记下的第一场" : "你们完整玩完的第一场"}接星星，接住了 ${m.score ?? 0} 颗。记住的是一起玩，不只是分数。` };
    case "perfect-stars": return { title: "五颗星，都接住啦", story: "五次默契的小接应，凑成一整把星光。值得记住，但不用每次都做到。" };
    case "walk": return {title:"公园里走过的第一条小路",story:"一起走完并收好了一次公园散步。绊到也没关系，沿途的真实发现和慢慢陪伴的时光都留了下来。"};
    case "fishing": return { title: "池塘边的一起等待", story: "一起钓到至少一条鱼并完成三竿。发现的鱼已留在图鉴里，记住的还有岸边慢慢等候的时光。" };
    case "tetris": return { title: "一起拼起的积木花园", story: "一块一块挪好、转好，把整排小积木收起来。留下的是一起想办法的时光。" };
    case "snake": return { title: "果园里一起转过的弯", story: "吃到至少三颗果子后完成的一局贪吃蛇。你负责转弯，小伙伴把甜甜的果子收好。" };
    case "tiles": return { title: "把小图案一起收好", story: "你找到连线，小伙伴接住图案。完整连好八对，记下的是一起完成的这盘游戏。" };
    case "outfit": return { title: "第一次选好小装扮", story: "挑一件喜欢的装扮，陪你回家，也陪你追星星。不改变长大的模样。" };
    case "wallpaper": return { title: "为小窝换一面墙", story: "第一次铺好喜欢的墙纸。留下当时的花纹，之后换装也不会改写这一天。" };
    case "floor": return { title: "脚下的小小新风景", story: "第一次铺好喜欢的地板。和摆件一起布置，不改变宠物的成长。" };
    case "decoration": return { title: "把小窝布置成喜欢的样子", story: "亲手摆上第一件小装饰，让等你回来的地方多一点温暖。" };
    case "days": return { title: `相识 ${m.days} 天的小纪念`, story: "时间慢慢走，小窝还在。不必每天来，也不需要补上错过的日子。" };
  }
}
const dateLabel = (at: number) => new Date(at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
// Whole days since the first meeting. Day one reads "今天", not "相识 0 天";
// the status page numbers the same day as 相识第 1 天.
const meetingDays = (now: number, hatchedAt: number) => Number.isFinite(now) && Number.isFinite(hatchedAt)
  ? Math.max(0, Math.floor((now - hatchedAt) / 86400000))
  : null;
export function AlbumPanel({ pet, shop, now, page, category = "all", missing = false }: { pet: PetState; shop?: Shop | null; now: number; page: number; category?: AlbumCategory; missing?: boolean }) {
  const memories = albumMemories(pet, category);
  const meeting = meetingDays(now, pet.hatchedAt);
  const categoryLabel = albumCategories.find(c => c.id === category)!.label;
  const currentPage = Math.min(Math.max(0, page), memories.length);
  const memory = currentPage > 0 ? memories[currentPage - 1] : undefined;
  // Resolve only the recorded item, never today's equipment. Names come from
  // the current server catalog, not a fabricated historical name snapshot.
  const memorySlot = memory && memoryItemSlots[memory.kind];
  const memoryItem = recordedMemoryItem(memory, shop);
  const words = memory ? memoryWords(memory, pet.album?.legacy ?? false) : undefined;
  const stage = memory?.kind === "hatch" ? "baby" : memory?.kind === "growing" ? "growing" : memory?.kind === "adult" ? "adult" : pet.growth?.stage || "baby";
  const isPortrait = !memory || ["hatch", "growing", "adult"].includes(memory.kind);
  // Milestones use only their saved form; the cover shows the current companion.
  const portraitForm = memory?.kind === "adult" ? memory.form : !memory && stage === "adult" ? pet.growth?.form : undefined;
  const Icon = memory && isOutingMemory(memory.kind) ? BookOpen : memory?.kind === "meal" ? Utensils : memory?.kind === "bath" ? Waves : (memory?.kind === "goodnight" || memory?.kind === "rested") ? Moon : (memory?.kind.includes("stars") || memory?.kind === "tiles" || memory?.kind === "keepsake") ? Sparkles : Heart;
  return <section className="album-panel" aria-label="永久纪念册" data-album-page={currentPage} data-album-category={category} data-album-kind={memory?.kind}>
    <header><strong>{category !== "all" ? categoryLabel : memory ? "小窝的回忆" : "我们的纪念册"}</strong><span>{currentPage + 1} / {memories.length + 1}</span></header>
    {missing && <small role="status" className="album-source">同步时未找到刚才那条回忆，已返回本类封面。</small>}
    <div className={`album-picture ${isPortrait ? "album-portrait" : ""}`} aria-hidden="true">
      {memory?.kind === "keepsake" ? <GameKeepsakeArt item={memory.item} /> : isPortrait ? <PetArt index={pet.species} stage={stage} expression="still" /> : memory?.kind === "wallpaper" || memory?.kind === "floor" ? <RoomSurfaceArt id={memory.item} /> : memory?.kind === "decoration" ? <RoomDecoration id={memory.item} /> : memory?.kind === "outfit" ? <PetArt index={pet.species} stage={pet.growth?.stage || "baby"} accessory={memory.item} /> : <Icon size={30} strokeWidth={1.5} />}
      {portraitForm && <span className="album-form" data-album-form={portraitForm}><FormEmblem form={portraitForm} /></span>}
    </div>
    {memory && words ? <>
      <time dateTime={new Date(memory.at).toISOString()}>{dateLabel(memory.at)}</time>
      <h3>{words.title}</h3>
      <p>{words.story}</p>
      {memorySlot && <p className="album-item">当时选用：{memoryItem?.name.trim() || "名称暂不可用"}</p>}
      <small className="album-source">{isOutingMemory(memory.kind) ? "来自真实发现时的虚构风景 · 同类只记录一次" : memory.source === "saved"
        ? memory.kind === "hatch" ? "沿用旧存档的相遇日期，不补写照顾经历。" : "旧存档记录时间，可能来自旧版迁移；不补写当时细节。"
        : memory.kind === "keepsake" ? "一起玩过留下的小纪念物 · 每种只留一件，不必集齐" : memory.source === "elapsed" ? "按相遇日期计算，不代表连续登录。" : "来自已保存的真实经历 · 只记录一次"}</small>
    </> : <>
      <h3>{meeting === null ? "与你相识的每一天" : meeting === 0 ? "今天刚刚相识" : `与你相识 ${meeting} 天`}</h3>
      {memories.length === 0 && pet.album
        ? <p>{category === "scenery" ? <>这里还没有留下风景手记。<br />钓获或走到发现点时自然记录，不必集齐。</> : <>这里还没有留下回忆。<br />不必特意完成什么，慢慢相伴就好。</>}</p>
        : <p>{category === "all" ? <>长大、星光和温柔的小事，<br />不会随最近的日记翻篇。</> : "这里只翻看这一类已保存的回忆，按时间排列。"}</p>}
      <small className="album-source">{category === "scenery"
        ? pet.schema < 13 ? "风景手记尚未开启，请更新服务；不会补写过去的风景。" : "只记下新发生的发现；没有额外奖励，不受现实时间限制。"
        : pet.album
        ? pet.album.legacy ? "从纪念册开启后，继续记下新的共同经历。" : "只收藏发生过的回忆，不必追赶任何进度。"
        : "纪念册尚未开启，请更新服务后再来看看。"}</small>
    </>}
  </section>;
}
