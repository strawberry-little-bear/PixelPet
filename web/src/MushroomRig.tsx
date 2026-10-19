import { petStageLabel } from "./stageLooks";
import { AccessoryMark } from "./EquipmentArt";
import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./mushroom-rig.css";

// A button under a hood, a tilted young cap, then an open umbrella. The face
// belongs to the cream stalk, not the moving cap. No animal ears or tail.
export const mushroomStages = {
  baby: {
    cap: "M24 20h16v3h7v4h5v7h3v12h-7v4h-5V41h-4v-3H25v3h-5v9h-6v-4H9V34h4v-7h5v-4h6z",
    rim: "M10 40h5v5h5v4h-6v-4h-4zm34 0h9v5h-6v4h-4v-4h1z",
    spots: "M24 25h4v4h-4zM36 25h3v3h-3zM16 33h4v4h-4zM42 32h5v4h-5zM28 33h4v3h-4z",
    gills: "M16 43h3v4h-3zm29-1h3v5h-3z",
    stem: "M25 36h14v4h5v14h-4v7H24v-5h-5V41h6z",
    shade: "M20 48h3v7h4v4h-3v-4h-4zm18 8h4v3h-4z",
    armLeft: "M20 48h4v7h-3v3h-6v-3h-3v-5h4v-2z",
    armRight: "M40 48h5v2h5v5h-3v3h-6v-3h-1z",
    footLeft: "M23 59h7v5H18v-3h5z",
    footRight: "M34 59h7v2h5v3H34z",
    eyeX: [25, 36], eyeY: 43, cheekY: 49, mouthY: 49, accessoryY: 56, accessoryScale: .75,
    capPivot: "32px 39px", armLeftPivot: "22px 50px", armRightPivot: "42px 50px",
  },
  growing: {
    cap: "M25 11h13v3h8v5h6v5h5v12h-8v4h-7v-8H25v3h-5v7H9v-5H6V27h5v-6h7v-5h7z",
    rim: "M7 32h7v5h6v4H9v-5H7zm36-3h12v6h-7v4h-6v-5h1z",
    spots: "M27 16h5v4h-5zM37 20h4v4h-4zM17 24h5v4h-5zM46 26h5v3h-5zM25 27h4v3h-4zM11 31h3v3h-3z",
    gills: "M12 35h3v4h-3zm5 0h3v5h-3zm27-2h3v5h-3zm5-2h3v4h-3z",
    stem: "M25 30h16v5h5v17h-4v8H23v-5h-5V40h3v-5h4z",
    shade: "M19 46h4v8h5v4h-5v-4h-4zm20 7h5v5h-5z",
    armLeft: "M21 44h4v8h-3v5h-7v-3h-3v-6h4v-4z",
    armRight: "M42 45h5v-4h5v3h3v6h-4v4h-7v-3h-2z",
    footLeft: "M22 55h8v7h-8v2H12v-4h10z",
    footRight: "M35 58h8v3h8v4H35z",
    eyeX: [25, 37], eyeY: 40, cheekY: 47, mouthY: 47, accessoryY: 54, accessoryScale: .85,
    capPivot: "32px 33px", armLeftPivot: "23px 47px", armRightPivot: "44px 47px",
  },
  adult: {
    cap: "M25 5h14v3h9v5h6v6h5v7h2v6H3v-6h3v-7h5v-6h6V8h8z",
    rim: "M4 27h56v5h-8v3H12v-3H4z",
    spots: "M26 10h5v4h-5zM38 12h4v4h-4zM17 17h5v4h-5zM46 20h5v4h-5zM29 20h4v4h-4zM9 25h4v3H9zM39 25h4v3h-4z",
    gills: "M13 31h3v4h-3zm6 0h3v4h-3zm6 0h3v4h-3zm11 0h3v4h-3zm6 0h3v4h-3zm6 0h3v4h-3z",
    stem: "M24 31h17v4h5v18h-4v8H22v-6h-4V40h3v-5h3z",
    shade: "M19 44h4v10h5v5h-6v-5h-3zm20 10h5v5h-5z",
    armLeft: "M20 43h5v8h-4v6h-7v-4h-4v-6h5v-4z",
    armRight: "M43 43h5v4h6v6h-4v4h-7v-6h-2v-5h2z",
    footLeft: "M22 58h8v7H13v-4h9z",
    footRight: "M35 58h8v3h9v4H35z",
    eyeX: [25, 37], eyeY: 38, cheekY: 45, mouthY: 45, accessoryY: 52, accessoryScale: .9,
    capPivot: "32px 32px", armLeftPivot: "23px 46px", armRightPivot: "45px 46px",
  },
} as const;

export function MushroomRig({ stage, expression = "awake", motion = "idle", need, className = "", accessory }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion;
  need?: NeedKind; className?: string; accessory?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = mushroomStages[variant];
  const activeNeed = motion === "idle" ? need : undefined;
  return <svg viewBox="0 0 64 68" className={`pet-sprite mushroom-rig mushroom-${variant} rig-motion-${motion} expression-${expression} ${activeNeed ? `gesture-${activeNeed}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={petStageLabel(4, variant)} shapeRendering="crispEdges">
    <g stroke="#382c2a" strokeWidth="2" strokeLinejoin="miter" fill="#fff1dc">
      <g className="mushroom-foot foot-left"><path d={art.footLeft} /></g>
      <g className="mushroom-foot foot-right"><path d={art.footRight} /></g>
      <g className="mushroom-stalk">
        <path className="mushroom-stem-shape" d={art.stem} />
        <path className="mushroom-stem-shade" d={art.shade} fill="#efd7b6" stroke="none" />
        <g className="sprite-face" stroke="none" fill="#382c2a">
          <g className="sprite-eyes-open">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy">{art.eyeX.map(x => <path key={x} d={`M${x - 1} ${art.eyeY + 2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired">{art.eyeX.map(x => <rect key={x} x={x - 1} y={art.eyeY + 2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyeX.map(x => <rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="mushroom-cheeks" d={`M20 ${art.cheekY}h6v2h-6zm18 0h6v2h-6z`} fill="#ff8c9e" />
          <path className="mushroom-smile" d={`M28 ${art.mouthY}h2v2h5v-2h2v3h-3v1h-4v-1h-2z`} />
          <path className="mushroom-mouth-open" d={`M30 ${art.mouthY}h5v4h-5z`} fill="#a96d69" />
        </g>
        <AccessoryMark id={accessory} transform={`translate(32 ${art.accessoryY}) scale(${art.accessoryScale})`} />
      </g>
      <g className="mushroom-cap" style={{ transformOrigin: art.capPivot }}>
        <path className="mushroom-cap-shape" d={art.cap} fill="#ff6b6b" />
        <path className="mushroom-rim" d={art.rim} fill="#ed8a7e" stroke="none" />
        <path className="mushroom-gills" d={art.gills} fill="#c46d66" stroke="none" />
        <path className="mushroom-spots" d={art.spots} fill="#fffef4" stroke="none" />
      </g>
      <g className="mushroom-arm arm-left" style={{ transformOrigin: art.armLeftPivot }}><path d={art.armLeft} /></g>
      <g className="mushroom-arm arm-right" style={{ transformOrigin: art.armRightPivot }}><path d={art.armRight} /></g>
    </g>
  </svg>;
}
