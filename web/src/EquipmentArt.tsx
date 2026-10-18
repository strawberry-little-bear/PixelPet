import "./shop.css";

// Draw inside the pet SVG, not on a second scaled pet bitmap. These ornaments
// stay below the face, retaining ears, original species marks and body motions.
export function AccessoryMark({ id, transform }: { id?: string; transform?: string }) {
  if (!id || !["leaf-pin", "berry-scarf", "star-badge"].includes(id)) return null;
  return <g className="equipped-accessory" data-item={id} transform={transform} stroke="none" shapeRendering="crispEdges">
    {id === "leaf-pin" ? <><path d="M-5 4V-2h4v-3h7v6H3v4H-2v3h-2z" fill="#527954" /><path d="M-2 4L3-1" stroke="#b9d28f" strokeWidth="2" /></>
      : id === "berry-scarf" ? <><path d="M-10-3h20v5H6v10H1V2h-11z" fill="#bc7783" /><path d="M-9-2H9v2H-9zM2 4h3v2H2zm0 4h3v2H2z" fill="#f8d7bd" /></>
      : <><path d="M-2-5h4v3h5v4H4v5H0V4h-4v3h-4V2h-3v-4h6v-3z" fill="#ac9152" /><path d="M-2-2h4v5h-4z" fill="#ffe6a1" /></>}
  </g>;
}
export function RoomDecoration({ id }: { id?: string }) {
  if (!id || !["clover-pot", "patchwork-rug", "moon-lamp"].includes(id)) return null;
  return <svg className={`room-decoration decoration-${id}`} data-item={id} viewBox="0 0 64 48" aria-hidden="true" shapeRendering="crispEdges">
    {id === "clover-pot" ? <><path d="M30 29V13h4v16zM18 12V6h8v4h4v10h-8v-4h-4zm16-2V5h9v5h5v7H35zM19 22v-5h8v4h6v6H23v-5zm16-3h10v7H34z" fill="#759366" /><path d="M18 29h30v5H18zm4 5h22v11H22z" fill="#b48e76" /><path d="M25 35h4v8h-4z" fill="#ddc6a2" /></>
      : id === "patchwork-rug" ? <><path d="M3 15h58v26H3z" fill="#879875" /><path d="M7 19h50v18H7z" fill="#d7c7a0" /><path d="M11 22h12v12H11zm27 0h13v12H38z" fill="#c09290" /><path d="M27 22h7v12h-7z" fill="#a5bda0" /><path d="M0 19h3v3H0zm0 10h3v3H0zm61-10h3v3h-3zm0 10h3v3h-3z" fill="#879875" /></>
      : <><path d="M28 36h8v6H22v4h26v-4H36V27h-8z" fill="#7b8267" /><path d="M31 2h14v4h-8v6h-4v10h5v5h10v-5h5v9h-5v4H31v-4h-6v-8h-4V12h4V6h6z" fill="#e2cb8f" /><path d="M28 10h4v12h-4z" fill="#f7e9b9" /></>}
  </svg>;
}
