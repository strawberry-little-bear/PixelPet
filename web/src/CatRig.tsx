import type { Expression } from "./Sprite";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";
import type { GrowthStage } from "./types";
import "./cat-rig.css";

// Each stage is drafted on the same canvas: a tucked kitten, an inquisitive
// stepping youngster, and an upright adult with a long, independently moving tail.
export const catStages = {
  baby: {
    head: "M21 28h22v3h6v4h3v13h-3v4h-6v3H21v-3h-6v-4h-3V35h3v-4h6z",
    body: "M24 48h16v3h6v8h-5v4H23v-4h-5v-8h6z",
    earLeft: "M15 33V21h5v3h4v4h4v7z",
    earRight: "M37 29v-5h4v-4h6v14z",
    innerLeft: "M18 25h2v3h4v5h-6z", innerRight: "M41 28v-2h3v7h-6v-5z",
    tail: "M43 55h9v-3h6v3h2v6h-3v3H44v-4h9v-3H43z",
    footLeft: "M21 58h10v6H18v-3h3z", footRight: "M34 58h10v3h3v3H34z",
    pawLeft: "M16 49h5v3h3v6h-3v2h-6v-3h-2v-5h3z",
    pawRight: "M42 49h5v3h3v5h-2v3h-6v-2h-3v-6h3z",
    belly: "M27 54h10v7H27z", eyes: [24, 37], eyeY: 39, mouthY: 47,
    flowerX: 46, flowerY: 27, cheekLeft: 17, cheekRight: 42,
  },
  growing: {
    head: "M20 24h21v3h7v5h3v12h-3v4h-7v3H20v-3h-6v-4h-3V32h3v-5h6z",
    body: "M24 45h15v2h5v7h4v6h-7v3H22v-4h-4v-9h6z",
    earLeft: "M14 29V13h4v3h4v4h5v11z",
    earRight: "M36 26v-8h4v-5h5v3h3v16z",
    innerLeft: "M17 18h2v4h4v7h-6z", innerRight: "M41 20v-3h3v12h-5v-9z",
    tail: "M43 54h7v-6h4V38h6v5h-2v15h-4v4H43z",
    footLeft: "M21 56h9v8H17v-4h4z", footRight: "M36 55h8v3h6v5H36z",
    pawLeft: "M15 43h5v3h3v7h-3v3h-6v-3h-2v-7h3z",
    pawRight: "M42 42h5v3h3v6h-2v3h-6v-3h-3v-6h3z",
    belly: "M27 51h10v10H27z", eyes: [23, 36], eyeY: 35, mouthY: 43,
    flowerX: 46, flowerY: 23, cheekLeft: 16, cheekRight: 41,
  },
  adult: {
    head: "M22 20h19v3h6v5h3v12h-3v4h-6v3H22v-3h-6v-4h-3V28h3v-5h6z",
    body: "M25 41h13v3h5v7h3v8h-5v4H22v-4h-4v-8h3v-7h4z",
    earLeft: "M16 25V8h4v3h4v4h5v12z",
    earRight: "M36 23V14h4V8h5v3h3v18z",
    innerLeft: "M19 13h2v4h4v8h-6z", innerRight: "M41 16v-4h3v14h-5V16z",
    tail: "M43 55h8V42h-2v-8h3v-3h6v3h3v10h-5v-7h-2v6h2v17h-4v3H43z",
    footLeft: "M22 56h8v8H15v-4h7z", footRight: "M34 56h8v4h6v4H34z",
    pawLeft: "M17 41h5v3h2v9h-3v2h-6v-3h-1v-8h3z",
    pawRight: "M42 41h5v3h3v8h-2v3h-6v-2h-3v-9h3z",
    belly: "M26 47h12v13H26z", eyes: [24, 36], eyeY: 32, mouthY: 40,
    flowerX: 46, flowerY: 19, cheekLeft: 17, cheekRight: 41,
  },
} as const;

