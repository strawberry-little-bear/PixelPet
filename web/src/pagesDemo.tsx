import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PetArt } from "./PetArt";
import type { GrowthStage } from "./types";
import type { NeedKind } from "./needs";
import "./pages-demo.css";

type DemoPage = "home" | "care" | "games" | "growth";
type CareChoice = "feed" | "clean" | "play";
type DemoState = {
  stage: Exclude<GrowthStage, "egg">;
  points: number;
  needs: { hunger: number; mood: number; clean: number; energy: number };
  careCount: number;
  starsWon: number;
  lastMessage: string;
};

const STORAGE_KEY = "pixelpet-pages-demo-v1";
const initialState: DemoState = {
  stage: "baby",
  points: 0,
  needs: { hunger: 72, mood: 68, clean: 76, energy: 84 },
  careCount: 0,
  starsWon: 0,
  lastMessage: "你好呀！按 A 照顾、B 玩游戏、C 看成长。",
};
const careChoices: { id: CareChoice; label: string; detail: string; need: NeedKind }[] = [
  { id: "feed", label: "喂食", detail: "小肚子会变得暖暖的。", need: "hungry" },
  { id: "clean", label: "洗澡", detail: "把今天的灰尘洗掉。", need: "dirty" },
  { id: "play", label: "陪伴", detail: "一起玩一会儿，心情会变好。", need: "playful" },
];
const stageInfo: Record<DemoState["stage"], { label: string; title: string; detail: string }> = {
  baby: { label: "幼年期", title: "抱着小爪的桃团", detail: "它还小小的，需要稳定的照顾和休息。" },
  growing: { label: "成长期", title: "开始探身探索", detail: "身躯舒展开了，也会对游戏和散步更感兴趣。" },
  adult: { label: "成年期", title: "挺身陪你望星", detail: "成长完成后，照顾、小游戏和回忆仍会继续。" },
};

function loadState(): DemoState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<DemoState> | null;
    if (!parsed || !parsed.needs || !stageInfo[parsed.stage as DemoState["stage"]]) return initialState;
    return {
      ...initialState,
      ...parsed,
      needs: { ...initialState.needs, ...parsed.needs },
    } as DemoState;
  } catch {
    return initialState;
  }
}

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }

