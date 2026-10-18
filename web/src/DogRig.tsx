import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./dog-rig.css";

// Caramel coat, hanging ears, cream muzzle and red collar/gold tag retain the
// original dog's identity. Paws, ears and tail articulate without scaling it.
export const dogStages = {
  baby: {
    head: "M23 27h18v3h7v5h4v11h-4v6h-7v4H23v-3h-7v-5h-4V36h4v-5h7z",
    body: "M24 51h16v3h7v7h-7v3H22v-3h-5v-7h7z",
    earLeft: "M16 31h6v9h-3v12h-4v3h-7V36h4v-5z",
    earRight: "M43 31h7v4h5v20h-7v-3h-4V41h-3v-7h2z",
    innerLeft: "M11 37h4v13h-4z", innerRight: "M49 38h3v12h-3z",
    muzzle: "M26 42h13v3h5v8h-5v3H25v-3h-5v-8h6z",
    bib: "M25 57h14v5H25z",
    collar: "M20 55h24v3H20z", tag: "M30 58h5v5h-5z",
    tail: "M41 57h10v-4h7v3h3v6h-5v3H43v-4h10v-3H41z",
    tailTip: "M54 56h5v4h-5z",
    pawLeft: "M15 51h7v3h4v6h-4v3h-9v-3h-2v-6h4z",
    pawRight: "M42 51h7v3h4v6h-4v3h-9v-3h-2v-6h4z",
    footLeft: "M22 60h8v5H15v-3h7z", footRight: "M34 60h8v2h8v3H34z",
    toesLeft: "M18 63h2v2h-2zm5 0h2v2h-2z", toesRight: "M39 63h2v2h-2zm5 0h2v2h-2z",
    eyeX: [23, 38], eyeY: 38, noseY: 45, mouthY: 49, cheekY: 47,
    accessoryY: 59, accessoryScale: .66,
    headPivot: "32px 52px", earLeftPivot: "18px 33px", earRightPivot: "46px 33px",
    pawLeftPivot: "19px 54px", pawRightPivot: "46px 54px", tailPivot: "44px 60px",
    footLeftPivot: "26px 62px", footRightPivot: "38px 62px",
  },
  growing: {
    head: "M23 21h17v3h7v5h5v12h-4v5h-7v5H22v-4h-7v-6h-4V30h5v-5h7z",
    body: "M25 46h14v3h5v7h5v6h-8v3H21v-5h-5v-9h9z",
    earLeft: "M16 25h6v8h-3v14h-4v5H6V32h4v-7z",
    earRight: "M43 25h7v5h6v17h-4v4h-7V37h-4v-8h2z",
    innerLeft: "M9 33h5v14H9z", innerRight: "M49 32h4v13h-4z",
    muzzle: "M26 36h13v3h6v8h-6v4H24v-4h-5v-8h7z",
    bib: "M25 52h13v3h3v7H24v-7h1z",
    collar: "M20 50h25v3H20z", tag: "M29 53h7v5h-7z",
    tail: "M42 56h9v-6h4V39h6v5h-2v15h-5v5H42z",
    tailTip: "M56 41h4v5h-4z",
    pawLeft: "M14 45h7v3h4v7h-4v4h-8v-4h-3v-7h4z",
    pawRight: "M43 43h7v4h4v7h-4v4h-8v-4h-3v-7h4z",
    footLeft: "M21 57h9v8H12v-4h9z", footRight: "M35 56h9v4h8v5H35z",
    toesLeft: "M16 62h2v3h-2zm5 0h2v3h-2z", toesRight: "M41 62h2v3h-2zm5 0h2v3h-2z",
    eyeX: [23, 38], eyeY: 32, noseY: 39, mouthY: 43, cheekY: 41,
    accessoryY: 56, accessoryScale: .8,
    headPivot: "32px 47px", earLeftPivot: "18px 27px", earRightPivot: "46px 27px",
    pawLeftPivot: "18px 48px", pawRightPivot: "47px 47px", tailPivot: "44px 58px",
    footLeftPivot: "26px 60px", footRightPivot: "39px 60px",
  },
  adult: {
    head: "M24 15h16v3h7v5h5v12h-4v6h-8v5H23v-4h-8v-6h-4V24h5v-5h8z",
    body: "M25 41h14v4h6v9h3v8h-7v3H21v-4h-6V50h5v-5h5z",
    earLeft: "M16 19h6v9h-3v13h-4v6H5V26h4v-7z",
    earRight: "M43 19h8v6h7v17h-4v5H44V32h-3V23h2z",
    innerLeft: "M8 27h6v15H8z", innerRight: "M49 27h6v14h-6z",
    muzzle: "M26 30h13v3h7v8h-7v5H24v-5h-6v-8h8z",
    bib: "M25 47h14v4h3v10H24V51h1z",
    collar: "M19 45h27v3H19z", tag: "M29 48h7v6h-7z",
    tail: "M42 55h10V43h-3v-9h5v-6h6v7h2v12h-5v14h-7v4h-8z",
    tailTip: "M55 31h4v8h-4z",
    pawLeft: "M15 40h7v4h4v8h-4v4h-9v-4h-3v-8h5z",
    pawRight: "M43 40h7v4h5v8h-5v4h-9v-4h-3v-8h5z",
    footLeft: "M21 57h9v8H10v-4h11z", footRight: "M34 57h10v4h10v4H34z",
    toesLeft: "M15 61h2v4h-2zm6 0h2v4h-2z", toesRight: "M41 61h2v4h-2zm6 0h2v4h-2z",
    eyeX: [23, 38], eyeY: 26, noseY: 33, mouthY: 37, cheekY: 35,
    accessoryY: 52, accessoryScale: .88,
    headPivot: "32px 42px", earLeftPivot: "18px 21px", earRightPivot: "47px 21px",
    pawLeftPivot: "19px 44px", pawRightPivot: "47px 44px", tailPivot: "45px 58px",
    footLeftPivot: "26px 61px", footRightPivot: "39px 61px",
  },
} as const;

