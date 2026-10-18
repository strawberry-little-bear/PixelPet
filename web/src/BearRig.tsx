import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./bear-rig.css";

// Peach-shaped cheeks, round ears, cream muzzle and the two-leaf sprout are
// retained from the source. Each age has its own anatomy, not a scaled cub.
export const bearStages = {
  baby: {
    head: "M23 29h18v3h7v5h5v10h-4v5h-7v4h-6v3h-8v-3h-7v-4h-6v-5h-4V37h5v-5h7z",
    body: "M24 52h15v3h6v6h-6v3H23v-3h-5v-6h6z",
    earLeft: "M12 37V28h4v-4h8v4h5v9z",
    earRight: "M36 37V28h4v-4h8v4h5v9z",
    innerLeft: "M16 29h7v6h-7z", innerRight: "M41 29h7v6h-7z",
    sproutStem: "M29 29V20h3v9zM34 29V22h3v7z",
    sproutLeaves: "M24 19h9v3h-9zM35 19h8v3h-5v3h-3z",
    muzzle: "M28 44h10v3h5v6h-5v3H26v-3h-5v-5h7z",
    belly: "M25 57h13v4H25z",
    pawLeft: "M18 50h5v3h4v5h-3v3h-8v-4h-3v-5h5z",
    pawRight: "M40 50h6v2h4v5h-3v4h-8v-3h-2v-5h3z",
    footLeft: "M22 59h7v6H17v-3h5z", footRight: "M35 59h7v3h5v3H35z",
    padLeft: "M20 62h6v2h-6z", padRight: "M38 62h6v2h-6z",
    eyeX: [24, 37], eyeY: 40, mouthY: 49, cheekY: 49, accessoryY: 58, accessoryScale: .72,
    headPivot: "32px 52px", earLeftPivot: "21px 35px", earRightPivot: "44px 35px",
    sproutPivot: "32px 29px", pawLeftPivot: "22px 52px", pawRightPivot: "42px 52px",
  },
  growing: {
    head: "M23 22h16v3h8v4h5v13h-4v5h-7v4h-6v3h-7v-3h-6v-4h-7v-5h-4V30h5v-5h7z",
    body: "M25 47h14v3h6v8h-4v6H23v-5h-6v-8h8z",
    earLeft: "M11 30V20h4v-4h8v3h5v12z",
    earRight: "M36 29V18h5v-4h7v4h5v12z",
    innerLeft: "M15 21h7v7h-7z", innerRight: "M41 19h7v7h-7z",
    sproutStem: "M29 23V12h3v11zM35 23V14h3v9z",
    sproutLeaves: "M22 10h10v4h-7v-1h-3zM36 9h10v4h-6v4h-4z",
    muzzle: "M28 37h10v3h5v7h-5v3H26v-3h-5v-7h7z",
    belly: "M26 52h12v8H24v-5h2z",
    pawLeft: "M14 45h6v3h4v7h-3v4h-8v-4h-3v-6h4z",
    pawRight: "M43 43h5v-3h5v4h2v7h-4v4h-7v-3h-3v-6h2z",
    footLeft: "M22 56h8v7h-6v2H13v-4h9z", footRight: "M35 57h8v3h9v5H35z",
    padLeft: "M16 62h8v2h-8z", padRight: "M40 62h8v2h-8z",
    eyeX: [24, 37], eyeY: 33, mouthY: 42, cheekY: 42, accessoryY: 54, accessoryScale: .82,
    headPivot: "32px 47px", earLeftPivot: "20px 29px", earRightPivot: "44px 28px",
    sproutPivot: "32px 23px", pawLeftPivot: "19px 48px", pawRightPivot: "46px 47px",
  },
  adult: {
    head: "M24 17h15v3h8v4h5v12h-4v6h-7v4h-6v3h-6v-3h-7v-4h-7v-6h-4V25h5v-5h8z",
    body: "M25 42h14v3h6v9h3v7h-7v4H22v-4h-6v-9h4v-7h5z",
    earLeft: "M11 25V14h4v-4h9v4h5v12z",
    earRight: "M36 25V14h5v-4h8v4h5v12z",
    innerLeft: "M15 15h8v8h-8z", innerRight: "M41 15h8v8h-8z",
    sproutStem: "M29 18V6h3v12zM35 18V8h3v10z",
    sproutLeaves: "M21 4h11v4h-8V6h-3zM36 3h11v4h-6v4h-5z",
    muzzle: "M28 32h10v3h6v7h-6v3H26v-3h-6v-7h8z",
    belly: "M25 48h14v11h-3v3H24V51h1z",
    pawLeft: "M15 41h6v3h4v8h-3v4h-9v-4h-3v-7h5z",
    pawRight: "M43 41h6v4h5v7h-4v4h-8v-4h-3v-8h4z",
    footLeft: "M22 57h8v8H12v-4h10z", footRight: "M35 57h8v4h10v4H35z",
    padLeft: "M16 61h10v3H16z", padRight: "M39 61h10v3H39z",
    eyeX: [24, 37], eyeY: 28, mouthY: 37, cheekY: 37, accessoryY: 50, accessoryScale: .9,
    headPivot: "32px 43px", earLeftPivot: "20px 24px", earRightPivot: "45px 24px",
    sproutPivot: "32px 18px", pawLeftPivot: "20px 44px", pawRightPivot: "46px 44px",
  },
} as const;

