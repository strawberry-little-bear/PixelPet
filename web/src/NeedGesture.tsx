import type { NeedKind } from "./needs";

// Paws/wings are separately articulated instead of moving the whole flat image.
// Rabbit, cat, tanuki, bird, dolphin, mushroom, bear, frog and dragon have complete rigs; the other pets keep their source
// artwork until their independently drawn stage rigs are ready.
const colours = ["#ffdb59", "#c0e6f0", "#ffc9d8", "#8fd4f0", "#fff1dc", "#ffc2a0", "#a5d464", "#ffffff", "#b39ddb", "#c68a5a"];
export function NeedGesture({ kind, index, paws = true }: { kind: NeedKind; index: number; paws?: boolean }) {
  return <svg className={`need-gesture gesture-${kind}`} viewBox="0 0 64 68" shapeRendering="crispEdges" aria-hidden="true">
    {paws && <g fill={colours[index]} stroke="#443730" strokeWidth="1.5" strokeLinejoin="miter">
      <path className="need-paw paw-left" d="M15 41h6v3h3v7h-3v3h-7v-3h-2v-7h3z" />
      <path className="need-paw paw-right" d="M43 41h6v3h3v7h-3v3h-7v-3h-2v-7h3z" />
    </g>}
    {kind === "playful" && <g className="need-ball"><path d="M48 55h8v3h3v8H45v-8h3z" fill="#cfaa83" stroke="#665240" strokeWidth="1.5" /><path d="M49 56v9m-3-5h11" stroke="#f8e6bf" strokeWidth="2" /></g>}
    {kind === "hungry" && <g className="need-rumble" fill="#8a6853"><path d="M24 44h2v2h-2zm11 0h2v2h-2z" /><path d="M27 47h7v1h-7z" /></g>}
    {kind === "tired" && <text className="need-yawn" x="50" y="24" fontSize="9" fill="#657859">z</text>}
    {kind === "content" && <path className="need-heart" d="M48 22v-3h3v2h2v-2h3v5h-2v2h-2v2h-2v-2h-2z" fill="#c18d8b" />}
    {kind === "dirty" && <path className="need-itch" d="M51 27h2v4h-2zm4-3h2v4h-2z" fill="#8d8265" />}
  </svg>;
}
