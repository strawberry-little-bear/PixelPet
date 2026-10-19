import { experienceWords } from "./companion";
import type { SharedGameKind } from "./companion";
import { RoomDecoration, RoomSurfaceArt } from "./EquipmentArt";
import { useId } from "react";
import type { CSSProperties } from "react";
import { Cloud } from "lucide-react";
import { NeedGesture } from "./NeedGesture";
import type { NeedKind } from "./needs";
import type { Expression } from "./Sprite";
import { PetArt, petRigKind, petRigClass } from "./PetArt";
import type { SceneMotion } from "./motion";
import "./pet-motion.css";
import { GrowthOutfit, FormEmblem } from "./GrowthOutfit";
import type { AdultForm, GrowthStage, Equipment } from "./types";

const needLabels: Record<NeedKind, string> = {
  hungry: "摸摸肚子等吃饭",
  tired: "揉眼睛打哈欠",
  dirty: "挠头等洗澡",
  playful: "推球邀请玩耍",
  content: "微笑挥手",
  quiet: "安静地靠近",
};

const birdNeedLabels: Record<NeedKind, string> = {
  hungry: "小翅贴肚子等吃饭", tired: "小翅揉眼想休息",
  dirty: "翅尖理羽等洗澡", playful: "扬翅推球邀请玩耍",
  content: "微笑轻动翅膀", quiet: "收翅安静相伴",
};

const dolphinNeedLabels: Record<NeedKind, string> = {
  hungry: "小鳍贴肚子等吃饭", tired: "垂鳍低头想休息",
  dirty: "小鳍蹭身侧等洗澡", playful: "扬鳍邀请玩耍",
  content: "微笑挥鳍", quiet: "收鳍安静相伴",
};

const mushroomNeedLabels: Record<NeedKind, string> = {
  hungry: "小手贴肚子等吃饭", tired: "垂下菌盖想休息",
  dirty: "拂拂菌盖等洗澡", playful: "举手邀请玩耍",
  content: "微笑摇盖挥手", quiet: "轻靠菌盖安静相伴",
};

const bearNeedLabels: Record<NeedKind, string> = {
  hungry: "小爪摸肚子等吃饭", tired: "小爪揉眼想休息",
  dirty: "挠挠圆耳等洗澡", playful: "伸爪推球邀请玩耍",
  content: "微笑招爪", quiet: "抱爪安静相伴",
};

const frogNeedLabels: Record<NeedKind, string> = {
  hungry: "前蹼摸肚子等吃饭", tired: "前蹼揉眼想休息",
  dirty: "前蹼擦脸等洗澡", playful: "伸蹼滚球邀请玩耍",
  content: "微笑挥蹼", quiet: "收蹼安静相伴",
};

const dragonNeedLabels: Record<NeedKind, string> = {
  hungry: "小爪摸肚子等吃饭", tired: "收翼揉眼想休息",
  dirty: "挠挠星角等洗澡", playful: "伸爪推球邀请玩耍",
  content: "微笑挥爪", quiet: "拢翼抱爪安静相伴",
};

const dogNeedLabels: Record<NeedKind, string> = {
  hungry: "前爪摸肚子等吃饭", tired: "垂耳揉眼想休息",
  dirty: "挠挠垂耳等洗澡", playful: "伸爪推球邀请玩耍",
  content: "微笑挥爪摇尾", quiet: "垂耳抱爪安静相伴",
};

const labels: Record<SceneMotion, string> = {
  idle: "待机，眨眼和轻轻活动",
  eating: "吃饭，咀嚼小饭团",
  bathing: "洗澡，搓洗和冲泡泡",
  sleeping: "闭眼盖被子睡觉",
  waking: "醒来伸懒腰",
  celebrating: "开心地蹦蹦跳跳",
  walking: "一起走过公园小路",
  fishing: "在池塘安静等待鱼漂",
};

