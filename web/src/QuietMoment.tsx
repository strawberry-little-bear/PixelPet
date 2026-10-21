import { CareReadingRegion } from "./CareReadingRegion";
import { PetArt } from "./PetArt";
import type { PetState } from "./types";
import "./quiet-moment.css";

export const quietMoments = [
  { title: "摸摸它", idle: "它安静地靠近了一点。", reply: "它眨了眨眼，把这份温柔收好了。", expression: "content" as const },
  { title: "陪它发呆", idle: "阳光慢慢挪过屏幕，谁也不用急。", reply: "它轻轻呼了一口气，和你一起发呆。", expression: "quiet" as const },
  { title: "说声你好", idle: "它抬起头，等着听你说话。", reply: "它摇了摇身子：你好呀，我一直在这里。", expression: "playful" as const },
] as const;

export function QuietMoment({ pet, choice, replied }: { pet: PetState; choice: number; replied: boolean }) {
  const moment = quietMoments[choice] ?? quietMoments[0];
  return <CareReadingRegion className="quiet-moment-reading" label="无目的互动阅读区"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    <section className="quiet-moment" aria-live="polite" data-choice={choice} data-replied={replied}>
      <header><span>不用完成什么</span><small>{choice + 1} / {quietMoments.length}</small></header>
      <div className="quiet-moment-pet" aria-hidden="true">
        <PetArt index={pet.species} stage={pet.growth?.stage ?? "baby"}
          expression={replied ? moment.expression : "awake"}
          accessory={pet.economy?.equipped.accessory} />
      </div>
      <strong>{moment.title}</strong>
      <p>{replied ? moment.reply : moment.idle}</p>
      <small className="quiet-moment-note">没有奖励或惩罚，只留下一小会儿陪伴。</small>
    </section>
  </CareReadingRegion>;
}
