import { useId } from "react";
import { PetArt } from "./PetArt";
import { RoomDecoration } from "./EquipmentArt";
import { petGrowth } from "./growth";
import type { PetState, TilePoint } from "./types";
import "./tile-game.css";

export const tileNames = [
  "空格",
  "草莓",
  "嫩叶",
  "星星",
  "月亮",
  "水滴",
  "小花",
  "蘑菇",
  "脚印",
];
function tilePosition(index: number) {
  return `第 ${index + 1} 格（${Math.floor(index / 4) + 1} 行 ${index % 4 + 1} 列）`;
}
export function nextTile(board: number[], cursor: number) {
  for (let step = 1; step <= 16; step++) {
    const next = (cursor + step + 16) % 16;
    if (board[next]) return next;
  }
  return 0;
}
export type TileLink = { path: TilePoint[]; tile: number; id: number };
export type TileHint = { path: TilePoint[]; id: number; traceHidden?: boolean };

// Describe the server's supplied route, never search for another legal pair.
// Missing/stale endpoints must not become a fabricated pattern or position.
function hintDescription(board: number[], path: TilePoint[]): string | null {
  if (path.length < 2 || path.length > 4 || path.some(p =>
    !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.x > 5 || p.y < 0 || p.y > 5)) return null;
  const index = (p: TilePoint) => p.x >= 1 && p.x <= 4 && p.y >= 1 && p.y <= 4
    ? (p.y - 1) * 4 + p.x - 1 : -1;
  const first = index(path[0]), last = index(path[path.length - 1]);
  if (first < 0 || last < 0 || first === last || !board[first] || board[first] !== board[last] || !tileNames[board[first]]) return null;
  let previous = "", turns = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    if ((dx === 0) === (dy === 0)) return null;
    const direction = dx ? `x${Math.sign(dx)}` : `y${Math.sign(dy)}`;
    if (previous && previous !== direction) turns++;
    previous = direction;
  }
  const outside = path.some(p => p.x === 0 || p.x === 5 || p.y === 0 || p.y === 5);
  return `示例：${tilePosition(first)}和${tilePosition(last)}· ${tileNames[board[first]]}；${turns ? `拐 ${turns} 次弯` : "直线连通"}${outside ? "，经过棋盘外沿" : ""}。`;
}
export function TileIcon({ value }: { value: number }) {
  const paths = [
    "",
    "M3 5h10v7h-2v3H5v-3H3zM6 2h4v4H6z",
    "M2 9V5h4V2h8v7h-4v4H6v2H3V9z",
    "M6 1h4v4h5v4h-3v6H8v-3H4v3H1V9h-1V5h6z",
    "M5 1h7v2H8v3H6v5h3v2h5v-3h2v4h-3v2H5v-2H2V5h3z",
    "M6 1h4v3h2v3h2v6h-2v2H4v-2H2V7h2V4h2z",
    "M6 1h4v3h3v2h3v5h-3v2h-3v3H6v-3H3v-2H0V6h3V4h3z",
    "M4 2h8v2h2v3h2v4H0V7h2V4h2zM5 11h6v5H5z",
    "M1 2h4v5H1zm10 0h4v5h-4zM6 0h4v5H6zM4 9h8v2h2v5h-4v-1H6v1H2v-5h2z",
  ];
  return (
    <svg
      className="tile-icon"
      width="14"
      height="14"
      viewBox="-1 -1 18 18"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d={paths[value] || ""} fill="currentColor" />
      {value === 1 && <path d="M5 7h2v2H5zm5 3h2v2h-2z" fill="#e9dfbd" />}
      {value === 6 && <path d="M6 6h4v4H6z" fill="#e4cb81" />}
    </svg>
  );
}
export function TileGame({
  pet,
  cursor,
  link,
  hint = null,
  message,
  now,
}: {
  pet: PetState;
  cursor: number;
  link: TileLink | null;
  hint?: TileHint | null;
  message: string;
  now: number;
}) {
  const descriptionId = useId();
  const tiles = pet.game?.tiles;
  if (!tiles) return null;
  const growth = petGrowth(pet, now);
  const example = hint && !link ? hintDescription(tiles.board, hint.path) : null;
  return (
    <section
      className="tile-game"
      aria-label="宠物连连看"
      data-pairs={tiles.pairs}
    >
      <header>
        <strong>连连看</strong>
        <span>已收好 {tiles.pairs} / 8 对</span>
      </header>
      <div className="tile-playfield">
        <svg
          className="tile-board"
          viewBox="-6 -6 112 112"
          role="img"
          aria-label="四行四列图案棋盘，使用机身三键操作"
          aria-describedby={descriptionId}
        >
          <desc id={descriptionId}>
            {tiles.board.map((value, index) => `${tilePosition(index)}：${tileNames[value]}`).join("；")}。
          </desc>
          {tiles.board.map((value, i) => (
            <g
              key={i}
              className={`tile-cell ${value ? "" : "empty"} ${i === cursor && value ? "cursor" : ""} ${i === tiles.pick ? "picked" : ""}`}
              data-cell={i}
              data-tile={value}
              transform={`translate(${((i % 4) + 1) * 20 - 9} ${(Math.floor(i / 4) + 1) * 20 - 9})`}
            >
              <rect width="18" height="18" rx="1" />
              {value > 0 && (
                <g transform="translate(2 2)">
                  <TileIcon value={value} />
                </g>
              )}
              {i === tiles.pick && (
                <path d="M1 2h5M2 1v5M12 16h4v-4" className="tile-pick-mark" />
              )}
            </g>
          ))}
          {hint && !hint.traceHidden && hint.path.length > 0 && !link && (
            <polyline
              className="tile-hint"
              data-hint-id={hint.id}
              points={hint.path.map((p) => `${p.x * 20},${p.y * 20}`).join(" ")}
              fill="none"
            />
          )}
          {link && link.path.length > 0 && (
            <polyline
              className="tile-link"
              data-link-id={link.id}
              points={link.path.map((p) => `${p.x * 20},${p.y * 20}`).join(" ")}
              fill="none"
            />
          )}
        </svg>
        <div
          className={`tile-companion ${link ? "collecting" : ""}`}
          data-motion={link ? "collecting" : "waiting"}
        >
          <div className="tile-pet">
            <PetArt
              index={pet.species}
              stage={growth.stage}
              motion={link ? "celebrating" : "idle"}
              accessory={pet.economy?.equipped.accessory}
              expression={link ? "content" : "awake"}
            />
          </div>
          {link && (
            <span className="collected-tile" key={link.id}>
              <TileIcon value={link.tile} />
            </span>
          )}
          <svg
            className="tile-basket"
            viewBox="0 0 40 28"
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            <path
              d="M8 10V5h5V1h14v4h5v5h-4V6H12v4zM2 10h36v5h-3v12H5V15H2z"
              fill="#8b9471"
            />
            <path d="M9 15h4v8H9zm9 0h4v8h-4zm9 0h4v8h-4z" fill="#d9c9a0" />
          </svg>
          <RoomDecoration id={pet.economy?.equipped.room} />
          <small>{link ? "这对我收好啦！" : "我帮你收图案"}</small>
        </div>
      </div>
      <div className="tile-status" role="status" aria-live="polite" aria-atomic="true">
        <p>{tilePosition(cursor)}· {tileNames[tiles.board[cursor]]}</p>
        <p>{tiles.pick >= 0 ? `已选${tilePosition(tiles.pick)}· ${tileNames[tiles.board[tiles.pick]]}` : "B 选中"}</p>
      </div>
      <div className="tile-hint-announcement" aria-live="polite" aria-atomic="true">
        {hint && !link && <p className="tile-hint-note" role="note">
          {example && <span>{example}<br /></span>}
          虚线是示例路径，可以连通但不会自动收好。虚线短暂显示，文字保留到下次选牌。
        </p>}
      </div>
      <p className="tile-message">
        {message || "同图案，最多拐两次弯；可绕棋盘外。"}
      </p>
    </section>
  );
}