function RiceBall() {
  const mask = useId();
  return (
    <svg
      className="rice-ball"
      viewBox="0 0 40 40"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <defs>
        <mask id={mask}>
          <rect width="40" height="40" fill="white" />
          <path
            className="rice-bite bite-one"
            d="M24 0h16v16H28v-4h-4z"
            fill="black"
          />
          <path
            className="rice-bite bite-two"
            d="M0 0h24v12h-8v4H0z"
            fill="black"
          />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path
          d="M16 3h8v4h4v4h4v8h4v12h-4v4H8v-4H4V19h4v-8h4V7h4z"
          fill="#4a5137"
        />
        <path d="M16 7h8v4h4v8h4v12H8V19h4v-8h4z" fill="#fff8dc" />
        <path d="M12 15h4v4h-4zm12 4h4v4h-4zm-8-8h4v4h-4z" fill="#e4d9b0" />
        <path d="M16 23h12v12H16z" fill="#637349" />
        <path d="M20 23h4v8h-4z" fill="#7f8e5e" />
      </g>
    </svg>
  );
}
function BathTub() {
  return (
    <svg
      className="bath-tub"
      viewBox="0 0 88 40"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M6 8h76v20h-6v6H12v-6H6z" fill="#688e83" />
      <path d="M10 12h68v12h-6v6H16v-6h-6z" fill="#b3d5c3" />
      <path d="M16 16h56v4H16z" fill="#d0e7d3" />
      <path d="M18 34h8v4h-8zm44 0h8v4h-8z" fill="#6a8064" />
      <path d="M2 4h84v8H2z" fill="#e7f1dc" />
      <path d="M2 10h84v4H2z" fill="#88b9a7" />
      <path
        d="M10 0h12v4H10zm18 0h16v4H28zm24 0h12v4H52zm20 0h8v4h-8z"
        fill="#f6f9e8"
      />
    </svg>
  );
}
function Blanket() {
  return (
    <svg
      className="sleep-blanket"
      viewBox="0 0 88 32"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M8 2h60v4h12v6h4v18H4V10h4z" fill="#839c90" />
      <path d="M8 10h68v16H8z" fill="#a8c2b0" />
      <path
        d="M16 10v16m16-16v16m16-16v16m16-16v16M8 16h68M8 24h68"
        stroke="#cfddbf"
        strokeWidth="3"
      />
      <path d="M8 2h60v4h12v6H8z" fill="#e4ead0" />
      <path d="M8 10h72v3H8z" fill="#b7c6a4" />
    </svg>
  );
}

