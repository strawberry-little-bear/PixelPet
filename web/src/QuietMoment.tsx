import { useState, type ReactNode } from "react";
import { GameKeepsakeArt } from "./GameKeepsakeArt";
import { CareReadingRegion } from "./CareReadingRegion";
import { quietMemories } from "./quiet-memory";
import { interestCue } from "./companion";
import { PetArt, petRigClass, petRigKind } from "./PetArt";
import { GrowthOutfit, FormEmblem } from "./GrowthOutfit";
import { stageNames, formNames, tendency } from "./growth";
import type { AdultForm, Growth, GrowthStage, PetState, Shop } from "./types";
import { quietAtmosphere } from "./quiet-atmosphere";
import "./growth.css";
import "./quiet-moment.css";

export const quietMoments = [
  { title: "摸摸它", idle: "它安静地靠近了一点。", reply: "它眨了眨眼，把这份温柔收好了。", expression: "content" as const },
  { title: "陪它发呆", idle: "和它一起安静待一会儿，谁也不用急。", reply: "它轻轻呼了一口气，和你一起发呆。", expression: "quiet" as const },
  { title: "说声你好", idle: "它抬起头，等着听你说话。", reply: "它摇了摇身子：你好呀，我一直在这里。", expression: "playful" as const },
] as const;

const adultFormQuietLines: Record<AdultForm, string> = {
  balanced: "它安稳地陪在你身边，玩一会儿、休息一会儿都刚刚好。",
  lively: "它的眼神亮了一下，像是发呆完就想和你去冒险。",
  gentle: "它把动作放得很轻，静静靠在你身边。",
  easygoing: "它按自己的节奏眨眨眼，连安静也觉得很自在。",
};

const growingTendencyQuietLines: Record<AdultForm, string> = {
  balanced: "日常照顾正在慢慢形成均衡的节奏。",
  lively: "陪玩的痕迹更明显一些，它正在长出活力。",
  gentle: "清洁和休息的痕迹更明显一些，它正在长得安稳。",
  easygoing: "它正在按自己的节奏慢慢长大。",
};

export function quietFormLine(stage: GrowthStage, form: AdultForm | "", choice: number, replied: boolean) {
  return stage === "adult" && form && choice === 1 && replied ? adultFormQuietLines[form] : null;
}

export function growingTendencyLine(growth: Growth | undefined, choice: number, replied: boolean) {
  if (!growth || growth.stage !== "growing" || choice !== 1 || !replied) return null;
  const form = tendency(growth);
  return { form, text: growingTendencyQuietLines[form] };
}

type QuietReaction = "breathe" | "peek" | "lively" | "gentle" | "easygoing";

function quietReaction(growth: Growth | undefined, choice: number): QuietReaction {
  if (choice !== 1 || !growth) return "breathe";
  if (growth.stage === "baby") return "peek";
  if (growth.stage === "adult") {
    return growth.form === "lively" || growth.form === "gentle" || growth.form === "easygoing"
      ? growth.form : "breathe";
  }
  if (growth.stage !== "growing") return "breathe";
  const care = growth.care;
  const hasCare = [growth.trackedHours, care?.nutrition, care?.play, care?.clean, care?.rest]
    .some(value => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!hasCare) return "breathe";
  const form = tendency(growth);
  return form === "balanced" ? "breathe" : form;
}

function QuietReactionPet({ growth, choice, sleeping, children }: {
  growth: Growth | undefined; choice: number; sleeping: boolean; children: ReactNode;
}) {
  // Remounted only by a new choice/reply. Ordinary save reads can update the
  // artwork, but must not replace or replay the response already in progress.
  const [reaction] = useState(() => quietReaction(growth, choice));
  return <div className={`quiet-moment-pet growth-${growth?.stage ?? "baby"} motion-${sleeping ? "sleeping" : "idle"}`}
    data-reaction={reaction} aria-hidden="true">{children}</div>;
}

const sleepingMoments = [
  { title: "轻轻摸摸", idle: "它睡得正香，你可以轻轻陪着。", reply: "你轻轻摸了摸它，它仍闭着眼睛，呼吸安稳。" },
  { title: "守着它睡", idle: "它安静地睡着，小窝也慢了下来。", reply: "你在旁边坐了一会儿，陪它安安稳稳地睡。" },
  { title: "轻声道晚安", idle: "回忆等醒来再聊，现在轻声说句晚安吧。", reply: "你轻声说了晚安，它还在甜甜地睡着。" },
] as const;

