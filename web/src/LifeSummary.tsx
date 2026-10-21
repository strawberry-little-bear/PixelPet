import { interestSummary } from "./companion";
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
  const gameMemories = memories.filter(entry => gameMemoryKinds.has(entry.kind)).length;
  const discoveries = (pet.pond?.fish?.length ?? 0) + (pet.park?.finds?.length ?? 0);
  const completedWalks = Number.isSafeInteger(pet.park?.walks) ? Math.max(0, pet.park?.walks ?? 0) : 0;
  const fishCaught = (pet.pond?.fish ?? []).reduce((total, fish) =>
    total + (Number.isSafeInteger(fish.count) ? Math.max(0, fish.count) : 0), 0);
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
    interest: pet.companion ? interestSummary(pet.companion) : "还没有保存的共同游戏经历，玩喜欢的就好。",
    recentMemory: recentMemory(pet),
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
