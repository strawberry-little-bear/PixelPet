import { useId } from "react";
import type { CSSProperties } from "react";
import { Cloud } from "lucide-react";
import { Sprite } from "./Sprite";
import type { SceneMotion } from "./motion";
import "./pet-motion.css";
import { GrowthOutfit, FormEmblem } from "./GrowthOutfit";
import type { AdultForm, GrowthStage } from "./types";

const labels: Record<SceneMotion, string> = {
  idle: "待机，眨眼和轻轻摇晃",
  eating: "吃饭，咀嚼小饭团",
  bathing: "洗澡，搓洗和冲泡泡",
  sleeping: "闭眼盖被子睡觉",
  waking: "醒来伸懒腰",
  celebrating: "开心地蹦蹦跳跳",
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
}: {
  index: number;
  motion: SceneMotion;
  clipId: number;
  dirty: boolean;
  duration?: number;
  stage?: GrowthStage;
  form?: AdultForm | "";
}) {
  const expression =
    motion === "sleeping"
      ? "asleep"
      : motion === "bathing" || motion === "celebrating"
        ? "content"
        : motion === "eating"
          ? "chewing"
          : motion === "waking"
            ? "waking"
            : "awake";
  return (
    <div
      className={`pet-room pet-scene motion-${motion} growth-${stage} form-${form || "none"}`}
      data-motion={motion}
      data-stage={stage}
      data-form={form}
      role="img"
      aria-label={labels[motion]}
    >
      <div className="scene-environment" aria-hidden="true">
        <Cloud className="room-cloud" size={30} strokeWidth={1.5} />
        <span className="room-sun">{motion === "sleeping" ? "☾" : "✳"}</span>
        <div className="room-window" />
        <div className="room-floor" />
      </div>
      <div
        className="motion-stage"
        key={`${motion}-${clipId}`}
        aria-hidden="true"
        style={{ "--clip-duration": `${duration}ms` } as CSSProperties}
      >
        <span className="pet-ground-shadow" />
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
        <div className="pet-actor">
          <div className="growth-size">
            <Sprite index={index} expression={expression} />
            <GrowthOutfit stage={stage} form={form} />
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
