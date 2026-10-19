import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./dolphin-rig.css";

// Same canvas, separately drafted calves/juveniles/adults. Dolphin anatomy has
// two pectoral flippers, a dorsal fin and horizontal flukes — no paws or feet.
export const dolphinStages = {
  baby: {
    head: "M24 22h16v3h7v5h4v12h-4v7H17v-6h-4V32h4v-6h7z",
    body: "M22 40h20v4h5v9h-5v5H23v-4h-5V44h4z",
    belly: "M26 45h13v5h3v5h-5v2h-9v-3h-5v-5h3z",
    dorsal: "M31 25V14h4v3h5v5h3v6z",
    snout: "M24 38h16v3h5v7h-5v3H24v-3h-5v-7h5z",
    gleam: "M25 27h6v3h-3v4h-3z",
    flipperLeft: "M18 40h5v7h-3v6h-7v-3H9v-5h4v-3h5z",
    flipperRight: "M41 40h5v3h5v4h3v5h-7v-3h-6z",
    flipperLightLeft: "M13 46h6v3h-6z",
    flipperLightRight: "M45 45h4v3h-4z",
    tail: "M29 54h9v6h-2v4h-7v-4h-3v-4h3z",
    flukes: "M31 61h5v-3h9v4h-3v4h-8v-2h-3v2h-9v-4h-3v-4h9v3z",
    eyeX: [23, 38], eyeY: 34, cheekY: 41, mouthY: 45, accessoryY: 52,
    headPivot: "32px 43px", flipperLeftPivot: "21px 42px", flipperRightPivot: "43px 42px", tailPivot: "33px 55px",
  },
  growing: {
    head: "M23 17h16v3h8v5h4v13h-4v6H17v-5h-5V28h4v-6h7z",
    body: "M23 35h19v5h5v11h-5v5H26v-4h-7V41h4z",
    belly: "M27 41h12v4h4v7h-5v3h-8v-4h-6v-6h3z",
    dorsal: "M29 21V7h4v3h5v5h6v9z",
    snout: "M23 33h17v3h7v8h-7v3H23v-3h-6v-8h6z",
    gleam: "M23 22h8v3h-4v5h-4z",
    flipperLeft: "M19 35h5v8h-4v7h-6v5H8v-7h3v-6h4v-4h4z",
    flipperRight: "M42 37h5v-4h4v-5h5v3h3v8h-5v5h-7v3h-5z",
    flipperLightLeft: "M13 44h4v6h-4z",
    flipperLightRight: "M50 35h4v4h-4z",
    tail: "M32 51h10v4h4v6h-7v-3h-7z",
    flukes: "M41 58h5v-5h9v4h4v4h-7v3h-8v-2h-5v3H28v-4h5v-5h8z",
    eyeX: [22, 38], eyeY: 28, cheekY: 36, mouthY: 40, accessoryY: 48,
    headPivot: "32px 37px", flipperLeftPivot: "22px 38px", flipperRightPivot: "44px 39px", tailPivot: "36px 52px",
  },
  adult: {
    head: "M23 12h16v3h8v5h5v12h-4v7H17v-5h-6V23h4v-6h8z",
    body: "M24 31h19v5h5v10h-5v6H29v-4h-7V38h2z",
    belly: "M28 38h12v4h4v5h-6v4h-7v-5h-6v-5h3z",
    dorsal: "M29 16V2h5v4h5v5h6v9z",
    snout: "M22 28h18v3h9v8h-9v4H23v-3h-8v-8h7z",
    gleam: "M23 17h9v3h-5v6h-4z",
    flipperLeft: "M20 31h5v9h-4v7h-5v7H9v-5H6v-6h5v-5h4v-4h5z",
    flipperRight: "M44 33h6v4h6v5h5v7h-7v-3h-6v-5h-4z",
    flipperLightLeft: "M12 42h5v7h-5z",
    flipperLightRight: "M50 40h5v3h-5z",
    tail: "M34 47h9v5h4v6h-3v3h-7v-4h-4v-6h1z",
    flukes: "M39 58h6v-5h11v4h5v5h-9v4h-8v-3h-4v3H28v-4h-6v-5h11v-3h6z",
    eyeX: [22, 38], eyeY: 23, cheekY: 31, mouthY: 36, accessoryY: 44,
    headPivot: "32px 33px", flipperLeftPivot: "23px 35px", flipperRightPivot: "46px 36px", tailPivot: "38px 48px",
  },
} as const;

export function DolphinRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion;
  need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = dolphinStages[variant];
  // Direct previews must obey the same action-over-need priority as PetScene.
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite dolphin-rig dolphin-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={petStageLabel(3, variant)} shapeRendering="crispEdges">
    <g stroke="#382c29" strokeWidth="2" strokeLinejoin="miter" fill="#8fd4f0">
      <g className="dolphin-tail" style={{ transformOrigin: art.tailPivot }}><path d={art.tail} /><path className="dolphin-flukes" d={art.flukes} fill="#74c6e5" /></g>
      <g className="dolphin-dorsal"><path d={art.dorsal} fill="#74c6e5" /></g>
      <g className="dolphin-torso"><path className="dolphin-body-shape" d={art.body} /><path className="dolphin-belly" d={art.belly} fill="#bde8f8" stroke="none" /></g>
      <g className="dolphin-head" style={{ transformOrigin: art.headPivot }}>
        <path className="dolphin-head-shape" d={art.head} />
        <path className="dolphin-gleam" d={art.gleam} fill="#74c6e5" stroke="none" />
        <path className="dolphin-snout" d={art.snout} fill="#bde8f8" stroke="none" />
        <g className="sprite-face" stroke="none" fill="#382c29">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="dolphin-cheeks" d={`M16 ${art.cheekY}h7v2h-7zm25 0h7v2h-7z`} fill="#ff8f9d" />
          <path className="dolphin-smile" d={`M26 ${art.mouthY - 2}h2v2h8v-2h2v4h-3v2h-6v-2h-3z`} />
          <path className="dolphin-mouth-open" d={`M29 ${art.mouthY}h7v5h-7z`} fill="#875559" />
        </g>
      </g>
      <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY})`} />
      <g className="dolphin-flipper flipper-left" style={{ transformOrigin: art.flipperLeftPivot }}><path d={art.flipperLeft} /><path d={art.flipperLightLeft} fill="#bde8f8" stroke="none" /></g>
      <g className="dolphin-flipper flipper-right" style={{ transformOrigin: art.flipperRightPivot }}><path d={art.flipperRight} /><path d={art.flipperLightRight} fill="#bde8f8" stroke="none" /></g>
    </g>
  </svg>;
}