export function QuietMoment({ pet, shop, choice, replied, responseId = 0, memoryKey = null, now = Date.now() }: {
  pet: PetState; shop?: Shop | null; choice: number; replied: boolean; responseId?: number; memoryKey?: string | null; now?: number;
}) {
  const growth = pet.growth;
  const stage = growth?.stage ?? "baby";
  const form = growth?.form ?? "";
  const moment = quietMoments[choice] ?? quietMoments[0];
  const words = pet.sleeping ? sleepingMoments[choice] ?? sleepingMoments[0] : moment;
  const memories = !pet.sleeping && choice === 2 && replied ? quietMemories(pet, shop) : [];
  const memoryIndex = memories.findIndex(m => m.key === memoryKey);
  const memory = memories[memoryIndex];
  const atmosphere = !pet.sleeping ? quietAtmosphere(pet.species, stage, form, now) : null;
  const interest = !pet.sleeping && choice === 1 && replied ? interestCue(pet.companion, petRigKind(pet.species, stage)) : null;
  const formLine = !pet.sleeping ? quietFormLine(stage, form, choice, replied) : null;
  const tendencyLine = !pet.sleeping ? growingTendencyLine(growth, choice, replied) : null;
  return <CareReadingRegion className="quiet-moment-reading" label="无目的互动阅读区"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    <section className="quiet-moment" aria-live="polite" data-choice={choice} data-replied={replied} data-sleeping={pet.sleeping}>
      <header><span>不用完成什么</span><small>{choice + 1} / {quietMoments.length}</small></header>
      <QuietReactionPet key={`${responseId}:${choice}:${replied}`} growth={growth} choice={choice} sleeping={pet.sleeping}>
        <div className={`growth-size ${petRigClass(pet.species, stage)}`}>
          <PetArt index={pet.species} stage={stage}
            expression={pet.sleeping ? "asleep" : replied ? moment.expression : "awake"}
            motion={pet.sleeping ? "sleeping" : "idle"}
            accessory={pet.economy?.equipped.accessory} />
          {growth && stage !== "egg" && !pet.economy?.equipped.accessory && <GrowthOutfit stage={stage} form={form} />}
        </div>
        {stage === "adult" && <FormEmblem form={form} />}
      </QuietReactionPet>
      <div className="quiet-moment-copy">
        {growth && <small className="quiet-growth-label">{stageNames[stage]}{stage === "adult" && form ? ` · ${formNames[form]}` : ""}</small>}
        <strong>{words.title}</strong>
        {atmosphere && <small className="quiet-atmosphere" data-period={atmosphere.period} data-season={atmosphere.season}><span>{atmosphere.label}</span>{atmosphere.text}</small>}
        {atmosphere && <small className="quiet-event" data-season={atmosphere.season}><span>{atmosphere.seasonLabel}小事</span>{atmosphere.event}</small>}
        {memory && <small className="quiet-memory-position">闲聊回忆 {memoryIndex + 1} / {memories.length}</small>}
        {memory?.keepsake && <div className="quiet-keepsake" aria-hidden="true"><GameKeepsakeArt item={memory.keepsake} /></div>}
        <p>{replied ? memory?.reply ?? words.reply : words.idle}</p>
        {tendencyLine && <small className="quiet-growth-tendency" data-form={tendencyLine.form}><span>当前偏向 · {formNames[tendencyLine.form]}</span>{tendencyLine.text}（还会随着照顾继续变化）</small>}
        {formLine && <small className="quiet-form-line" data-form={form}><span>成长留下的样子</span>{formLine}</small>}
        {interest && <small className="quiet-interest" data-game={interest.kind}><span>一起玩久了</span>{interest.text}</small>}
        {memory && <small className="quiet-memory-source">{memory.source === "game" ? "从共同游戏记录想起：" : "从纪念册想起："}{memory.title}
          {(memory.source === "game" || memory.keepsake) && <> · <time dateTime={new Date(memory.at).toISOString()}>{new Date(memory.at).toLocaleString("zh-CN", {
            year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}</time>（本地时间）</>}
        </small>}
      </div>
      <small className="quiet-moment-note">{pet.sleeping ? "它还在睡觉，陪伴不会叫醒它，也没有奖励或惩罚。" : "没有奖励或惩罚，只留下一小会儿陪伴。"}</small>
    </section>
  </CareReadingRegion>;
}
