import { useEffect, useRef, useState } from "react";
import { PetArt } from "./PetArt";
import { RoomDecoration } from "./EquipmentArt";
import { petGrowth } from "./growth";
import type { Falling, PetState } from "./types";
import "./tetris-game.css";

const shapes = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[2, 0], [0, 1], [1, 1], [2, 1]],
];
export const tetrisOptions = ["继续拼搭", "顺时针旋转", "落到底", "放弃本局", "玩法说明"];
export function blockCells(p: Falling) {
  let cells = shapes[p.kind - 1].map(([x, y]) => [x, y]);
  for (let r = 0;r < (p.kind === 2 ? 0 : p.rotation);r++) {
    cells = cells.map(([x, y]) => [3 - y, x]);
    const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
    cells = cells.map(([x, y]) => [x - mx, y - my]);
  }
  return cells.map(([x, y]) => ({ x: x + p.x, y: y + p.y }));
}
export function TetrisGame({ pet, active, choice }: { pet: PetState; active: boolean; choice: number ;}) {
  const n = pet.game?.tetris;
  const lastLines = useRef(n?.lines ?? 0);
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    if (!n || n.lines <= lastLines.current) return;
    lastLines.current = n.lines;
    setCollecting(true);
    const timer = setTimeout(() => setCollecting(false), 900);
    return () => clearTimeout(timer);
  }, [n?.lines]);
  if (!n) return null;
  const paused = n.paused || !active;
  const growth = petGrowth(pet, Date.now());
  const cells = n.active ? blockCells(n.active) : [];
  let ghost = n.active ? { ...n.active } : undefined;
  if (ghost) {
    while (blockCells({ ...ghost, y: ghost.y + 1 }).every(p => p.y < 12 && !n.board[p.y * 8 + p.x])) ghost.y++;
  }
  return <section className="tetris-game" aria-label="积木俄罗斯方块">
    <header><strong>积木俄罗斯方块</strong><span>消除 {n.lines}/8</span></header>
    <div className="tetris-playfield">
      <div className="tetris-field">
        <svg viewBox="0 0 80 120" role="img" aria-label={`积木棋盘，已消除 ${n.lines} 行，已放 ${n.pieces} 块`} shapeRendering="crispEdges">
          <rect width="80" height="120" fill="#b7c496" />
          {Array.from({ length: 96 }, (_, i) => <rect key={i} x={(i % 8) * 10} y={Math.floor(i / 8) * 10} width="10" height="10" fill="none" stroke="#8f9f74" strokeWidth=".3" />)}
          {n.board.map((v, i) => v ? <rect className="locked-block" key={i} x={(i % 8) * 10 + 1} y={Math.floor(i / 8) * 10 + 1} width="8" height="8" fill="#526d3e" /> : null)}
          {ghost && blockCells(ghost).map((p, i) => <rect className="ghost-block" key={i} x={p.x * 10 + 2} y={p.y * 10 + 2} width="6" height="6" fill="none" stroke="#6d7e50" strokeDasharray="2 1" />)}
          {cells.map((p, i) => <g className="active-block" key={i}><rect x={p.x * 10 + 1} y={p.y * 10 + 1} width="8" height="8" fill="#384f30" /><path d={`M${p.x * 10 + 2} ${p.y * 10 + 4}v-2h3`} fill="none" stroke="#e4e5bb" /></g>)}
        </svg>
      </div>
      <aside className="tetris-side"><span>下一块</span><svg viewBox="0 0 40 24" role="img" aria-label={`下一块 ${["I", "O", "T", "S", "Z", "J", "L"][n.next - 1]}`} shapeRendering="crispEdges">{blockCells({ kind: n.next, rotation: 0, x: 0, y: 0 }).map((p, i) => <rect key={i} x={p.x * 9 + 1} y={p.y * 9 + 1} width="7" height="7" fill="#526d3e" />)}</svg><small>目标 8 行</small><small>2 行起结算<br />最多 6 金币</small><small>A 左 · B 右<br />C 操作 / 暂停</small></aside>
      {(paused || n.end) && <div className="tetris-overlay" role="status">
        <strong>{n.end ? n.end === "won" ? "积木花园拼好啦！" : "歇一歇再来" : "积木已暂停"}</strong>
        {n.end ? <><span>消除 {n.lines} 行 · B / C 收好成绩</span><small>{n.lines >= 2 ? "计入陪伴 · 最多 6 金币" : "消除 2 行后完成才有奖励"}</small></> : <><ol aria-label="积木操作">{tetrisOptions.map((label, i) => <li key={label} aria-current={choice === i} className={choice === i ? "selected" : ""}>{choice === i ? "›" : "·"} {label}</li>)}</ol><small>A 选择 · B 确认 · C 继续</small></>}
      </div>}
    </div>
    <div className={`tetris-companion ${collecting ? "collecting" : ""}`} data-motion={collecting ? "collecting" : "waiting"}><div className="tetris-pet"><PetArt index={pet.species} stage={growth.stage} accessory={pet.economy?.equipped.accessory} motion={collecting || n.end === "won" ? "celebrating" : "idle"} /></div><RoomDecoration id={pet.economy?.equipped.room} /><p>{collecting ? "这一排拼好啦，我帮你收起来！" : n.end ? "记住的是一起拼，不只是分数。" : paused ? "慢慢想，我们一起搭。" : "我帮你收积木，落点虚线在下面。"}</p></div>
  </section>;
}
