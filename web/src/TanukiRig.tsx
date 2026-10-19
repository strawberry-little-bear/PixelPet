import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./tanuki-rig.css";

// Drafted independently on the same canvas: a tucked cub with a short tail,
// a forward-stepping scout, then a seated adult with a full ringed tail.
// Gold fur, brown mask, cream bib and forehead star retain the source identity.
export const tanukiStages = {
  baby: {
    head: "M21 29h22v3h6v4h3v12h-4v4h-5v3H21v-3h-6v-4h-3V36h3v-4h6z",
    body: "M24 49h17v4h5v7h-5v4H22v-4h-5v-7h7z",
    earLeft: "M14 35V25h4v-3h7v4h4v10z",
    earRight: "M36 35V25h4v-3h7v4h4v10z",
    innerLeft: "M18 28h6v6h-6z",
    innerRight: "M41 28h6v6h-6z",
    mask: "M24 34h16v3h6v4h3v7h-7v3H22v-3h-7v-7h3v-4h6z",
    muzzle: "M27 46h10v7H27z",
    bib: "M25 54h14v7H25z",
    tail: "M43 54h7v-4h8v3h3v8h-4v3H43z",
    rings: "M50 51h4v12h-4zM58 55h3v5h-3z",
    footLeft: "M22 59h8v5H18v-3h4z",
    footRight: "M34 59h8v2h4v3H34z",
    pawLeft: "M17 49h5v3h3v6h-3v2h-6v-3h-2v-5h3z",
    pawRight: "M41 49h6v3h3v5h-3v3h-6v-3h-2v-5h2z",
    eyeX: [24, 37],
    eyeY: 40,
    mouthY: 48,
    starY: 24,
    accessoryY: 56,
  },
  growing: {
    head: "M21 23h20v3h7v4h3v13h-4v4h-6v3H21v-3h-6v-4h-4V30h4v-4h6z",
    body: "M25 45h14v3h5v6h4v7h-8v3H22v-4h-5v-9h8z",
    earLeft: "M13 29V18h3v-4h9v4h4v13z",
    earRight: "M35 29V17h4v-3h8v4h4v13z",
    innerLeft: "M17 20h7v8h-7z",
    innerRight: "M40 20h7v8h-7z",
    mask: "M24 29h15v3h6v3h4v8h-8v3H22v-3h-9v-8h4v-3h7z",
    muzzle: "M27 41h10v7H27z",
    bib: "M25 49h14v11H25z",
    tail: "M42 54h7v-7h4V35h7v5h2v17h-4v6H43z",
    rings: "M53 39h9v5h-9zM50 49h12v5H50zM45 58h12v5H45z",
    footLeft: "M22 57h8v7H16v-3h6z",
    footRight: "M35 55h9v4h6v5H35z",
    pawLeft: "M14 43h6v3h3v7h-3v3h-7v-3h-2v-7h3z",
    pawRight: "M43 44h5v3h3v6h-3v3h-6v-3h-2v-7h3z",
    eyeX: [23, 36],
    eyeY: 35,
    mouthY: 43,
    starY: 18,
    accessoryY: 51,
  },
  adult: {
    head: "M22 18h18v3h7v4h4v13h-4v5h-7v3H22v-3h-7v-5h-4V25h4v-4h7z",
    body: "M25 41h14v3h6v8h3v9h-7v3H21v-4h-5v-8h4v-8h5z",
    earLeft: "M13 24V11h4V8h9v4h4v15z",
    earRight: "M35 25V13h4V8h8v4h4v15z",
    innerLeft: "M18 14h7v9h-7z",
    innerRight: "M40 14h7v10h-7z",
    mask: "M24 24h14v3h7v4h4v8h-9v4H22v-4h-9v-8h4v-4h7z",
    muzzle: "M26 38h12v7H26z",
    bib: "M24 46h16v14H24z",
    tail: "M43 56h8V40h-3V28h4v-4h6v4h4v14h-3v18h-5v5H43z",
    rings: "M48 31h14v5H48zM51 43h8v5h-8zM49 55h10v5H49z",
    footLeft: "M21 57h9v7H14v-4h7z",
    footRight: "M34 57h8v3h7v4H34z",
    pawLeft: "M16 42h6v3h3v8h-3v3h-7v-3h-2v-8h3z",
    pawRight: "M42 42h6v3h3v8h-3v3h-7v-3h-2v-8h3z",
    eyeX: [23, 36],
    eyeY: 30,
    mouthY: 40,
    starY: 11,
    accessoryY: 49,
  },
} as const;

