import { RoomDecoration } from "./EquipmentArt";
import { Heart, Moon, Sparkles, Utensils, Waves } from "lucide-react";
import type { Memory, PetState } from "./types";
import { formNames } from "./growth";
import { PetArt } from "./PetArt";
import "./album.css";

export const albumPageCount = (pet: PetState) => 1 + (pet.album?.entries.length ?? 0);
// Work on a copy: reading the album must not reorder the saved event array.
export const albumMemories = (pet: PetState) => [...(pet.album?.entries ?? [])]
  .sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
export function memoryWords(m: Memory, legacy: boolean) {
  switch (m.kind) {
    case "hatch": return { title: "小小的初次相遇", story: "从这一天起，小窝里多了一位等你回来的伙伴。" };
    case "growing": return { title: "一起走进成长期", story: "从小小一团到勇敢迈步，这段长大被好好留了下来。" };
    case "adult": return { title: "长大了，也陪着你", story: `成为了${formNames[m.form || "balanced"]}。模样已经定下，往后的日子仍能一起慢慢过。` };
    case "meal": return { title: "一份暖暖的小饭团", story: `${legacy ? "纪念册开启后记下的第一顿饭" : "你们一起吃的第一顿饭"}，啊呜一口，小窝也暖了起来。` };
    case "bath": return { title: "泡泡里的小陪伴", story: `${legacy ? "纪念册开启后记下的第一次洗澡" : "你们的第一次泡泡澡"}，把这份温柔收好。` };
    case "goodnight": return { title: "轻轻说一声晚安", story: `${legacy ? "纪念册开启后第一次道晚安" : "你第一次轻轻道晚安"}。放心休息，小窝一直在这里。` };
    case "stars": return { title: "一起追过的星光", story: `${legacy ? "纪念册里记下的第一场" : "你们完整玩完的第一场"}接星星，接住了 ${m.score ?? 0} 颗。记住的是一起玩，不只是分数。` };
    case "perfect-stars": return { title: "五颗星，都接住啦", story: "五次默契的小接应，凑成一整把星光。值得记住，但不用每次都做到。" };
    case "fishing": return { title: "池塘边的一起等待", story: "一起钓到至少一条鱼并完成三竿。发现的鱼已留在图鉴里，记住的还有岸边慢慢等候的时光。" };
    case "tetris": return { title: "一起拼起的积木花园", story: "一块一块挪好、转好，把整排小积木收起来。留下的是一起想办法的时光。" };
    case "snake": return { title: "果园里一起转过的弯", story: "吃到至少三颗果子后完成的一局贪吃蛇。你负责转弯，小伙伴把甜甜的果子收好。" };
    case "tiles": return { title: "把小图案一起收好", story: "你找到连线，小伙伴接住图案。完整连好八对，记下的是一起完成的这盘游戏。" };
    case "outfit": return { title: "第一次选好小装扮", story: "挑一件喜欢的装扮，陪你回家，也陪你追星星。不改变长大的模样。" };
    case "decoration": return { title: "把小窝布置成喜欢的样子", story: "亲手摆上第一件小装饰，让等你回来的地方多一点温暖。" };
    case "days": return { title: `相识 ${m.days} 天的小纪念`, story: "时间慢慢走，小窝还在。不必每天来，也不需要补上错过的日子。" };
  }
}
const dateLabel = (at: number) => new Date(at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
export function AlbumPanel({ pet, now, page }: { pet: PetState; now: number; page: number }) {
  const memories = albumMemories(pet);
  const currentPage = Math.min(Math.max(0, page), memories.length);
  const memory = currentPage > 0 ? memories[currentPage - 1] : undefined;
  const words = memory ? memoryWords(memory, pet.album?.legacy ?? false) : undefined;
  const stage = memory?.kind === "hatch" ? "baby" : memory?.kind === "growing" ? "growing" : memory?.kind === "adult" ? "adult" : pet.growth?.stage || "baby";
  const isPortrait = !memory || ["hatch", "growing", "adult"].includes(memory.kind);
  const Icon = memory?.kind === "meal" ? Utensils : memory?.kind === "bath" ? Waves : memory?.kind === "goodnight" ? Moon : (memory?.kind.includes("stars") || memory?.kind === "tiles") ? Sparkles : Heart;
  return <section className="album-panel" aria-label="永久纪念册" data-album-page={currentPage}>
    <header><strong>{memory ? "小窝的回忆" : "我们的纪念册"}</strong><span>{currentPage + 1} / {memories.length + 1}</span></header>
    <div className={`album-picture ${isPortrait ? "album-portrait" : ""}`} aria-hidden="true">
      {isPortrait ? <PetArt index={pet.species} stage={stage} expression="still" /> : memory?.kind === "decoration" ? <RoomDecoration id={memory.item} /> : memory?.kind === "outfit" ? <PetArt index={pet.species} stage={pet.growth?.stage || "baby"} accessory={memory.item} /> : <Icon size={30} strokeWidth={1.5} />}
    </div>
    {memory && words ? <>
      <time dateTime={new Date(memory.at).toISOString()}>{dateLabel(memory.at)}</time>
      <h3>{words.title}</h3>
      <p>{words.story}</p>
      <small className="album-source">{memory.source === "saved"
        ? memory.kind === "hatch" ? "沿用旧存档的相遇日期，不补写照顾经历。" : "旧存档记录时间，可能来自旧版迁移；不补写当时细节。"
        : memory.source === "elapsed" ? "按相遇日期计算，不代表连续登录。" : "来自已保存的真实经历 · 只记录一次"}</small>
    </> : <>
      <h3>与你相识 {Math.max(0, Math.floor((now - pet.hatchedAt) / 86400000))} 天</h3>
      <p>长大、星光和温柔的小事，<br />不会随最近的日记翻篇。</p>
      <small className="album-source">{pet.album
        ? pet.album.legacy ? "从纪念册开启后，继续记下新的共同经历。" : "只收藏发生过的回忆，不必追赶任何进度。"
        : "纪念册尚未开启，请更新服务后再来看看。"}</small>
    </>}
  </section>;
}