export function DogRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = dogStages[variant];
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite dog-rig dog-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={`焦糖犬，${{ baby: "趴团抱爪", growing: "侧耳探步", adult: "坐稳摇尾" }[variant]}`} shapeRendering="crispEdges">
    <g stroke="#382c2a" strokeWidth="2" strokeLinejoin="miter" fill="#c68a5a">
      <g className="dog-tail" style={{ transformOrigin: art.tailPivot }}><path d={art.tail} /><path className="dog-tail-tip" d={art.tailTip} fill="#a96f3f" stroke="none" /></g>
      <g className="dog-foot dog-foot-left" style={{ transformOrigin: art.footLeftPivot }}><path d={art.footLeft} /><path className="dog-toes" d={art.toesLeft} stroke="none" fill="#a96f3f" /></g>
      <g className="dog-foot dog-foot-right" style={{ transformOrigin: art.footRightPivot }}><path d={art.footRight} /><path className="dog-toes" d={art.toesRight} stroke="none" fill="#a96f3f" /></g>
      <g className="dog-torso">
        <path className="dog-body-shape" d={art.body} /><path className="dog-bib" d={art.bib} fill="#ffe9ce" stroke="none" />
        <path className="dog-collar" d={art.collar} fill="#e05252" stroke="none" /><path className="dog-tag" d={art.tag} fill="#ffd84d" stroke="none" />
        <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY}) scale(${art.accessoryScale})`} />
      </g>
      <g className="dog-head" style={{ transformOrigin: art.headPivot }}>
        <g className="dog-ear dog-ear-left" style={{ transformOrigin: art.earLeftPivot }}><path d={art.earLeft} /><path className="dog-ear-shade" d={art.innerLeft} fill="#a96f3f" stroke="none" /></g>
        <g className="dog-ear dog-ear-right" style={{ transformOrigin: art.earRightPivot }}><path d={art.earRight} /><path className="dog-ear-shade" d={art.innerRight} fill="#a96f3f" stroke="none" /></g>
        <path className="dog-head-shape" d={art.head} />
        <path className="dog-muzzle" d={art.muzzle} fill="#ffe9ce" stroke="none" />
        <g className="sprite-face" fill="#382c2a" stroke="none">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="4" height="5" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 1}h1v2h4v-2h1v4h-6z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h4v1h1v2h-1v-1h-4v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 2} width="6" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="dog-cheeks" d={`M15 ${art.cheekY}h6v2h-6zm29 0h6v2h-6z`} fill="#ff8c9e" />
          <path className="dog-nose" d={`M29 ${art.noseY}h6v4h-6z`} />
          <path className="dog-smile" d={`M27 ${art.mouthY}h2v2h6v-2h2v4H27z`} />
          <path className="dog-mouth-open" d={`M29 ${art.mouthY + 1}h6v4h-6z`} fill="#ff788c" />
        </g>
      </g>
      <g className="dog-paw dog-paw-left" style={{ transformOrigin: art.pawLeftPivot }}><path d={art.pawLeft} /></g>
      <g className="dog-paw dog-paw-right" style={{ transformOrigin: art.pawRightPivot }}><path d={art.pawRight} /></g>
    </g>
  </svg>;
}