export function BearRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = bearStages[variant];
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite bear-rig bear-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={`蜜桃熊，${{ baby: "桃团抱爪", growing: "探身踏步", adult: "挺身揉颊" }[variant]}`} shapeRendering="crispEdges">
    <g stroke="#382c2a" strokeWidth="2" strokeLinejoin="miter" fill="#ffc2a0">
      <g className="bear-foot foot-left"><path d={art.footLeft} /><path d={art.padLeft} fill="#ffb48a" stroke="none" /></g>
      <g className="bear-foot foot-right"><path d={art.footRight} /><path d={art.padRight} fill="#ffb48a" stroke="none" /></g>
      <g className="bear-torso">
        <path className="bear-body-shape" d={art.body} />
        <path className="bear-belly" d={art.belly} fill="#ffe8d6" stroke="none" />
        <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY}) scale(${art.accessoryScale})`} />
      </g>
      <g className="bear-head" style={{ transformOrigin: art.headPivot }}>
        <g className="bear-ear ear-left" style={{ transformOrigin: art.earLeftPivot }}><path d={art.earLeft} /><path d={art.innerLeft} fill="#ffb48a" stroke="none" /></g>
        <g className="bear-ear ear-right" style={{ transformOrigin: art.earRightPivot }}><path d={art.earRight} /><path d={art.innerRight} fill="#ffb48a" stroke="none" /></g>
        <path className="bear-head-shape" d={art.head} />
        <g className="bear-sprout" style={{ transformOrigin: art.sproutPivot }} stroke="none">
          <path className="bear-sprout-stem" d={art.sproutStem} fill="#7fc96f" />
          <path className="bear-sprout-leaves" d={art.sproutLeaves} fill="#5fbf6b" />
        </g>
        <path className="bear-muzzle" d={art.muzzle} fill="#ffe8d6" stroke="none" />
        <g className="sprite-face" fill="#382c2a" stroke="none">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="bear-cheeks" d={`M16 ${art.cheekY}h6v2h-6zm27 0h6v2h-6z`} fill="#ff8c9e" />
          <path className="bear-nose" d={`M30 ${art.mouthY - 3}h4v3h-4z`} />
          <path className="bear-smile" d={`M31 ${art.mouthY}h2v3h2v-2h2v3h-3v1h-2v-1h-3v-3h2z`} />
          <path className="bear-mouth-open" d={`M30 ${art.mouthY + 1}h5v4h-5z`} fill="#a96d69" />
        </g>
      </g>
      <g className="bear-paw bear-paw-left" style={{ transformOrigin: art.pawLeftPivot }}><path d={art.pawLeft} /></g>
      <g className="bear-paw bear-paw-right" style={{ transformOrigin: art.pawRightPivot }}><path d={art.pawRight} /></g>
    </g>
  </svg>;
}
