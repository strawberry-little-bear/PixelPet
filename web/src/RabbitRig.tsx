import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./rabbit-rig.css";

// Three separately drafted silhouettes on the SAME 64x68 canvas. No image crop
// or stage scaling: head/body proportions, ear shapes, feet and stance change.
export const rabbitStages = {
  baby: {
    head: "M22 27h20v3h6v4h3v12h-3v5h-6v3H22v-3h-6v-5h-3V34h3v-4h6z",
    body: "M25 47h14v4h5v8h-4v4H24v-4h-4v-8h5z",
    earLeft: "M17 22v-8h6v3h5v12h-7v-4h-4z",
    earRight: "M39 16h7v12h-8v-7h-2v-5z",
    footLeft: "M20 58h10v6H17v-3h3z",
    footRight: "M34 58h10v3h3v3H34z",
    berry: "M26 18h12v3h6v9h-4v4H24v-4h-4v-9h6z",
    eyes: [24, 37], eyeY: 37, mouthY: 45, armX: 3, armY: 8,
    belly: "M27 53h10v8H27z", tail: "M44 53h5v6h-5z",
  },
  growing: {
    head: "M23 25h18v3h6v4h3v10h-3v5h-6v3H23v-3h-6v-5h-3V32h3v-4h6z",
    body: "M24 44h16v4h5v9h-4v4H23v-4h-4v-9h5z",
    earLeft: "M18 8h7v3h3v16H18v-5h-3V11h3z",
    earRight: "M40 5h6v3h3v16h-3v4h-8V8h2z",
    footLeft: "M22 55h8v8H18v-4h4z",
    footRight: "M34 55h8v4h5v4H34z",
    berry: "M27 15h10v3h6v9h-4v5H25v-5h-4v-9h6z",
    eyes: [24, 37], eyeY: 34, mouthY: 42, armX: 1, armY: 3,
    belly: "M27 49h10v10H27z", tail: "M45 50h5v7h-5z",
  },
  adult: {
    head: "M24 23h16v3h6v4h3v10h-3v4h-6v2H24v-2h-6v-4h-3V30h3v-4h6z",
    body: "M25 40h14v3h5v6h3v8h-5v5H22v-5h-5v-8h3v-6h5z",
    earLeft: "M19 2h6v3h3v19H18V7h1z",
    earRight: "M40 3h7v17h-3v5h-8V6h4z",
    footLeft: "M22 56h8v8H15v-4h7z",
    footRight: "M34 56h8v4h7v4H34z",
    berry: "M27 13h10v3h6v9h-4v5H25v-5h-4v-9h6z",
    eyes: [25, 36], eyeY: 32, mouthY: 40, armX: 0, armY: 0,
    belly: "M26 46h12v13H26z", tail: "M46 49h5v7h-5z",
  },
} as const;

export function RabbitRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = rabbitStages[variant];
  return <svg viewBox="0 0 64 68" className={`pet-sprite rabbit-rig rabbit-${variant} rig-motion-${motion} expression-${expression} ${need ? `gesture-${need}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={petStageLabel(2, variant)} shapeRendering="crispEdges">
    <g stroke="#443432" strokeWidth="2" strokeLinejoin="miter" fill="#ffc9d8">
      <path className="rabbit-tail" d={art.tail} fill="#ffe5ec" />
      <path className="rabbit-foot foot-left" d={art.footLeft} />
      <path className="rabbit-foot foot-right" d={art.footRight} />
      <g className="rabbit-torso"><path className="rabbit-body-shape" d={art.body} /><path d={art.belly} stroke="none" fill="#ffe5ec" /></g>
      <g className="rabbit-head">
        <g className="rabbit-ear ear-left"><path d={art.earLeft} /><path d={art.earLeft} fill="#f2a1bc" stroke="none" transform="translate(6 6) scale(.75)" /></g>
        <g className="rabbit-ear ear-right"><path d={art.earRight} /><path d={art.earRight} fill="#f2a1bc" stroke="none" transform="translate(10 6) scale(.75)" /></g>
        <path className="rabbit-head-shape" d={art.head} />
        <g className="rabbit-strawberry"><path d={art.berry} fill="#ff5875" stroke="#e98d9f" strokeWidth="1" />
          <path d={`M29 ${variant === "baby" ? 16 : variant === "growing" ? 13 : 11}h3v3h3v-3h3v5h-5v2h-4v-3h-3v-3h3z`} fill="#73ad79" stroke="none" />
          <path d={`M27 ${art.eyeY-12}h2v2h-2zm8-3h2v2h-2zm0 7h2v2h-2zm-5-1h2v2h-2z`} fill="#fff5dc" stroke="none" />
        </g>
        <g className="sprite-face" stroke="none">
          <g className="sprite-eyes-open" fill="#443432">{art.eyes.map(x=><rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed" fill="#443432">{art.eyes.map(x=><path key={x} d={`M${x-1} ${art.eyeY+1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy" fill="#443432">{art.eyes.map(x=><path key={x} d={`M${x-1} ${art.eyeY+2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired" fill="#443432">{art.eyes.map(x=><rect key={x} x={x-1} y={art.eyeY+2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyes.map(x=><rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="rabbit-cheeks" d={`M18 ${art.eyeY+6}h6v2h-6zm22 0h6v2h-6z`} fill="#f48eae" />
          <path className="rabbit-mouth" d={`M28 ${art.mouthY}h2v2h4v-2h2v2h-2v2h-4v-2h-2z`} fill="#684b4a" />
          <path className="rabbit-mouth-chew" d={`M30 ${art.mouthY}h4v4h-4z`} fill="#684b4a" />
        </g>
      </g>
      <AccessoryMark id={accessory} transform={`translate(32 ${variant === "baby" ? 55 : variant === "growing" ? 51 : 48})`} />
      <g transform={`translate(${art.armX} ${art.armY})`}><path className="rabbit-arm need-paw paw-left" d="M16 42h5v2h2v6h-3v2h-5v-3h-2v-5h3z" /></g>
      <g transform={`translate(${-art.armX} ${art.armY})`}><path className="rabbit-arm need-paw paw-right" d="M43 42h5v2h3v5h-2v3h-5v-2h-3v-6h2z" /></g>
    </g>
  </svg>;
}
