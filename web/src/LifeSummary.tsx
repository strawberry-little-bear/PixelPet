import { companionCompletionTotal, interestLimit, interestSummary, validInterestEntries } from "./companion";
import { games } from "./games";
import { completionLabel, savedGameHistory } from "./game-history";
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

// Saved timestamps are whole milliseconds, but "now" comes from the server
// clock anchor plus a fractional performance.now() delta. It is a real instant
// that is almost never an integer, so it must not go through validTimestamp or
// every day count silently falls back to the placeholder.
function validMoment(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 8.64e15;
}

function currentComfort(pet: PetState): number | null {
  const needs = pet.needs;
  const values = [needs?.hunger, needs?.mood, needs?.clean, needs?.energy];
  if (!values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatComfort(value: number | null) {
  if (value === null) return "当前状态暂未读到";
  const percent = value;
  return percent > 0 && Number(percent.toFixed(1)) === 0
    ? "<0.1%"
    : `${percent.toFixed(1)}%`;
}

function recentMemory(pet: PetState) {
  const memory = albumMemories(pet).filter(entry => validTimestamp(entry.at)).at(-1);
  if (!memory) return null;
  const words = memoryWords(memory, pet.album?.legacy ?? false);
  return words ? { at: memory.at, title: words.title, story: words.story } : null;
}

export function lifeSummary(pet: PetState, now: number) {
  // Meeting starts at hatching, as on the home/status pages and album milestones.
  // An egg can wait several days after creation before the pet meets its player.
  const daysTogether = validTimestamp(pet.hatchedAt) && validMoment(now)
    ? Math.max(1, Math.floor((now - pet.hatchedAt) / 86400000) + 1)
    : null;
  const memories = pet.album?.entries ?? [];
  const gameMemories = new Set(memories.flatMap(entry => entry.kind === "perfect-stars"
    ? ["stars"]
    : gameMemoryKinds.has(entry.kind) ? [entry.kind] : [])).size;
  const discoveries = (pet.pond?.fish?.length ?? 0) + (pet.park?.finds?.length ?? 0);
  const completedWalks = Number.isSafeInteger(pet.park?.walks) ? Math.max(0, pet.park?.walks ?? 0) : 0;
  const fishCaught = (pet.pond?.fish ?? []).reduce((total, fish) =>
    total + (Number.isSafeInteger(fish.count) ? Math.max(0, fish.count) : 0), 0);
  const lastMemory = recentMemory(pet);
  const comfort = currentComfort(pet);
  const interests = validInterestEntries(pet.companion);
  const history = savedGameHistory(pet);
  // Keep this long-term cue behind the same complete-history gate as the
  // per-game counts. Legacy or partial saves must stay unknown.
  const completionTotal = history ? companionCompletionTotal(pet.companion) : null;
  const sharedGameThread = completionTotal !== null && completionTotal !== "0"
    ? `已经一起收好 ${completionTotal} 局共同游戏`
    : null;
  const gameStats = games.map(game => ({
    id: game.id,
    title: game.title,
    completions: history?.completions.find(entry => entry.kind === game.id)?.count ?? null,
    recorded: memories.some(entry => entry.kind === game.id || (game.id === "stars" && entry.kind === "perfect-stars")),
    familiarity: interests.find(entry => entry.kind === game.id)?.points ?? 0,
  }));
  const bestInterest = Math.max(0, ...interests.map(entry => entry.points));
  const interestLeaders = bestInterest >= 2
    ? interests.filter(entry => entry.points === bestInterest)
      .map(entry => games.find(game => game.id === entry.kind)?.title)
      .filter(title => title !== undefined)
    : [];
  // Familiarity is a capped lifetime record; it cannot say what was played
  // recently. Only the saved completion supplies that part of the suggestion.
  const recent = pet.companion?.recent;
  const recentGame = recent && validTimestamp(recent.at) && validTimestamp(pet.companion?.since) &&
    recent.at >= Math.max(pet.companion!.since, pet.hatchedAt) && recent.at <= pet.lastTick
      ? games.find(game => game.id === recent.kind) : undefined;
  const adultThread = [
    recentGame ? `最近一次一起玩过的是「${recentGame.title}」`
      : lastMemory ? `最近留下的是「${lastMemory.title}」` : null,
    interestLeaders.length > 0 ? `目前更熟悉的是「${interestLeaders.join("」和「")}」` : null,
  ].filter(Boolean).join("；");
  const stage = pet.growth?.stage;
  const explorationProgress = [
    completedWalks > 0 ? `已经一起走过 ${completedWalks * walkLength} 步` : null,
    fishCaught > 0 ? `钓到过 ${fishCaught} 条鱼` : null,
    discoveries > 0 ? `遇见 ${discoveries} 种真实发现` : null,
  ].filter((text): text is string => text !== null);
  const explorationText = explorationProgress.length > 0
    ? `${explorationProgress.join("，")}；想散步或在池塘边等一会儿时，再把新的风景留给你们。`
    : "想探索时，可以去池塘边等一会儿，或一起走走；遇见什么都算一次小发现。";
  const adultDirections = stage === "adult" ? [
    {
      id: "review",
      label: "回看",
      text: lastMemory
        ? `可以再翻看「${lastMemory.title}」，让这段回忆留在想起它的时候。`
        : memories.length > 0
          ? `纪念册里已经有 ${memories.length} 段回忆，什么时候想起时再翻看就好。`
          : "等真正想留下的时刻，再把它放进纪念册。",
    },
    {
      id: "explore",
      label: "探索",
      text: explorationText,
    },
    {
      id: "together",
      label: "一起玩",
      text: recentGame
        ? `最近一起玩的是「${recentGame.title}」${sharedGameThread ? `；${sharedGameThread}` : ""}，想玩时可以从熟悉的节奏开始。`
        : interestLeaders.length > 0
          ? `熟悉的是「${interestLeaders.join("」和「")}」${sharedGameThread ? `；${sharedGameThread}` : ""}，按今天的心情再选它也可以。`
          : sharedGameThread
            ? `${sharedGameThread}，今天想玩时按心情选一个就好。`
            : "今天想玩的时候，按心情从喜欢的游戏里选一个就好。",
    },
  ] as const : null;
  const nextStep = stage === "adult"
    ? `形态已经固定${adultThread ? `，${adultThread}` : ""}。成年后的日子没有必须完成的目标。`
    : stage === "baby" || stage === "growing"
      ? "按它当下的需要慢慢照顾，等它准备好再看看成长记录；不必为了数字重复操作。"
      : "先从今天的相遇开始，等真正发生的照顾和游戏自然留下回忆。";
  return {
    daysTogether,
    careCount: Number.isFinite(pet.careCount) ? Math.max(0, Math.floor(pet.careCount)) : 0,
    memoryCount: memories.length,
    gameMemories,
    discoveries,
    currentComfort: comfort,
    completedWalks,
    walkSteps: completedWalks * walkLength,
    fishCaught,
    fishSpecies: pet.pond?.fish?.length ?? 0,
    gameStats,
    gameHistorySince: history?.since ?? null,
    interest: pet.companion ? interestSummary(pet.companion) : "还没有保存的共同游戏经历，玩喜欢的就好。",
    interestProgress: interestLeaders.length > 0
      ? { titles: interestLeaders, points: bestInterest }
      : null,
    recentMemory: lastMemory,
    adultDirections,
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
    <section className="life-summary-comfort" aria-label="此刻小窝舒适度">
      <strong>此刻小窝舒适度</strong>
      <b data-current-comfort>{formatComfort(summary.currentComfort)}</b>
      <p>只读取当前四项状态的平均值，用来回看此刻；不是任务、成长点或奖励目标。</p>
    </section>
    <p>{summary.interest}</p>
    {summary.interestProgress && <section className="life-summary-interest" aria-label="共同游戏兴趣进度">
      <strong>共同游戏兴趣</strong>
      <p>{summary.interestProgress.titles.length === 1
        ? `${summary.interestProgress.titles[0]} · 熟悉度 ${summary.interestProgress.points} / ${interestLimit}`
        : `熟悉的游戏不止一种 · 最高熟悉度 ${summary.interestProgress.points} / ${interestLimit}`}</p>
      <small>这是共同经历的只读记录，不是任务，也不会改变成年形态。</small>
    </section>}
    <section className="life-summary-next" aria-label={summary.adultDirections ? "可以继续的方向" : "一起生活的下一步"}>
      <strong>{summary.adultDirections ? "可以继续的方向" : "一起生活的下一步"}</strong>
      <p>{summary.nextStep}</p>
      {summary.adultDirections && <ul className="life-summary-directions" data-adult-directions>
        {summary.adultDirections.map(direction => <li key={direction.id}>
          <b>{direction.label}</b><span>{direction.text}</span>
        </li>)}
      </ul>}
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
      <strong>各游戏共同经历</strong>
      {summary.gameHistorySince !== null
        ? <small className="life-summary-tracking">共同游戏局数自 <time dateTime={new Date(summary.gameHistorySince).toISOString()}>{new Date(summary.gameHistorySince).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time>（本地时间）起记录；之前的局数未知，不补算。</small>
        : <small className="life-summary-tracking">这份存档尚未记录共同游戏局数；纪念和熟悉度不能推算过去玩过多少局。</small>}
      <ul>
        {summary.gameStats.map(game => <li key={game.id} data-game-stat={game.id}>
          <span>{game.title}</span><b>{game.recorded ? "留过" : "尚无"}</b>
          <small data-completion-count={game.id}>{game.completions === null ? "局数未记录" : `共同游戏 ${completionLabel(game.completions)}`}</small>
          {game.familiarity > 0 && <small>熟悉度 {game.familiarity} / {interestLimit}</small>}
        </li>)}
      </ul>
      <small>纪念每种只留一次；共同游戏局数记录每次达到陪伴条件并收好的游戏，短局和放弃不计。熟悉度间隔内、已满或金币额度用完，仍会记录符合条件的一局；不额外增加成长或奖励。</small>
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
