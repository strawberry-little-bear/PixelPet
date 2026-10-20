import { useEffect, useRef, useState } from "react";
import { RoomDecoration } from "./EquipmentArt";
import { PetArt } from "./PetArt";
import { petGrowth } from "./growth";
import type { PetState } from "./types";
import "./snake-game.css";

export function SnakeGame({ pet, now, active, turn }: { pet: PetState; now: number; active: boolean; turn: number; }) {
  const snake = pet.game?.snake;
  const lastEaten = useRef(snake?.eaten ?? 0);
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    if (!snake || snake.eaten <= lastEaten.current) return;
    lastEaten.current = snake.eaten;
    setCollecting(true);
    const timer = setTimeout(() => setCollecting(false), 900);
    return () => clearTimeout(timer);
  }, [snake?.eaten]);
  if (!snake) return null;
  const ended = !!snake.end;
  const paused = !active || snake.paused;
  const growth = petGrowth(pet, now);
  const directions = ["右", "下", "左", "上"];
  return <section className="snake-game" aria-label="果园贪吃蛇">
    <header><strong>果园贪吃蛇</strong><span>果子 {snake.eaten}/8</span></header>
    <div className="snake-field">
      <svg viewBox="0 0 144 120" role="img" aria-label={`果园棋盘，已吃 ${snake.eaten} 颗果子，朝${directions[snake.direction]}`} shapeRendering="crispEdges">
        <defs><pattern id="snake-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#8f9f74" strokeWidth=".4" /></pattern></defs>
        <rect width="144" height="120" fill="url(#snake-grid)" />
        {snake.body.map((p, i) => <g key={i} transform={`translate(${p.x * 12} ${p.y * 12})`}>
          <rect x="1" y="1" width="10" height="10" rx="2" fill={i ? "#687f4a" : "#3b5634"} />
          {i === 0 && <g transform={`rotate(${snake.direction * 90} 6 6)`}><rect x="8" y="2" width="2" height="2" fill="#e9dfbd" /><rect x="8" y="8" width="2" height="2" fill="#e9dfbd" /></g>}
        </g>)}
        {snake.end !== "won" && <g transform={`translate(${snake.food.x * 12} ${snake.food.y * 12})`}><path d="M3 4h7v5H8v2H5V9H3z" fill="#9d654f" /><path d="M5 2h3v3H5z" fill="#526c3c" /></g>}
      </svg>
      {(paused || ended) && <div className="snake-overlay" role="status"><strong>{ended ? snake.end === "won" ? "果篮装满啦！" : "休息一下再来" : "果园已暂停"}</strong><span>{ended ? `吃到 ${snake.eaten} 颗 · B / C 收好成绩` : "A / C 继续 · B 放弃确认"}</span><small>{ended ? snake.eaten >= 3 ? "计入陪伴 · 最多 6 金币" : "吃到 3 颗后完成才有奖励" : "刷新、离开不补跑"}</small></div>}
    </div>
    {paused && !ended && <section className="snake-steering-guide" aria-label="继续后的转弯方向">
      <strong>蛇头现在朝{directions[snake.direction]}</strong>
      <p>继续后：</p>
      <ul>
        <li>A 左转：朝{directions[(snake.direction + 3) % 4]}</li>
        <li>B 右转：朝{directions[(snake.direction + 1) % 4]}</li>
      </ul>
      <small>按蛇头朝向转弯，不是屏幕的左右。</small>
    </section>}
    <div className={`snake-companion ${collecting ? "collecting" : ""}`} data-motion={collecting ? "collecting" : "waiting"}><div className="snake-pet"><PetArt index={pet.species} stage={growth.stage} accessory={pet.economy?.equipped.accessory} motion={snake.end === "won" || collecting ? "celebrating" : "idle"} /></div><RoomDecoration id={pet.economy?.equipped.room} /><p>{collecting ? "甜甜的果子，我收好啦！" : ended ? "这次的果子我帮你收好。" : paused ? "等你准备好，我们再出发。" : `我帮你装果子！${turn < 0 ? "下一步左转" : turn > 0 ? "下一步右转" : "沿着方向前进"}`}</p></div>
  </section>;
}