export function TanukiRig({
  stage,
  expression = "awake",
  motion = "idle",
  need,
  className = "",
  accessory,
}: {
  stage: GrowthStage;
  expression?: Expression;
  motion?: SceneMotion;
  need?: NeedKind;
  className?: string;
  accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = tanukiStages[variant];
  return (
    <svg
      viewBox="0 0 64 68"
      className={`pet-sprite tanuki-rig tanuki-${variant} rig-motion-${motion} expression-${expression} ${need ? `gesture-${need}` : ""} ${className}`}
      data-rig-stage={variant}
      role="img"
      aria-label={petStageLabel(0, variant)}
      shapeRendering="crispEdges"
    >
      <g stroke="#3d302a" strokeWidth="2" strokeLinejoin="miter" fill="#ffda58">
        <g className="tanuki-tail">
          <path className="tanuki-tail-shape" d={art.tail} />
          <path
            className="tanuki-rings"
            d={art.rings}
            fill="#ab7339"
            stroke="none"
          />
        </g>
        <g className="tanuki-foot foot-left">
          <path d={art.footLeft} />
          <path d="M21 62h5v2h-5z" fill="#c79845" stroke="none" />
        </g>
        <g className="tanuki-foot foot-right">
          <path d={art.footRight} />
          <path d="M36 62h5v2h-5z" fill="#c79845" stroke="none" />
        </g>
        <g className="tanuki-torso">
          <path className="tanuki-body-shape" d={art.body} />
          <path
            className="tanuki-bib"
            d={art.bib}
            fill="#fff2bb"
            stroke="none"
          />
        </g>
        <g className="tanuki-head">
          <g className="tanuki-ear ear-left">
            <path d={art.earLeft} />
            <path d={art.innerLeft} fill="#bd8949" stroke="none" />
          </g>
          <g className="tanuki-ear ear-right">
            <path d={art.earRight} />
            <path d={art.innerRight} fill="#bd8949" stroke="none" />
          </g>
          <path className="tanuki-head-shape" d={art.head} />
          <path
            className="tanuki-mask"
            d={art.mask}
            fill="#8a5b32"
            stroke="none"
          />
          <path
            className="tanuki-muzzle"
            d={art.muzzle}
            fill="#fff2bb"
            stroke="none"
          />
          <g
            className="tanuki-star"
            transform={`translate(32 ${art.starY})`}
            stroke="none"
          >
            <path d="M-2-7h4v5h6v4H4v4H1v4h-3V5h-4V1h-3v-3h7z" fill="#fff2bb" />
            <path d="M-1-2h3v4h-3z" fill="#ffe27b" />
          </g>
          <g className="sprite-face" stroke="none" fill="#342820">
            <g className="sprite-eyes-open">
              {art.eyeX.map((x) => (
                <rect key={x} x={x} y={art.eyeY} width="3" height="4" />
              ))}
            </g>
            <g className="sprite-eyes-closed">
              {art.eyeX.map((x) => (
                <path
                  key={x}
                  d={`M${x - 1} ${art.eyeY + 1}h1v1h3v-1h1v2h-5z`}
                />
              ))}
            </g>
            <g className="sprite-eyes-happy">
              {art.eyeX.map((x) => (
                <path
                  key={x}
                  d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`}
                />
              ))}
            </g>
            <g className="sprite-eyes-tired">
              {art.eyeX.map((x) => (
                <rect
                  key={x}
                  x={x - 1}
                  y={art.eyeY + 2}
                  width="5"
                  height="1.5"
                />
              ))}
            </g>
            <g className="sprite-eye-glints" fill="#fff6dc">
              {art.eyeX.map((x) => (
                <rect key={x} x={x} y={art.eyeY} width="1" height="1" />
              ))}
            </g>
            <path
              className="tanuki-cheeks"
              d={`M16 ${art.eyeY + 6}h6v2h-6zm26 0h6v2h-6z`}
              fill="#ff8f9d"
            />
            <path className="tanuki-nose" d={`M30 ${art.mouthY - 2}h4v2h-4z`} />
            <path
              className="tanuki-mouth"
              d={`M28 ${art.mouthY}h2v2h4v-2h2v3h-2v1h-4v-1h-2z`}
            />
            <path
              className="tanuki-mouth-chew"
              d={`M30 ${art.mouthY}h4v4h-4z`}
            />
          </g>
        </g>
        <AccessoryMark
          id={accessory}
          transform={`translate(32 ${art.accessoryY})`}
        />
        <path className="tanuki-paw need-paw paw-left" d={art.pawLeft} />
        <path className="tanuki-paw need-paw paw-right" d={art.pawRight} />
      </g>
    </svg>
  );
}
