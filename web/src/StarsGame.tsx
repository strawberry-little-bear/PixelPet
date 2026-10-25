import { starsReactionMatches, type StarsReaction } from "./stars-reaction";
import { SelectionStatus } from "./SelectionStatus";
import { PetArt } from "./PetArt";
import { petGrowth } from "./growth";
import { gameCompanionVoice } from "./gameCompanionVoice";
import type { PetState } from "./types";

const positions = ["左边", "中间", "右边"];
export function StarsGame({ pet, now, lane, target, message, reaction }: {
  pet: PetState; now: number; lane: number; target: number; message: string; reaction?: StarsReaction | null;
}) {
  if (!pet.game || pet.game.kind) return null;
  const caught = starsReactionMatches(reaction, pet.game, lane);
  const growth = petGrowth(pet, now);
  const companionVoice = gameCompanionVoice(growth, "stars");
  return (
    <section className="star-game" aria-label="接星星">
      <header className="game-score">
        <strong>第 {pet.game.round + 1} / 5 轮</strong>
        <span>已接住 {pet.game.score} 颗</span>
      </header>
      <div className="game-lanes" role="img" aria-label={`星星在${positions[target]}；伙伴在${positions[lane]}`}>
        {[0, 1, 2].map(i => (
          <div key={i} className={`game-lane ${i === lane ? "lane-selected" : ""}`} data-motion={i === lane ? caught ? "celebrating" : "waiting" : undefined} data-form={i === lane ? companionVoice?.form : undefined}>
            <span className={`falling-star ${target === i ? "visible" : ""}`} aria-hidden="true">★</span>
            {lane === i ? <PetArt index={pet.species} stage={petGrowth(pet, now).stage}
              motion={caught ? "celebrating" : "idle"} expression={caught ? "content" : "awake"}
              accessory={pet.economy?.equipped.accessory} /> : <span className="lane-dot" aria-hidden="true">·</span>}
          </div>
        ))}
      </div>
      <SelectionStatus scope="stars">
        伙伴在{positions[lane]}；A 移到{positions[(lane + 1) % 3]}，B 在当前位置接星，C 打开放弃确认。
        第 {pet.game.round + 1} / 5 轮，已接住 {pet.game.score} 颗。
      </SelectionStatus>
      <p className="star-position">伙伴：{positions[lane]}{companionVoice && <small className="game-companion-voice">{companionVoice.text}</small>}</p>
      <p className="star-method">移到亮星下面后按 B 接住。亮星会停在本轮位置，接空也算一轮；等待不会扣轮次。</p>
      <div className="game-message">{message || "移到星星下面，按 B 接住！"}</div>
    </section>
  );
}
