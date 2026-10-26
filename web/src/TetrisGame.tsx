import { useId } from "react";
import { useBoardCollection } from "./useBoardCollection";
import { PetArt } from "./PetArt";
import { RoomDecoration } from "./EquipmentArt";
import { petGrowth } from "./growth";
import { gameCompanionVoice } from "./gameCompanionVoice";
import type { Falling, PetState, Tetris } from "./types";
import "./tetris-game.css";

export const TetrisStepInterval = 1500;
const pieceNames = ["I", "O", "T", "S", "Z", "J", "L"];
const coordinates = (cells: { x: number; y: number }[]) => cells.map(p => `${p.y + 1} 行 ${p.x + 1} 列`).join("；");
const shapes = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[2, 0], [0, 1], [1, 1], [2, 1]],
];
export const tetrisOptions = ["继续拼搭", "顺时针旋转", "落到底", "放弃本局", "玩法说明"];
const tetrisOperationHints = [
  "B / C 继续下落，A 只切换选项。",
  "B 顺时针旋转一次后继续下落；转不动则保持原位。",
  "B 把当前积木直接放到底并固定，再继续下落。",
  "B 打开放弃确认；再次确认前不会丢掉本局。",
  "B 重看玩法；返回后仍暂停，等你手动继续。",
];
export function blockCells(p: Falling) {
  let cells = shapes[p.kind - 1].map(([x, y]) => [x, y]);
  for (let r = 0;r < (p.kind === 2 ? 0 : p.rotation);r++) {
    cells = cells.map(([x, y]) => [3 - y, x]);
    const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
    cells = cells.map(([x, y]) => [x - mx, y - my]);
  }
  return cells.map(([x, y]) => ({ x: x + p.x, y: y + p.y }));
}
// Use the same landing for the ghost and the optional row preview. Neither
// changes the board: locking and clearing remain server-side actions.
export function tetrisLanding(n: Pick<Tetris, "board" | "active">) {
  if (!n.active) return null;
  const piece = { ...n.active };
  while (blockCells({ ...piece, y: piece.y + 1 }).every(p => p.y < 12 && !n.board[p.y * 8 + p.x])) piece.y++;
  const cells = blockCells(piece);
  const occupied = new Set(cells.map(p => p.y * 8 + p.x));
  const rows = Array.from({ length: 12 }, (_, row) => row).filter(row =>
    Array.from({ length: 8 }, (_, col) => row * 8 + col).every(i => n.board[i] || occupied.has(i)));
  return { cells, rows };
}
export function TetrisGame({ pet, now, active, choice }: { pet: PetState; now: number; active: boolean; choice: number ;}) {
  const descriptionId = useId();
  const n = pet.game?.tetris;
  const collecting = useBoardCollection(n?.lines ?? 0, active && !n?.paused);
  if (!n) return null;
  const paused = n.paused || !active;
  const growth = petGrowth(pet, now);
  const companionVoice = gameCompanionVoice(growth, "tetris");
  const cells = n.active ? blockCells(n.active) : [];
  const landing = tetrisLanding(n);
  const topIndex = n.board.findIndex(Boolean);
  const topRow = topIndex < 0 ? -1 : Math.floor(topIndex / 8);
  const stackRemaining = topRow < 0 ? 12 : topRow;
  const stackWarning = !n.end && topRow >= 0 && topRow <= 3;
  const preview = paused && !n.end && choice === 2 ? landing : null;
  const previewText = preview ? preview.rows.length
    ? `落底预览：预计消除 ${preview.rows.length} 行（第 ${preview.rows.map(row => row + 1).join("、")} 行）。按 B 才固定。`
    : "落底预览：本块落下后暂不消行。按 B 才固定。" : "";
  return <section className="tetris-game" aria-label="积木俄罗斯方块">
    <header><strong>积木俄罗斯方块</strong><span>消除 {n.lines}/8</span></header>
    <div className="tetris-playfield">
      <div className="tetris-field" data-stack-warning={stackWarning ? stackRemaining <= 1 ? "critical" : "near" : "clear"}>
        <svg viewBox="0 0 80 120" role="img" aria-label={`积木棋盘，已消除 ${n.lines} 行，已放 ${n.pieces} 块`} aria-describedby={descriptionId} shapeRendering="crispEdges">
          <desc id={descriptionId}>
            棋盘 12 行 8 列，行从上到下、列从左到右，均从 1 开始。
            {n.end ? "本局已结束。" : paused ? "当前暂停。" : "当前下落。"}
            已固定：{n.board.flatMap((v, i) => v ? [`${Math.floor(i / 8) + 1} 行 ${i % 8 + 1} 列`] : []).join("；") || "无"}。
            {stackWarning ? `上方还剩 ${stackRemaining} 行空间。` : ""}
            当前积木：{n.active ? `${pieceNames[n.active.kind - 1]} 型，顺时针旋转 ${n.active.kind === 2 ? 0 : n.active.rotation * 90} 度，占据 ${coordinates(cells)}` : "无"}。
            {landing && `落点投影：${coordinates(landing.cells)}。`}
            下一块：{pieceNames[n.next - 1]} 型。
          </desc>
          <rect width="80" height="120" fill="#b7c496" />
          {Array.from({ length: 96 }, (_, i) => <rect key={i} x={(i % 8) * 10} y={Math.floor(i / 8) * 10} width="10" height="10" fill="none" stroke="#8f9f74" strokeWidth=".3" />)}
          {n.board.map((v, i) => v ? <rect className="locked-block" key={i} x={(i % 8) * 10 + 1} y={Math.floor(i / 8) * 10 + 1} width="8" height="8" fill="#526d3e" /> : null)}
          {landing && landing.cells.map((p, i) => <rect className="ghost-block" key={i} x={p.x * 10 + 2} y={p.y * 10 + 2} width="6" height="6" fill="none" stroke="#6d7e50" strokeDasharray="2 1" />)}
          {cells.map((p, i) => <g className="active-block" key={i}><rect x={p.x * 10 + 1} y={p.y * 10 + 1} width="8" height="8" fill="#384f30" /><path d={`M${p.x * 10 + 2} ${p.y * 10 + 4}v-2h3`} fill="none" stroke="#e4e5bb" /></g>)}
          {preview?.rows.map(row => <rect className="tetris-preview-row" data-preview-row={row + 1} key={row} x="1" y={row * 10 + 1} width="78" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" />)}
        </svg>
      </div>
      <aside className="tetris-side"><span>下一块</span><svg viewBox="0 0 40 24" role="img" aria-label={`下一块 ${pieceNames[n.next - 1]}`} shapeRendering="crispEdges">{blockCells({ kind: n.next, rotation: 0, x: 0, y: 0 }).map((p, i) => <rect key={i} x={p.x * 9 + 1} y={p.y * 9 + 1} width="7" height="7" fill="#526d3e" />)}</svg><small>目标 8 行</small>{stackWarning && <small className="tetris-stack-warning" role="status" aria-label={`堆叠提醒：上方只剩 ${stackRemaining} 行空间`}>堆叠提醒：上方只剩 {stackRemaining} 行空间</small>}<small data-speed-level="1">当前速度：1 级<br />约每 1.5 秒下落一格</small><small>2 行起结算<br />最多 6 金币</small><small>A 左 · B 右<br />C 操作 / 暂停</small></aside>
      {(paused || n.end) && <div className="tetris-overlay" role="status">
        <strong>{n.end ? n.end === "won" ? "积木花园拼好啦！" : "歇一歇再来" : "积木已暂停"}</strong>
        {n.end ? <><span>消除 {n.lines} 行 · A 暂不操作 · B / C 收好本局成绩</span><small>{n.lines >= 2 ? "计入陪伴 · 最多 6 金币" : "消除 2 行后完成才有奖励"}</small></> : <><ol aria-label="积木操作">{tetrisOptions.map((label, i) => <li key={label} aria-current={choice === i} className={choice === i ? "selected" : ""}>{choice === i ? "›" : "·"} {label}</li>)}</ol><small>A 选择 · B 确认 · C 继续</small></>}
      </div>}
    </div>
    {paused && !n.end && <p className="tetris-operation-hint" aria-live="polite" aria-atomic="true">{tetrisOperationHints[choice]}{preview && <span className="tetris-drop-preview">{previewText}</span>}</p>}
    <div className={`tetris-companion ${collecting ? "collecting" : ""}`} data-motion={collecting ? "collecting" : "waiting"} data-paused={paused || !!n.end} data-form={companionVoice?.form}><div className="tetris-pet"><PetArt index={pet.species} stage={growth.stage} accessory={pet.economy?.equipped.accessory} motion={collecting || n.end === "won" ? "celebrating" : "idle"} /></div><RoomDecoration id={pet.economy?.equipped.room} /><p>{collecting ? "这一排拼好啦，我帮你收起来！" : n.end ? "记住的是一起拼，不只是分数。" : paused ? "慢慢想，我们一起搭。" : "我帮你收积木，落点虚线在下面。"}{companionVoice && <small className="game-companion-voice">{companionVoice.text}</small>}</p></div>
  </section>;
}
