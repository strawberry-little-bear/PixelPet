import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./frog-rig.css";

// Keep the original lime skin, raised white eyes with lemon-yellow marks,
// pale belly and pink cheeks. Each age has separately drawn crouch anatomy.
export const frogStages = {
  baby: {
    head: "M19 32h25v3h8v5h4v8h-4v5H13v-5H9v-8h4v-5h6z",
    body: "M23 47h18v3h6v8h-4v5H21v-4h-5v-8h7z",
    eyeLeft: "M16 35V26h4v-4h8v4h4v10z",
    eyeRight: "M34 36V26h4v-4h8v4h4v10z",
    lemonLeft: "M20 24h7v3h-4v3h-3z", lemonRight: "M39 25h7v3h-3v3h-4z",
    belly: "M26 52h12v3h4v6H23v-6h3z",
    throat: "M28 53h9v2h3v3H25v-3h3z",
    handLeft: "M14 49h6v6h3v5h-3v3h-4v-2h-4v-3H9v-5h5z",
    handRight: "M44 49h6v4h5v5h-3v3h-4v2h-4v-3h-3v-5h3z",
    thighLeft: "M16 54h7v4h3v5H12v-3H9v-4h7z", thighRight: "M41 54h7v2h7v4h-3v3H38v-5h3z",
    footLeft: "M15 61h10v4H9v-2H6v-4h4v2h3v-3h2z", footRight: "M39 61h10v-3h2v3h3v-2h4v4h-3v2H39z",
    eyeX: [22, 40], eyeY: 28, mouthY: 45, cheekY: 44, accessoryY: 57, accessoryScale: .68,
    headPivot: "32px 49px", handLeftPivot: "17px 51px", handRightPivot: "47px 51px",
  },
  growing: {
    head: "M19 25h24v3h9v5h4v9h-4v5H13v-5H9v-8h4v-6h6z",
    body: "M24 42h15v3h7v12h-4v6H21v-5h-5V47h8z",
    eyeLeft: "M14 29V19h4v-5h9v4h5v12z",
    eyeRight: "M34 29V17h5v-4h8v5h5v12z",
    lemonLeft: "M19 16h7v4h-4v3h-3z", lemonRight: "M40 15h6v3h3v3h-6v2h-3z",
    belly: "M26 47h11v3h5v10H23V51h3z",
    throat: "M27 47h10v2h4v3h-3v2H26v-2h-3v-3h4z",
    handLeft: "M12 44h6v7h3v7h-4v4h-4v-2H9v-3H6v-5h6z",
    handRight: "M46 42h5v-4h4v4h3v5h-4v5h-3v5h-5v-3h-4v-6h4z",
    thighLeft: "M15 51h8v6h4v6H9v-4H5v-5h10z", thighRight: "M42 50h7v4h8v6h-5v4H38v-8h4z",
    footLeft: "M13 61h13v4H7v-2H3v-4h4v2h3v-4h3z", footRight: "M39 60h11v-3h3v4h4v-3h3v5h-4v2H39z",
    eyeX: [21, 41], eyeY: 21, mouthY: 39, cheekY: 38, accessoryY: 54, accessoryScale: .8,
    headPivot: "32px 44px", handLeftPivot: "16px 47px", handRightPivot: "48px 45px",
  },
  adult: {
    head: "M18 19h28v4h8v5h3v9h-4v5H11v-5H7v-9h4v-5h7z",
    body: "M23 37h18v4h6v15h-5v8H20v-7h-5V43h8z",
    eyeLeft: "M12 24V13h4V8h10v4h6v13z",
    eyeRight: "M34 25V12h6V8h9v5h5v12z",
    lemonLeft: "M17 10h9v4h-5v4h-4z", lemonRight: "M41 10h7v4h3v4h-6v2h-4z",
    belly: "M25 43h14v4h4v13h-4v2H23V48h2z",
    throat: "M26 42h12v2h5v4h-4v2H25v-2h-4v-4h5z",
    handLeft: "M11 39h6v9h3v9h-3v5h-5v-3H8v-3H5v-5h6z",
    handRight: "M47 39h6v12h6v5h-3v3h-4v3h-5v-5h-3v-9h3z",
    thighLeft: "M13 48h9v7h5v9H8v-4H3v-7h10z", thighRight: "M42 48h9v5h10v7h-5v4H38v-9h4z",
    footLeft: "M11 60h15v5H6v-2H2v-5h4v2h2v-4h3z", footRight: "M39 60h14v-4h3v4h3v-2h3v5h-4v2H39z",
    eyeX: [20, 42], eyeY: 15, mouthY: 34, cheekY: 33, accessoryY: 51, accessoryScale: .88,
    headPivot: "32px 39px", handLeftPivot: "14px 42px", handRightPivot: "50px 42px",
  },
} as const;

export function FrogRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = frogStages[variant];
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite frog-rig frog-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={`柠檬蛙，${{ baby: "团蹲拢蹼", growing: "探身试跃", adult: "舒蹼鸣唱" }[variant]}`} shapeRendering="crispEdges">
    <g stroke="#382c2a" strokeWidth="2" strokeLinejoin="miter" fill="#9bd65e">
      <g className="frog-thigh frog-thigh-left"><path d={art.thighLeft} /></g>
      <g className="frog-thigh frog-thigh-right"><path d={art.thighRight} /></g>
      <g className="frog-foot frog-foot-left"><path d={art.footLeft} /></g>
      <g className="frog-foot frog-foot-right"><path d={art.footRight} /></g>
      <g className="frog-torso">
        <path className="frog-body-shape" d={art.body} />
        <path className="frog-belly" d={art.belly} fill="#e8f8c9" stroke="none" />
        <path className="frog-throat" d={art.throat} fill="#e8f8c9" stroke="#9bd65e" strokeWidth="1" />
        <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY}) scale(${art.accessoryScale})`} />
      </g>
      <g className="frog-head" style={{ transformOrigin: art.headPivot }}>
        <path className="frog-head-shape" d={art.head} />
        <g className="frog-eye-pods" fill="#fff">
          <path className="frog-eye-pod frog-eye-left" d={art.eyeLeft} />
          <path className="frog-eye-pod frog-eye-right" d={art.eyeRight} />
          <path className="frog-lemon-marks" d={`${art.lemonLeft}${art.lemonRight}`} fill="#ffe066" stroke="none" />
        </g>
        <g className="sprite-face" fill="#382c2a" stroke="none">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="4" height="6" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}h1v1h4v-1h1v3h-6z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 3}v-2h1v-1h4v1h1v2h-1v-1h-4v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 3} width="6" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="frog-cheeks" d={`M12 ${art.cheekY}h7v2h-7zm33 0h7v2h-7z`} fill="#ff8c9e" />
          <path className="frog-nostrils" d={`M28 ${art.mouthY - 4}h1v1h-1zm7 0h1v1h-1z`} />
          <path className="frog-smile" d={`M24 ${art.mouthY - 1}h2v2h3v2h6v-2h3v-2h2v3h-3v2H27v-2h-3z`} />
          <path className="frog-mouth-open" d={`M29 ${art.mouthY + 1}h6v4h-6z`} fill="#a96d69" />
        </g>
      </g>
      <g className="frog-hand frog-hand-left" style={{ transformOrigin: art.handLeftPivot }}><path d={art.handLeft} /></g>
      <g className="frog-hand frog-hand-right" style={{ transformOrigin: art.handRightPivot }}><path d={art.handRight} /></g>
    </g>
  </svg>;
}