export function PetScene({
  index,
  motion,
  clipId,
  dirty,
  duration = 0,
  stage = "baby",
  form = "",
  need,
  equipped,
  echo,
}: {
  index: number;
  motion: SceneMotion;
  clipId: number;
  dirty: boolean;
  duration?: number;
  stage?: GrowthStage;
  form?: AdultForm | "";
  need?: NeedKind;
  equipped?: Equipment;
  echo?: SharedGameKind;
}) {
  const rig = petRigKind(index, stage);
  const sharedEcho = motion === "idle" && stage !== "egg" && !["hungry", "tired", "dirty"].includes(need || "") ? echo : undefined;
  const echoNeed = sharedEcho ? ({ stars: "content", tiles: "quiet", snake: "content", tetris: "content", fishing: "quiet", walk: "quiet" } as const)[sharedEcho] : undefined;
  const activeNeed = motion === "idle" && stage !== "egg" ? echoNeed || need : undefined;
  const expression: Expression =
    motion === "sleeping"
      ? "asleep"
      : motion === "bathing" || motion === "celebrating"
        ? "content"
        : motion === "eating"
          ? "chewing"
          : motion === "waking"
            ? "waking"
            : activeNeed || "awake";
  return (
    <div
      className={`pet-room pet-scene motion-${motion} growth-${stage} form-${form || "none"} need-${activeNeed || "none"}`}
      data-echo={sharedEcho}
      data-motion={motion}
      data-need={activeNeed || "none"}
      data-rig={rig}
      data-stage={stage}
      data-form={form}
      role="img"
      aria-label={(sharedEcho ? experienceWords[sharedEcho] : labels[motion]) + (activeNeed ? `，${(rig === "bird" ? birdNeedLabels : rig === "dolphin" ? dolphinNeedLabels : rig === "mushroom" ? mushroomNeedLabels : rig === "bear" ? bearNeedLabels : rig === "frog" ? frogNeedLabels : rig === "dragon" ? dragonNeedLabels : rig === "dog" ? dogNeedLabels : needLabels)[activeNeed]}` : "")}
    >
      <div className="scene-environment" aria-hidden="true">
        <RoomSurfaceArt id={equipped?.wallpaper} />
        <Cloud className="room-cloud" size={30} strokeWidth={1.5} />
        <span className="room-sun">{motion === "sleeping" ? "☾" : "✳"}</span>
        <div className="room-window" />
        <div className="room-floor" />
        <RoomSurfaceArt id={equipped?.floor} />
        <RoomDecoration id={equipped?.room} />
      </div>
      <div
        className="motion-stage"
        key={`${motion}-${clipId}`}
        aria-hidden="true"
        style={{ "--clip-duration": `${duration}ms` } as CSSProperties}
      >
        <span className="pet-ground-shadow" />
        {sharedEcho && <div className="home-game-token" data-game={sharedEcho}><span>{({ stars: "★", tiles: "▧ ▧", snake: "●", tetris: "▥", fishing: "<><", walk: "♧" })[sharedEcho]}</span><small>刚才 · {({ stars: "接星星", tiles: "连连看", snake: "贪吃蛇", tetris: "俄罗斯方块", fishing: "池塘钓鱼", walk: "公园散步" })[sharedEcho]}</small></div>}
        {motion === "sleeping" && (
          <>
            <span className="sleep-pillow" />
            <div className="dream-stars">
              <i>✧</i>
              <i>·</i>
              <i>✦</i>
            </div>
          </>
        )}
        {/* Keep occlusion in room coordinates: the actor and its limbs move
            inside this fixed viewport, never underneath the bed or tub. */}
        <div className="pet-actor-window">
          <div className="pet-actor">
            <div className={`growth-size ${petRigClass(index, stage)}`}>
              <PetArt index={index} stage={stage} expression={expression} motion={motion} need={activeNeed} accessory={equipped?.accessory} />
              {!equipped?.accessory && <GrowthOutfit stage={stage} form={form} />}
              {activeNeed && <NeedGesture kind={activeNeed} index={index} paws={rig === "original"} />}
            </div>
          </div>
        </div>
        {stage === "adult" && <FormEmblem form={form} />}
        {motion === "celebrating" && <span className="growth-evolution-ring" />}
        {motion === "eating" && (
          <div className="meal-props">
            <span className="meal-plate" />
            <RiceBall />
            <div className="rice-crumbs">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} />
              ))}
            </div>
            <span className="meal-heart">♥</span>
          </div>
        )}
        {motion === "bathing" && (
          <div className="bath-props">
            <BathTub />
            <svg
              className="bath-soap"
              viewBox="0 0 28 20"
              shapeRendering="crispEdges"
            >
              <path d="M4 2h20v4h4v10h-4v2H4v-2H0V6h4z" fill="#91afa0" />
              <path d="M4 4h20v8H4z" fill="#f0d6b4" />
              <path d="M8 6h12v2H8z" fill="#fff0d4" />
            </svg>
            <div className="bath-foam">
              <i />
              <i />
              <i />
            </div>
            <div className="bath-bubbles">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i key={i} />
              ))}
            </div>
            <div className="bath-splashes">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="bath-shine">
              <i>✦</i>
              <i>✧</i>
            </div>
          </div>
        )}
        {motion === "sleeping" && (
          <>
            <Blanket />
            <div className="dream-letters">
              <i>z</i>
              <i>z</i>
              <i>Z</i>
            </div>
          </>
        )}
        {motion === "waking" && (
          <div className="wake-rays">
            <i />
            <i />
            <i />
          </div>
        )}
        {motion === "celebrating" && (
          <div className="celebrate-sparks">
            <i>✦</i>
            <i>♡</i>
            <i>✧</i>
          </div>
        )}
      </div>
      {dirty && motion === "idle" && (
        <span className="dirty-mark" aria-hidden="true">
          ♨
        </span>
      )}
    </div>
  );
}
