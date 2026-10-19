import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./bird-rig.css";

// Original cloud-bird anatomy: downy chick, fledgling testing its wings,
// then a perched adult. These are separate drawings, not resized source art.
export const birdStages = {
  baby: {
    head: "M24 29h16v3h7v4h5v5h3v9h-4v4h-7v3H20v-3h-7v-4h-3v-9h4v-5h5v-4h5z",
    body: "M23 47h18v3h7v7h-4v5H20v-4h-4v-8h7z",
    breast: "M23 53h18v7H23z",
    crest: "M29 25h4v-7h3v7h7v4h-7v7h-4v-7h-8v-4z",
    wingLeft: "M13 43h5v3h4v9h-4v4h-7v-3H7v-8h3v-5z",
    wingRight: "M47 43h5v4h4v9h-4v3h-7v-4h-3v-9h5z",
    featherLeft: "M11 50h4v5h-4z",
    featherRight: "M48 50h4v5h-4z",
    footLeft: "M24 60h5v4H18v-3h6z",
    footRight: "M35 60h5v1h6v3H35z",
    tail: "M36 56h9v3h5v5h-8v2H31v-5h5z",
    tailFeather: "M40 59h4v5h-4z",
    beak: "M28 46h9v3h-3v4h-3v-4h-3z",
    eyeX: [23, 38], eyeY: 40, cheekY: 48, mouthY: 49, accessoryY: 57,
  },
  growing: {
    head: "M23 20h18v3h7v4h5v6h2v9h-4v5h-7v3H20v-3h-7v-5h-3V32h4v-5h4v-4h5z",
    body: "M25 42h14v3h8v6h3v7h-7v5H20v-5h-4V47h9z",
    breast: "M23 48h19v10h-4v3H23z",
    crest: "M28 16h4V8h4v8h9v4h-9v9h-4v-9h-9v-4z",
    wingLeft: "M14 35h5v6h4v10h-4v5h-5v-3H9v-5H6v-8h4v-5z",
    wingRight: "M45 39h5v-6h4v-5h5v4h3v12h-4v6h-4v5h-7v-6h-4v-7h2z",
    featherLeft: "M10 41h3v10h-3zM16 46h3v5h-3z",
    featherRight: "M52 36h3v11h-3zM57 33h3v7h-3z",
    footLeft: "M22 56h6v7H14v-3h8z",
    footRight: "M36 58h5v3h8v3H36z",
    tail: "M37 53h10v4h7v5h-6v3H30v-5h7z",
    tailFeather: "M43 57h4v6h-4zM49 59h4v3h-4z",
    beak: "M27 40h10v4h-4v5h-3v-5h-3z",
    eyeX: [22, 38], eyeY: 33, cheekY: 42, mouthY: 44, accessoryY: 53,
  },
  adult: {
    head: "M24 13h15v3h8v4h5v6h3v9h-4v6h-8v3H21v-3h-8v-5h-3V26h3v-6h5v-4h6z",
    body: "M24 37h17v4h7v7h3v10h-5v5H18v-5h-4V47h4v-6h6z",
    breast: "M23 44h19v12h-4v5H23z",
    crest: "M28 9h4V1h4v8h10v4H36v10h-4V13H21V9z",
    wingLeft: "M15 33h6v8h3v10h-4v7h-6v-4H9v-6H5V38h5v-5z",
    wingRight: "M46 33h6v4h6v6h3v9h-5v5h-7v-4h-5V42h-3v-5h5z",
    featherLeft: "M10 41h3v10h-3zM16 46h4v8h-4z",
    featherRight: "M49 42h4v10h-4zM55 44h3v7h-3z",
    footLeft: "M22 58h6v6H13v-3h9z",
    footRight: "M36 58h6v3h8v3H36z",
    tail: "M36 51h12v4h9v4h5v5H51v3H28v-6h8z",
    tailFeather: "M43 56h4v9h-4zM52 59h4v5h-4z",
    beak: "M27 33h11v4h-4v6h-4v-6h-3z",
    eyeX: [22, 38], eyeY: 27, cheekY: 36, mouthY: 37, accessoryY: 49,
  },
} as const;

export function BirdRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion;
  need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = birdStages[variant];
  return <svg viewBox="0 0 64 68" className={`pet-sprite bird-rig bird-${variant} rig-motion-${motion} expression-${expression} ${need ? `gesture-${need}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={petStageLabel(1, variant)} shapeRendering="crispEdges">
    <g stroke="#382c29" strokeWidth="2" strokeLinejoin="miter" fill="#fffef8">
      <g className="bird-tail"><path d={art.tail} /><path className="bird-tail-feathers" d={art.tailFeather} fill="#c0e6f0" stroke="none" /></g>
      <g className="bird-foot foot-left"><path d={art.footLeft} fill="#ffb53c" /></g>
      <g className="bird-foot foot-right"><path d={art.footRight} fill="#ffb53c" /></g>
      <g className="bird-torso"><path className="bird-body-shape" d={art.body} /><path className="bird-breast" d={art.breast} fill="#e3f1ef" stroke="none" /></g>
      <g className="bird-head">
        <path className="bird-head-shape" d={art.head} />
        <path className="bird-crest" d={art.crest} fill="#8fccee" stroke="none" />
        <g className="sprite-face" stroke="none" fill="#382c29">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x-1} ${art.eyeY+1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x-1} ${art.eyeY+2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x-1} y={art.eyeY+2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="bird-cheeks" d={`M16 ${art.cheekY}h7v2h-7zm25 0h7v2h-7z`} fill="#ff8f9d" />
          <path className="bird-beak" d={art.beak} fill="#ff9e32" />
          <path className="bird-beak-open" d={`M29 ${art.mouthY}h7v4h-7z`} fill="#b87945" />
        </g>
      </g>
      <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY})`} />
      <g className="bird-wing wing-left" fill="#c0e6f0"><path d={art.wingLeft} /><path className="bird-feathers" d={art.featherLeft} fill="#8fccee" stroke="none" /></g>
      <g className="bird-wing wing-right" fill="#c0e6f0"><path d={art.wingRight} /><path className="bird-feathers" d={art.featherRight} fill="#8fccee" stroke="none" /></g>
    </g>
  </svg>;
}
