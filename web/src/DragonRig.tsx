import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./dragon-rig.css";

// Lavender skin, pale snout, golden forehead and star-tipped horns retain the
// source identity. Folded hatchling wings become articulated flight wings.
export const dragonStages = {
  baby: {
    head: "M22 30h19v3h7v5h4v10h-4v5h-7v3H22v-3h-7v-5h-3V38h4v-5h6z",
    body: "M24 50h14v3h7v8h-6v3H23v-3h-6v-7h7z",
    muzzle: "M27 43h10v3h5v6h-5v3H26v-3h-5v-6h6z",
    belly: "M25 57h13v5H25z",
    hornLeft: "M18 36h-5v-5H9v-6h4v4h6v3h4v4z", hornRight: "M41 36v-4h4v-3h6v-4h4v6h-4v5z",
    starLeft: "M10 18h3v4h4v3h-4v4h-3v-4H6v-3h4z", starRight: "M51 18h3v4h4v3h-4v4h-3v-4h-4v-3h4z",
    crest: "M27 31h10v3h-3v4h-4v-4h-3z",
    wingLeft: "M20 53h-6v-3h-4v-8h4v3h4v3h4z", wingRight: "M43 53h7v-3h4v-8h-4v3h-4v3h-4z",
    membraneLeft: "M14 46h3v3h3v2h-5v-2h-1z", membraneRight: "M47 46h3v3h-1v2h-5v-2h3z",
    tail: "M40 58h8v-4h7v-5h5v8h-4v6H40z",
    tailSpines: "M53 51h3v3h-3zM48 56h3v3h-3z",
    handLeft: "M16 50h6v3h3v6h-4v3h-6v-3h-3v-6h4z", handRight: "M41 50h6v3h4v6h-3v3h-6v-3h-3v-6h2z",
    footLeft: "M23 60h7v5H17v-3h6z", footRight: "M34 60h7v2h6v3H34z",
    eyeX: [23, 38], eyeY: 39, mouthY: 49, cheekY: 47, accessoryY: 58, accessoryScale: .68,
    headPivot: "32px 51px", handLeftPivot: "19px 53px", handRightPivot: "44px 53px", wingLeftPivot: "21px 51px", wingRightPivot: "43px 51px", tailPivot: "42px 60px",
  },
  growing: {
    head: "M23 24h16v3h8v4h5v12h-4v5h-8v4H22v-4h-7v-5h-4V32h5v-5h7z",
    body: "M25 46h13v3h7v9h-4v6H22v-5h-6v-8h9z",
    muzzle: "M27 37h11v3h5v8h-5v3H25v-3h-5v-8h7z",
    belly: "M26 51h11v4h4v6H24v-7h2z",
    hornLeft: "M17 30h-5v-5H7V14h4v7h6v4h6v5z", hornRight: "M41 30v-5h6v-4h6v-7h4v11h-5v5z",
    starLeft: "M8 7h3v4h5v3h-5v5H8v-5H3v-3h5z", starRight: "M53 7h3v4h5v3h-5v5h-3v-5h-5v-3h5z",
    crest: "M26 25h12v4h-4v5h-4v-5h-4z",
    wingLeft: "M20 48h-6v-4H8v-6H3V27h4v5h6v5h5v4h4z", wingRight: "M43 48h7v-4h6v-6h5V27h-4v5h-6v5h-5v4h-4z",
    membraneLeft: "M7 34h5v5h5v6h-3v-3H9v-4H7z", membraneRight: "M52 34h5v4h-2v4h-5v3h-3v-6h5z",
    tail: "M40 56h9v-5h5V40h6v16h-5v7H40z",
    tailSpines: "M55 43h4v4h-4zM51 51h4v3h-4zM47 57h3v3h-3z",
    handLeft: "M14 44h6v3h4v7h-4v4h-7v-4h-3v-6h4z", handRight: "M43 44h6v-3h4v4h2v7h-4v5h-7v-4h-3v-6h2z",
    footLeft: "M22 57h8v8H13v-4h9z", footRight: "M34 57h9v4h8v4H34z",
    eyeX: [23, 38], eyeY: 33, mouthY: 43, cheekY: 41, accessoryY: 54, accessoryScale: .8,
    headPivot: "32px 46px", handLeftPivot: "18px 47px", handRightPivot: "47px 47px", wingLeftPivot: "21px 45px", wingRightPivot: "43px 45px", tailPivot: "42px 58px",
  },
  adult: {
    head: "M24 18h15v3h8v5h5v11h-4v5h-8v4H22v-4h-7v-5h-4V27h5v-6h8z",
    body: "M24 41h16v4h6v10h2v7h-7v3H21v-4h-6V49h5v-4h4z",
    muzzle: "M27 31h11v3h6v8h-6v3H25v-3h-6v-8h8z",
    belly: "M25 47h14v4h3v9h-4v2H24V51h1z",
    hornLeft: "M18 25h-6v-5H6V8h4v8h7v4h6v5z", hornRight: "M41 25v-5h6v-4h7V8h4v12h-6v5z",
    starLeft: "M7 1h3v4h5v3h-5v5H7V8H2V5h5z", starRight: "M54 1h3v4h5v3h-5v5h-3V8h-5V5h5z",
    crest: "M26 19h13v4h-4v6h-5v-6h-4z",
    wingLeft: "M20 46h-7v-5H7v-7H2V20h4v5h6v5h5v7h5z", wingRight: "M43 46h8v-5h6v-7h5V20h-4v5h-6v5h-5v7h-5z",
    membraneLeft: "M6 27h5v5h5v8h-3v-3H8v-6H6z", membraneRight: "M53 27h5v4h-2v6h-5v3h-3v-8h5z",
    tail: "M41 55h9V43h-3v-8h5v4h5v-8h5v19h-5v11h-7v4H40z",
    tailSpines: "M58 34h3v5h-3zM50 39h4v4h-4zM52 49h4v4h-4zM47 58h4v3h-4z",
    handLeft: "M15 40h6v4h4v8h-4v4h-8v-4h-3v-8h5z", handRight: "M43 40h6v4h5v8h-4v4h-8v-4h-3v-8h4z",
    footLeft: "M21 57h9v8H11v-4h10z", footRight: "M34 57h9v4h10v4H34z",
    eyeX: [23, 38], eyeY: 27, mouthY: 37, cheekY: 35, accessoryY: 51, accessoryScale: .88,
    headPivot: "32px 41px", handLeftPivot: "19px 44px", handRightPivot: "47px 44px", wingLeftPivot: "21px 42px", wingRightPivot: "43px 42px", tailPivot: "43px 58px",
  },
} as const;

