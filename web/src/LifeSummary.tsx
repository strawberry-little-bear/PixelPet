import { interestSummary } from "./companion";
import { games } from "./games";
import { albumMemories, memoryWords } from "./AlbumPanel";
import type { Memory, PetState } from "./types";
import "./life-summary.css";

const gameMemoryKinds = new Set<Memory["kind"]>([
  "stars", "perfect-stars", "tiles", "snake", "tetris", "fishing", "walk", "treasure",
]);
const walkLength = 72;

function validTimestamp(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
}

function recentMemory(pet: PetState) {
  const memory = albumMemories(pet).filter(entry => validTimestamp(entry.at)).at(-1);
  if (!memory) return null;
  const words = memoryWords(memory, pet.album?.legacy ?? false);
  return words ? { at: memory.at, title: words.title, story: words.story } : null;
}

export function lifeSummary(pet: PetState, now: number) {
  const daysTogether = validTimestamp(pet.createdAt) && validTimestamp(now)
    ? Math.max(1, Math.floor((now - pet.createdAt) / 86400000) + 1)
    : null;
  const memories = pet.album?.entries ?? [];
  const gameMemories = new Set(memories.flatMap(entry => entry.kind === "perfect-stars"
    ? ["stars"]
    : gameMemoryKinds.has(entry.kind) ? [entry.kind] : [])).size;
  const discoveries = (pet.pond?.fish?.length ?? 0) + (pet.park?.finds?.length ?? 0);
  const completedWalks = Number.isSafeInteger(pet.park?.walks) ? Math.max(0, pet.park?.walks ?? 0) : 0;
  const fishCaught = (pet.pond?.fish ?? []).reduce((total, fish) =>
    total + (Number.isSafeInteger(fish.count) ? Math.max(0, fish.count) : 0), 0);
  const gameStats = games.map(game => ({
    id: game.id,
    title: game.title,
    recorded: memories.some(entry => entry.kind === game.id || (game.id === "stars" && entry.kind === "perfect-stars")),
  }));
  const lastMemory = recentMemory(pet);
  const stage = pet.growth?.stage;
  const nextStep = stage === "adult"
    ? lastMemory
      ? `形态已经固定，最近留下的是「${lastMemory.title}」。想继续时，可以回看纪念册、布置小窝，或按心情一起玩喜欢的游戏。`
      : "形态已经固定，可以按心情回看纪念册、布置小窝，或一起玩喜欢的游戏。成年后的日子没有必须完成的目标。"
    : stage === "baby" || stage === "growing"
      ? "按它当下的需要慢慢照顾，等它准备好再看看成长记录；不必为了数字重复操作。"
      : "先从今天的相遇开始，等真正发生的照顾和游戏自然留下回忆。";
  return {
    daysTogether,
    careCount: Number.isFinite(pet.careCount) ? Math.max(0, Math.floor(pet.careCount)) : 0,
    memoryCount: memories.length,
    gameMemories,
    discoveries,
    completedWalks,
    walkSteps: completedWalks * walkLength,
    fishCaught,
    fishSpecies: pet.pond?.fish?.length ?? 0,
    gameStats,
    interest: pet.companion ? interestSummary(pet.companion) : "还没有保存的共同游戏经历，玩喜欢的就好。",
    recentMemory: lastMemory,
    nextStep,
  };
}

export function LifeSummary({ pet, now }: { pet: PetState; now: number }) {
  const summary = lifeSummary(pet, now);
  return <section className="life-summary" aria-label="共同生活回顾">
    <h3>共同生活回顾</h3>
    <div className="life-summary-grid">
      <div><strong>{summary.daysTogether ?? "—"}</strong><span>相识天数</span></div>
      <div><strong>{summary.careCount}</strong><span>温柔照顾</span></div>
      <div><strong>{summary.memoryCount}</strong><span>永久纪念</span></div>
      <div><strong>{summary.gameMemories}</strong><span>游戏记忆</span></div>
      <div><strong>{summary.discoveries}</strong><span>真实发现</span></div>
    </div>
    <p>{summary.interest}</p>
    <section className="life-summary-next" aria-label="一起生活的下一步">
      <strong>一起生活的下一步</strong>
      <p>{summary.nextStep}</p>
      <small>这是陪伴提示，不是任务；按你们的心情来就好。</small>
    </section>
    <section className="life-summary-experiences" aria-label="共同经历统计">
      <strong>共同经历统计</strong>
      <div className="life-summary-experience-grid">
        <div data-stat="walks"><b>{summary.completedWalks}</b><span>完成散步</span></div>
        <div data-stat="walk-steps"><b>{summary.walkSteps}</b><span>累计步数</span></div>
        <div data-stat="fish-caught"><b>{summary.fishCaught}</b><span>实际钓获</span></div>
        <div data-stat="fish-species"><b>{summary.fishSpecies}</b><span>已识鱼种</span></div>
      </div>
      <small>只统计已经保存的经历：散步按每次完整路线 72 步计算；钓获来自鱼图鉴次数。</small>
    </section>
    <section className="life-summary-games" aria-label="各游戏共同经历">
      <strong>各游戏纪念</strong>
      <ul>
        {summary.gameStats.map(game => <li key={game.id} data-game-stat={game.id}>
          <span>{game.title}</span><b>{game.recorded ? "留过" : "尚无"}</b>
        </li>)}
      </ul>
      <small>这里只表示纪念册是否留过这款游戏；重复游玩不重复计数，中途放弃不会留下游戏纪念。</small>
    </section>
    {summary.recentMemory && <section className="life-summary-memory" aria-label="最近保存的回忆">
      <strong>最近保存的回忆</strong>
      <time dateTime={new Date(summary.recentMemory.at).toISOString()}>{new Date(summary.recentMemory.at).toLocaleDateString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
      })}</time>
      <h4>{summary.recentMemory.title}</h4>
      <p>{summary.recentMemory.story}</p>
    </section>}
    <small>只统计已经保存的共同经历，不补写旧历史，也不要求为了数字重复游玩。</small>
  </section>;
}
