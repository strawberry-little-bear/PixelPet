import { AccessoryMark } from "./EquipmentArt";
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
// Eye coordinates are measured on the untouched original sheet. Each 16px band
// restores the surrounding face colour before drawing the animated pixel eyes.
const faces = [
  {
    y: 210,
    x: [194, 322],
    skin: [
      ["#8a5a33", "#8a5a33"],
      ["#8a5a33", "#8a5a33"],
    ],
  },
  {
    y: 226,
    x: [740, 836],
    skin: [
      ["#ffffff", "#ffffff"],
      ["#ffffff", "#ffffff"],
    ],
  },
  {
    y: 258,
    x: [1254, 1382],
    skin: [
      ["#ffc9d8", "#ffc9d8"],
      ["#ffc9d8", "#ffc9d8"],
    ],
  },
  {
    y: 226,
    x: [1784, 1912],
    skin: [
      ["#8fd4f0", "#8fd4f0"],
      ["#8fd4f0", "#bde8f8"],
    ],
  },
  {
    y: 242,
    x: [2330, 2426],
    skin: [
      ["#fff1dc", "#fff1dc"],
      ["#fff1dc", "#fff1dc"],
    ],
  },
  {
    y: 772,
    x: [194, 322],
    skin: [
      ["#ffc2a0", "#ffc2a0"],
      ["#ffc2a0", "#ffc2a0"],
    ],
  },
  {
    y: 676,
    x: [724, 868],
    skin: [
      ["#ffffff", "#ffffff"],
      ["#ffe066", "#ffe066"],
    ],
  },
  {
    y: 772,
    x: [1254, 1382],
    skin: [
      ["#ffffff", "#ffffff"],
      ["#ffffff", "#ffffff"],
    ],
  },
  {
    y: 772,
    x: [1784, 1912],
    skin: [
      ["#b39ddb", "#b39ddb"],
      ["#ede3fa", "#ede3fa"],
    ],
  },
  {
    y: 740,
    x: [2314, 2442],
    skin: [
      ["#c68a5a", "#c68a5a"],
      ["#c68a5a", "#c68a5a"],
    ],
  },
];
export type Expression =
  "still" | "awake" | "asleep" | "content" | "chewing" | "waking" | "hungry" | "tired" | "dirty" | "playful" | "quiet";
export function Sprite({
  index,
  className = "",
  expression = "still",
  accessory,
}: {
  index: number;
  className?: string;
  expression?: Expression;
  accessory?: string;
}) {
  const [x, y, w, h] = boxes[index] || boxes[0];
  const face = faces[index] || faces[0];
  return (
    <svg
      className={`pet-sprite expression-${expression} ${className}`}
      role="img"
      aria-label={species[index]}
      viewBox={`${x} ${y} ${w} ${h}`}
    >
      <image href="/pets/characters.png" width="2668" height="1078" />
      {expression !== "still" && (
        <g shapeRendering="crispEdges" className="sprite-face">
          {face.x.map((eye, i) => (
            <g key={eye}>
              <rect
                x={eye}
                y={face.y}
                width="32"
                height="16"
                fill={face.skin[i][0]}
              />
              <rect
                x={eye}
                y={face.y + 16}
                width="32"
                height="16"
                fill={face.skin[i][1]}
              />
            </g>
          ))}
          <g className="sprite-eyes-open" fill="#382c29">
            {face.x.map((eye) => (
              <rect key={eye} x={eye} y={face.y} width="32" height="32" />
            ))}
          </g>
          <g className="sprite-eyes-tired" fill="#382c29">
            {face.x.map(eye => <path key={eye} d={`M${eye} ${face.y + 14}h32v10h-32z`} />)}
          </g>
          <g className="sprite-eye-glints" fill="#fff6dc">
            {face.x.map(eye => <rect key={eye} x={eye + 4} y={face.y + 3} width="9" height="9" />)}
          </g>
          <g className="sprite-eyes-closed" fill="#382c29">
            {face.x.map((eye) => (
              <path
                key={eye}
                d={`M${eye - 4} ${face.y + 12}h8v8h24v-8h8v16h-40z`}
              />
            ))}
          </g>
          <g className="sprite-eyes-happy" fill="#382c29">
            {face.x.map((eye) => (
              <path
                key={eye}
                d={`M${eye - 4} ${face.y + 16}h8v-8h24v8h8v12h-8v-8h-24v8h-8z`}
              />
            ))}
          </g>
        </g>
      )}
      <AccessoryMark id={accessory} transform={`translate(${x+w*.5} ${y+h*.78}) scale(${w/64})`} />
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