export function DragonRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = dragonStages[variant];
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite dragon-rig dragon-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={petStageLabel(8, variant)} shapeRendering="crispEdges">
    <g stroke="#382c2a" strokeWidth="2" strokeLinejoin="miter" fill="#b39ddb">
      <g className="dragon-tail" style={{ transformOrigin: art.tailPivot }}><path d={art.tail} /><path className="dragon-tail-spines" d={art.tailSpines} fill="#8e6fc4" stroke="none" /></g>
      <g className="dragon-wing dragon-wing-left" style={{ transformOrigin: art.wingLeftPivot }}><path d={art.wingLeft} /><path className="dragon-membrane" d={art.membraneLeft} fill="#8e6fc4" stroke="none" /></g>
      <g className="dragon-wing dragon-wing-right" style={{ transformOrigin: art.wingRightPivot }}><path d={art.wingRight} /><path className="dragon-membrane" d={art.membraneRight} fill="#8e6fc4" stroke="none" /></g>
      <g className="dragon-foot dragon-foot-left" style={{ transformOrigin: "26px 61px" }}><path d={art.footLeft} /></g>
      <g className="dragon-foot dragon-foot-right" style={{ transformOrigin: "38px 61px" }}><path d={art.footRight} /></g>
      <g className="dragon-torso"><path className="dragon-body-shape" d={art.body} /><path className="dragon-belly" d={art.belly} fill="#ede3fa" stroke="none" /><AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY}) scale(${art.accessoryScale})`} /></g>
      <g className="dragon-head" style={{ transformOrigin: art.headPivot }}>
        <g className="dragon-horns"><path className="dragon-horn" d={art.hornLeft} fill="#8e6fc4" /><path className="dragon-horn" d={art.hornRight} fill="#8e6fc4" /><path className="dragon-stars" d={`${art.starLeft}${art.starRight}`} fill="#ffd65a" stroke="none" /></g>
        <path className="dragon-head-shape" d={art.head} />
        <path className="dragon-crest" d={art.crest} fill="#ffe066" stroke="none" />
        <path className="dragon-muzzle" d={art.muzzle} fill="#ede3fa" stroke="none" />
        <g className="sprite-face" fill="#382c2a" stroke="none">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="4" height="5" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 1}h1v2h4v-2h1v4h-6z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h4v1h1v2h-1v-1h-4v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 2} width="6" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="dragon-cheeks" d={`M15 ${art.cheekY}h6v2h-6zm29 0h6v2h-6z`} fill="#ff8c9e" />
          <path className="dragon-nostrils" d={`M28 ${art.mouthY - 3}h1v1h-1zm7 0h1v1h-1z`} />
          <path className="dragon-smile" d={`M27 ${art.mouthY}h2v2h6v-2h2v4H27z`} />
          <path className="dragon-mouth-open" d={`M29 ${art.mouthY}h6v4h-6z`} fill="#ff788c" />
        </g>
      </g>
      <g className="dragon-hand dragon-hand-left" style={{ transformOrigin: art.handLeftPivot }}><path d={art.handLeft} /></g>
      <g className="dragon-hand dragon-hand-right" style={{ transformOrigin: art.handRightPivot }}><path d={art.handRight} /></g>
    </g>
  </svg>;
}