export function CatRig({ stage, expression = "awake", motion = "idle", need, className = "" }: {
  stage: GrowthStage; expression?: Expression; motion?: SceneMotion; need?: NeedKind; className?: string;
}) {
  const variant = stage === "growing" || stage === "adult" ? stage : "baby";
  const art = catStages[variant];
  return <svg viewBox="0 0 64 68" className={`pet-sprite cat-rig cat-${variant} rig-motion-${motion} expression-${expression} ${need ? `gesture-${need}` : ""} ${className}`}
    data-rig-stage={variant} role="img" aria-label={`樱花喵，${{baby:"团坐探爪",growing:"侧耳试步",adult:"端坐理毛"}[variant]}`} shapeRendering="crispEdges">
    <g stroke="#443432" strokeWidth="2" strokeLinejoin="miter" fill="#fffaf5">
      <path className="cat-tail" d={art.tail} />
      <g className="cat-foot foot-left"><path d={art.footLeft} /><path d="M22 61h4v2h-4z" stroke="none" fill="#f6b1c4" /></g>
      <g className="cat-foot foot-right"><path d={art.footRight} /><path d="M37 61h4v2h-4z" stroke="none" fill="#f6b1c4" /></g>
      <g className="cat-torso"><path className="cat-body-shape" d={art.body} /><path d={art.belly} stroke="none" fill="#fbe7e5" /></g>
      <g className="cat-head">
        <g className="cat-ear ear-left"><path d={art.earLeft} /><path d={art.innerLeft} fill="#f5a9c1" stroke="none" /></g>
        <g className="cat-ear ear-right"><path d={art.earRight} /><path d={art.innerRight} fill="#f5a9c1" stroke="none" /></g>
        <path className="cat-head-shape" d={art.head} />
        <g className="cat-blossom" transform={`translate(${art.flowerX} ${art.flowerY})`} stroke="none">
          <path d="M-2-9h5v3h4v4h3v5H6v4H1v3h-5V6h-4V2h-3v-5h5v-3h4z" fill="#ff9ebc" />
          <path d="M-2-2h5v5h-5z" fill="#ffe66d" /><path d="M-5 4h3v4h-3z" fill="#ffc8d5" />
        </g>
        <g className="sprite-face" stroke="none">
          <g className="sprite-eyes-open" fill="#443432">{art.eyes.map(x=><rect key={x} x={x} y={art.eyeY} width="3" height="4" />)}</g>
          <g className="sprite-eyes-closed" fill="#443432">{art.eyes.map(x=><path key={x} d={`M${x-1} ${art.eyeY+1}h1v1h3v-1h1v2h-5z`} />)}</g>
          <g className="sprite-eyes-happy" fill="#443432">{art.eyes.map(x=><path key={x} d={`M${x-1} ${art.eyeY+2}v-2h1v-1h3v1h1v2h-1v-1h-3v1z`} />)}</g>
          <g className="sprite-eyes-tired" fill="#443432">{art.eyes.map(x=><rect key={x} x={x-1} y={art.eyeY+2} width="5" height="1.5" />)}</g>
          <g className="sprite-eye-glints" fill="#fff6dc">{art.eyes.map(x=><rect key={x} x={x} y={art.eyeY} width="1" height="1" />)}</g>
          <path className="cat-cheeks" d={`M${art.cheekLeft} ${art.eyeY+6}h6v2h-6zm${art.cheekRight-art.cheekLeft} 0h6v2h-6z`} fill="#f7a4ba" />
          <path className="cat-whiskers" d={`M12 ${art.eyeY+2}h4v1h-4zm0 5h4v1h-4zm35-5h4v1h-4zm0 5h4v1h-4z`} fill="#82706b" />
          <path className="cat-mouth" d={`M28 ${art.mouthY}h2v2h2v-2h2v2h2v-2h2v2h-2v2h-4v-2h-2v2h-2z`} fill="#684b4a" />
          <path className="cat-mouth-chew" d={`M30 ${art.mouthY}h4v4h-4z`} fill="#684b4a" />
        </g>
      </g>
      <path className="cat-paw need-paw paw-left" d={art.pawLeft} />
      <path className="cat-paw need-paw paw-right" d={art.pawRight} />
    </g>
  </svg>;
}
