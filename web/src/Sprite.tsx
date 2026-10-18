import { species } from "./types";

const boxes = [
  [80, 32, 436, 468],
  [578, 64, 468, 372],
  [1156, 32, 372, 484],
  [1654, 64, 436, 388],
  [2216, 32, 372, 420],
  [96, 594, 372, 436],
  [626, 546, 372, 468],
  [1124, 562, 452, 484],
  [1654, 578, 436, 452],
  [2216, 626, 372, 436],
];
export function Sprite({
  index,
  className = "",
}: {
  index: number;
  className?: string;
}) {
  const [x, y, w, h] = boxes[index] || boxes[0];
  return (
    <svg
      className={`pet-sprite ${className}`}
      role="img"
      aria-label={species[index]}
      viewBox={`${x} ${y} ${w} ${h}`}
    >
      <image href="/pets/characters.png" width="2668" height="1078" />
    </svg>
  );
}

export function PixelEgg() {
  return (
    <svg
      className="pixel-egg"
      viewBox="0 0 24 28"
      role="img"
      aria-label="等待孵化的像素蛋"
      shapeRendering="crispEdges"
    >
      <path
        d="M9 1h6v2h3v4h2v4h2v12h-2v3h-4v1H8v-1H4v-3H2V11h2V7h2V3h3z"
        fill="#3b4932"
      />
      <path d="M9 3h6v2h3v6h2v12h-4v2H8v-2H4V11h2V7h3z" fill="#fff6d8" />
      <path
        d="M6 12h4v4H6zm9-5h3v4h-3zm0 12h4v4h-4zM9 21h3v4H9z"
        fill="#a3b979"
      />
      <path
        d="M4 17h4v2h3v-2h4v2h3v-2h2v3h-3v2h-4v-2H9v2H5v-2H4z"
        fill="#3b4932"
      />
    </svg>
  );
}
