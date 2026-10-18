import { useId } from "react";
import "./shop.css";

// Draw inside the pet SVG, not on a second scaled pet bitmap. These ornaments
// stay below the face, retaining ears, original species marks and body motions.
export function AccessoryMark({ id, transform }: { id?: string; transform?: string; }) {
  if (!id || !["leaf-pin", "berry-scarf", "star-badge", "sunflower-pin", "sky-bow"].includes(id)) return null;
  return <g className="equipped-accessory" data-item={id} transform={transform} stroke="none" shapeRendering="crispEdges">
    {id === "leaf-pin" ? <><path d="M-5 4V-2h4v-3h7v6H3v4H-2v3h-2z" fill="#527954" /><path d="M-2 4L3-1" stroke="#b9d28f" strokeWidth="2" /></>
      : id === "berry-scarf" ? <><path d="M-10-3h20v5H6v10H1V2h-11z" fill="#bc7783" /><path d="M-9-2H9v2H-9zM2 4h3v2H2zm0 4h3v2H2z" fill="#f8d7bd" /></>
        : id === "sunflower-pin" ? <><path d="M-3-6h6v3h4v6H3v4h-6V3h-4v-6h4z" fill="#d0a654" /><path d="M-3-2h6v5h-6z" fill="#82704e" /><path d="M0 7v4h5V7z" fill="#6d9566" /></>
          : id === "sky-bow" ? <><path d="M-10-4h4v2h4v7h-4v2h-4zm12 2h4v-2h4V7H6V5H2z" fill="#779eaa" /><path d="M-2-1h4v6h-4z" fill="#dbd8af" /><path d="M-7-2h3v2h-3zm12 0h3v2H5z" fill="#b8d1c7" /></>
            : <><path d="M-2-5h4v3h5v4H4v5H0V4h-4v3h-4V2h-3v-4h6v-3z" fill="#ac9152" /><path d="M-2-2h4v5h-4z" fill="#ffe6a1" /></>}
  </g>;
}
export function RoomDecoration({ id }: { id?: string; }) {
  if (!id || !["clover-pot", "patchwork-rug", "moon-lamp"].includes(id)) return null;
  return <svg className={`room-decoration decoration-${id}`} data-item={id} viewBox="0 0 64 48" aria-hidden="true" shapeRendering="crispEdges">
    {id === "clover-pot" ? <><path d="M30 29V13h4v16zM18 12V6h8v4h4v10h-8v-4h-4zm16-2V5h9v5h5v7H35zM19 22v-5h8v4h6v6H23v-5zm16-3h10v7H34z" fill="#759366" /><path d="M18 29h30v5H18zm4 5h22v11H22z" fill="#b48e76" /><path d="M25 35h4v8h-4z" fill="#ddc6a2" /></>
      : id === "patchwork-rug" ? <><path d="M3 15h58v26H3z" fill="#879875" /><path d="M7 19h50v18H7z" fill="#d7c7a0" /><path d="M11 22h12v12H11zm27 0h13v12H38z" fill="#c09290" /><path d="M27 22h7v12h-7z" fill="#a5bda0" /><path d="M0 19h3v3H0zm0 10h3v3H0zm61-10h3v3h-3zm0 10h3v3h-3z" fill="#879875" /></>
        : <><path d="M28 36h8v6H22v4h26v-4H36V27h-8z" fill="#7b8267" /><path d="M31 2h14v4h-8v6h-4v10h5v5h10v-5h5v9h-5v4H31v-4h-6v-8h-4V12h4V6h6z" fill="#e2cb8f" /><path d="M28 10h4v12h-4z" fill="#f7e9b9" /></>}
  </svg>;
}

// Real room-space layers, separate from the pet SVG and from the one-piece
// decoration slot. Unique pattern IDs also permit several previews on a page.
export function RoomSurfaceArt({ id }: { id?: string; }) {
  const pattern = useId().replace(/:/g, "");
  if (!id || !["meadow-wall", "starlit-wall", "honey-floor", "mint-floor"].includes(id)) return null;
  const wall = id.endsWith("wall");
  return <svg className={`room-surface surface-${wall ? "wallpaper" : "floor"} surface-${id}`} data-item={id} aria-hidden="true" shapeRendering="crispEdges" preserveAspectRatio="none">
    <defs><pattern id={pattern} width={id === "honey-floor" ? 48 : 32} height={wall ? 32 : 16} patternUnits="userSpaceOnUse">
      {id === "meadow-wall" ? <><path d="M0 0h32v32H0z" fill="#dce3bd" /><path d="M8 11V7h5v4h3v4h-5v-4zm12 12v-4h5v4h3v4h-5v-4z" fill="#a9bf8d" /><path d="M12 15v5m12 7v4" stroke="#b6c798" /></>
        : id === "starlit-wall" ? <><path d="M0 0h32v32H0z" fill="#c7d4cd" /><path d="M8 5h2v3h3v2h-3v3H8v-3H5V8h3zm15 18h2v2h-2z" fill="#f4e8bd" /><path d="M23 5h2v2h-2zM7 25h2v2H7z" fill="#97afaa" /></>
          : id === "honey-floor" ? <><path d="M0 0h48v16H0z" fill="#d3bc8f" /><path d="M0 0h48M0 8h48M12 0v8m24 0v8" stroke="#b1986e" /><path d="M19 4h10M2 12h6m33 0h4" stroke="#e6d1a7" /></>
            : <><path d="M0 0h32v16H0z" fill="#cdd8bb" /><path d="M0 0h16v8H0zm16 8h16v8H16z" fill="#aec4a1" /><path d="M0 0h32M0 8h32M16 0v16" stroke="#e6e5c9" /></>}
    </pattern></defs>
    <rect width="100%" height="100%" fill={`url(#${pattern})`} />
  </svg>;
}
