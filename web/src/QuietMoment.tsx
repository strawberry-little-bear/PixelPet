import { CareReadingRegion } from "./CareReadingRegion";
import { quietMemories } from "./quiet-memory";
import { PetArt } from "./PetArt";
import type { PetState } from "./types";
import "./quiet-moment.css";

export const quietMoments = [
  { title: "摸摸它", idle: "它安静地靠近了一点。", reply: "它眨了眨眼，把这份温柔收好了。", expression: "content" as const },
  { title: "陪它发呆", idle: "阳光慢慢挪过屏幕，谁也不用急。", reply: "它轻轻呼了一口气，和你一起发呆。", expression: "quiet" as const },
  { title: "说声你好", idle: "它抬起头，等着听你说话。", reply: "它摇了摇身子：你好呀，我一直在这里。", expression: "playful" as const },
] as const;

const sleepingMoments = [
  { title: "轻轻摸摸", idle: "它睡得正香，你可以轻轻陪着。", reply: "你轻轻摸了摸它，它仍闭着眼睛，呼吸安稳。" },
  { title: "守着它睡", idle: "它安静地睡着，小窝也慢了下来。", reply: "你在旁边坐了一会儿，陪它安安稳稳地睡。" },
  { title: "轻声道晚安", idle: "回忆等醒来再聊，现在轻声说句晚安吧。", reply: "你轻声说了晚安，它还在甜甜地睡着。" },
] as const;

export function QuietMoment({ pet, choice, replied, memoryKey = null }: {
  pet: PetState; choice: number; replied: boolean; memoryKey?: string | null;
}) {
  const moment = quietMoments[choice] ?? quietMoments[0];
  const words = pet.sleeping ? sleepingMoments[choice] ?? sleepingMoments[0] : moment;
  const memory = !pet.sleeping && choice === 2 && replied ? quietMemories(pet).find(m => m.key === memoryKey) : undefined;
  return <CareReadingRegion className="quiet-moment-reading" label="无目的互动阅读区"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    <section className="quiet-moment" aria-live="polite" data-choice={choice} data-replied={replied} data-sleeping={pet.sleeping}>
      <header><span>不用完成什么</span><small>{choice + 1} / {quietMoments.length}</small></header>
      <div className="quiet-moment-pet" aria-hidden="true">
        <PetArt index={pet.species} stage={pet.growth?.stage ?? "baby"}
          expression={pet.sleeping ? "asleep" : replied ? moment.expression : "awake"}
          motion={pet.sleeping ? "sleeping" : "idle"}
          accessory={pet.economy?.equipped.accessory} />
      </div>
      <div className="quiet-moment-copy">
        <strong>{words.title}</strong>
        <p>{replied ? memory?.reply ?? words.reply : words.idle}</p>
        {memory && <small className="quiet-memory-source">从纪念册想起：{memory.title}</small>}
      </div>
      <small className="quiet-moment-note">{pet.sleeping ? "它还在睡觉，陪伴不会叫醒它，也没有奖励或惩罚。" : "没有奖励或惩罚，只留下一小会儿陪伴。"}</small>
    </section>
  </CareReadingRegion>;
}