function DemoApp() {
  const [pet, setPet] = useState<DemoState>(() => loadState());
  const [page, setPage] = useState<DemoPage>("home");
  const [careIndex, setCareIndex] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [gameRound, setGameRound] = useState(0);
  const [gameLane, setGameLane] = useState(1);
  const [cursorLane, setCursorLane] = useState(1);
  const [gameMessage, setGameMessage] = useState("按 B 开始接星星。A 左移，C 右移。");

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(pet)); }, [pet]);

  const activeCare = careChoices[careIndex];
  const stage = stageInfo[pet.stage];
  const expression = useMemo(() => {
    if (pet.needs.hunger < 25) return "hungry" as const;
    if (pet.needs.clean < 25) return "dirty" as const;
    if (pet.needs.energy < 25) return "tired" as const;
    return "content" as const;
  }, [pet.needs]);

  function grow(points: number): DemoState["stage"] {
    const next = pet.points + points;
    if (next >= 12) return "adult";
    if (next >= 5) return "growing";
    return pet.stage;
  }

  function care(choice: CareChoice) {
    const nextNeeds = { ...pet.needs };
    const message = choice === "feed" ? "吃饱啦，今天也有好好长大。" : choice === "clean" ? "洗得香喷喷，舒服多了。" : "和你玩过之后，心情亮晶晶。";
    if (choice === "feed") nextNeeds.hunger = clamp(nextNeeds.hunger + 22);
    if (choice === "clean") nextNeeds.clean = clamp(nextNeeds.clean + 24);
    if (choice === "play") { nextNeeds.mood = clamp(nextNeeds.mood + 20); nextNeeds.energy = clamp(nextNeeds.energy - 5); }
    const points = 1;
    setPet({ ...pet, needs: nextNeeds, points: pet.points + points, careCount: pet.careCount + 1, stage: grow(points), lastMessage: message });
  }

  function startGame() {
    setGameActive(true); setGameRound(1); setCursorLane(1); setGameLane((pet.starsWon + 1) % 3); setGameMessage("星星出现了！把光标移到它下面，再按 B。");
  }

  function gameAction(key: string) {
    if (!gameActive) { if (key === "b") startGame(); return; }
    if (key === "a") setCursorLane((cursorLane + 2) % 3);
    if (key === "c") setCursorLane((cursorLane + 1) % 3);
    if (key !== "b") return;
    if (cursorLane !== gameLane) { setGameMessage("差一点点！星星飘走了，下一颗还在等你。"); return; }
    if (gameRound >= 3) {
      setGameActive(false);
      setPet({ ...pet, starsWon: pet.starsWon + 1, points: pet.points + 1, stage: grow(1), needs: { ...pet.needs, mood: clamp(pet.needs.mood + 8), energy: clamp(pet.needs.energy - 4) }, lastMessage: "接住了三颗星星！这段回忆被好好收下。" });
      setGameMessage("完成！按 B 再玩一次，按 C 回到主页。");
      return;
    }
    const nextRound = gameRound + 1;
    setGameRound(nextRound); setGameLane((gameLane + 1 + pet.starsWon) % 3); setGameMessage(`接住了！第 ${nextRound} 颗星星来了。`);
  }

  function onKey(key: string) {
    const normalized = key.toLowerCase();
    if (!["a", "b", "c"].includes(normalized)) return;
    if (page === "games") { if (normalized === "c" && !gameActive) { setPage("home"); return; } gameAction(normalized); return; }
    if (page === "care") {
      if (normalized === "a") setCareIndex((careIndex + careChoices.length - 1) % careChoices.length);
      else if (normalized === "b") care(activeCare.id);
      else setPage("home");
      return;
    }
    if (page === "growth") { if (normalized === "c") setPage("home"); else if (normalized === "b") setPet({ ...pet, lastMessage: `${stage.label}：${stage.detail}` }); return; }
    if (normalized === "a") setPage("care");
    else if (normalized === "b") setPage("games");
    else setPage("growth");
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event.key);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return <main className="pages-demo" onKeyDown={event => onKey(event.key)}>
    <header className="demo-header">
      <div><span className="eyebrow">PIXELPET / GITHUB PAGES</span><h1>三个按键，一只小伙伴。</h1></div>
      <span className="local-badge">浏览器本地演示</span>
    </header>
    <section className="pet-device" aria-label="PixelPet 演示机">
      <div className="device-topline"><span>PIXELPET</span><span>{stage.label}</span></div>
      <div className="lcd">
        <div className="lcd-scanline" />
        <div className="lcd-content">
          <div className="lcd-status"><span>{page === "home" ? "今日陪伴" : page === "care" ? "照顾时间" : page === "games" ? "小游戏" : "成长记录"}</span><strong>{pet.points}/12</strong></div>
          {page === "home" && <div className="home-view"><PetArt index={5} stage={pet.stage} expression={expression} motion="idle" className="demo-pet" /><p className="pet-speech">{pet.lastMessage}</p><p className="lcd-help">A 照顾　B 玩游戏　C 看成长</p></div>}
          {page === "care" && <div className="care-view"><div className="care-choice"><span className="choice-mark">{careIndex + 1}/3</span><h2>{activeCare.label}</h2><p>{activeCare.detail}</p><p className="lcd-help">A 换项目　B 执行　C 返回</p></div><Needs needs={pet.needs} /></div>}
          {page === "growth" && <div className="growth-view"><PetArt index={5} stage={pet.stage} expression="awake" className="demo-pet small" /><h2>{stage.title}</h2><p>{stage.detail}</p><div className="growth-track"><span style={{ width: `${Math.min(100, (pet.points / 12) * 100)}%` }} /></div><p className="lcd-help">成长点数 {pet.points}/12　B 查看　C 返回</p></div>}
          {page === "games" && <GameView active={gameActive} round={gameRound} lane={gameLane} cursor={cursorLane} message={gameMessage} />}
        </div>
      </div>
      <div className="hardware-buttons"><KeyButton label="A" onClick={() => onKey("a")} /><KeyButton label="B" onClick={() => onKey("b")} primary /><KeyButton label="C" onClick={() => onKey("c")} /></div>
    </section>
    <section className="demo-notes"><div><span>当前体验</span><strong>{stage.label}</strong><small>照顾 {pet.careCount} 次 · 接住 {pet.starsWon} 组星星</small></div><div><span>需要</span><Needs needs={pet.needs} compact /></div><p>键盘也可以操作 A / B / C。进度只保存在当前浏览器，不会上传到服务器。</p></section>
    <footer><span>正式完整版需要 Go + SQLite 服务。</span><span>GitHub Pages 仅提供静态试玩。</span></footer>
  </main>;
}

function Needs({ needs, compact = false }: { needs: DemoState["needs"]; compact?: boolean }) {
  return <div className={`needs ${compact ? "compact" : ""}`}><Meter label="饱食" value={needs.hunger} /><Meter label="心情" value={needs.mood} /><Meter label="清洁" value={needs.clean} /><Meter label="精力" value={needs.energy} /></div>;
}
function Meter({ label, value }: { label: string; value: number }) { return <div className="meter"><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><em>{value}</em></div>; }
function GameView({ active, round, lane, cursor, message }: { active: boolean; round: number; lane: number; cursor: number; message: string }) {
  return <div className="game-view"><div className="game-heading"><h2>接星星</h2><span>{active ? `${round}/3` : "轻量试玩"}</span></div><div className="star-board">{[0, 1, 2].map(index => <div className={`star-lane ${cursor === index ? "selected" : ""}`} key={index}><span className={active && lane === index ? "star visible" : "star"}>✦</span><span className="basket">⌄</span></div>)}</div><p>{message}</p><p className="lcd-help">{active ? "A 左移　B 接住　C 右移" : "B 开始　C 返回"}</p></div>;
}
function KeyButton({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean }) { return <button className={`hardware-key ${primary ? "primary" : ""}`} type="button" onClick={onClick} aria-label={`按键 ${label}`}><span>{label}</span></button>; }

createRoot(document.getElementById("pages-demo-root")!).render(<DemoApp />);
