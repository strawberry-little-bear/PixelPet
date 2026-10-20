import { CareReadingRegion } from "./CareReadingRegion";
import { outingScenery } from "./outing";
import { OutingCaption, OutingEncounterNote, OutingSky } from "./OutingScenery";
import { PetArt } from "./PetArt";
import { petGrowth } from "./growth";
import { fishCatalog, fishCatalogFor, fishInfo, fishingCompanions, fishingMenu, fishingSpots, fishingWaitNotes } from "./fishing";
import type { Fishing, PetState } from "./types";
import "./fishing-game.css";

export function FishArt({ id, hidden = false }: { id: string; hidden?: boolean; }) {
  const fish = fishInfo(id) ?? fishCatalog[0];
  const long = fish.shape === "long", slim = fish.shape === "slim";
  return <svg className={`fish-art fish-${fish.shape}`} viewBox="0 0 56 36" aria-hidden="true" shapeRendering="crispEdges">
    <g fill={hidden ? "#7c8c66" : fish.color} stroke="#4b5e42" strokeWidth="1.5">
      <path d={long ? "M9 15h32v3h5v6H11v-3H7v-3h2z" : slim ? "M12 12h25v3h8v9h-8v3H12z" : "M16 7h17v4h8v6h5v6h-5v6h-8v3H16v-5h-6V13h6z"} />
      <path d="M11 16L2 9v20l9-7z" />
      {!hidden && <><path d={fish.shape === "petal" ? "M22 8V2h5v3h5v6M22 27v7h7v-5" : "M18 11V5h10v6M19 27v5h8v-5"} /><path d="M20 17h8v6h-8z" fill="#e0d9ac" stroke="none" />{fish.shape === "striped" && <path d="M18 10v17m9-17v17m8-14v12" fill="none" stroke="#4e5d76" strokeWidth="3" />}{fish.shape === "rain" && <path d="M18 13l-2 4h4zm9 7l-2 4h4zm5-9l-2 4h4z" fill="#d7ecdf" stroke="none" />}{fish.shape === "spotted" && <path d="M17 12h3v3h-3zm10 10h3v3h-3zm5-9h3v3h-3z" fill="#594f38" stroke="none" />}<path d="M38 16h3v3h-3z" fill="#2f3e2b" stroke="none" /></>}
    </g>{hidden && <text x="28" y="25" textAnchor="middle" fontSize="16" fill="#e4e9c9">?</text>}
  </svg>;
}

// The ordered server catch list is distinct from cast numbers and the lifetime
// album. Do not infer catches from candidate, lastFish or previous discoveries.
export function FishingCatches({ fishing }: { fishing: Fishing }) {
  const catches = fishing.catches ?? [];
  return <CareReadingRegion className="fishing-catches" label="本次钓到的小鱼"
    hint="Tab 聚焦：↑/↓ 或空格滚动；Enter 不操作，A/B/C 不变。">
    <h3>本次钓到的小鱼 · {catches.length} 条</h3>
    {catches.length === 0 ? <p>这次还没有钓到小鱼。慢慢等，不用每一竿都有收获。</p> : <ol>
      {catches.map((id, index) => {
        const fish = fishInfo(id);
        return <li key={index}>
          <span>第 {index + 1} 条</span>
          <strong>{fish?.name ?? "小鱼详情尚未读到"}</strong>
          {fish && <><div className="fishing-catches-art"><FishArt id={id} /></div><p>{fish.story}</p></>}
        </li>;
      })}
    </ol>}
    <p className="fishing-catches-note">{catches.length ? "钓到时已记入累计鱼图鉴，放弃也保留；" : "实际钓到才记入累计鱼图鉴；"}陪伴与金币仍需完成三竿并收好，按原条件结算。</p>
    <small>按钓到的先后排列，不是竿次；本局结束后不保留这份清单，可去鱼图鉴回看累计发现。</small>
  </CareReadingRegion>;
}

// Fixed scenery, deliberately independent of candidate, wait length and catch
// history. These silhouettes never approach the float or predict a bite.
function WaterShadows() {
  const shape = "M6 0h10v2h4v4h-4v2H6V6H2V2h4zM2 2l-5-3v10l5-3z";
  return <g className="fishing-shadows" aria-hidden="true">
    <g transform="translate(105 92)"><path className="fishing-shadow shadow-near" d={shape} /></g>
    <g transform="translate(215 86) scale(-.8 .8)"><path className="fishing-shadow shadow-far" d={shape} /></g>
  </g>;
}

export function FishingGame({ pet, active, choice }: { pet: PetState; active: boolean; choice: number; }) {
  const n = pet.game?.fishing;
  if (!n) return null;
  // Go nil/missing slices are valid zero-catch sessions; supplied bad data is
  // rejected by the response guard, not silently replaced here.
  const caughtCount = n.catches?.length ?? 0;
  const timed = n.phase === "wait" || n.phase === "bite";
  const paused = n.phase !== "done" && (n.paused || (timed && !active));
  const scenery = outingScenery(pet.game);
  const companion = fishingCompanions[pet.species] ?? fishingCompanions[0];
  const caught = n.outcome === "caught", bite = n.phase === "bite" && !paused;
  const state = paused ? "paused" : bite ? "bite" : caught ? "caught" : n.phase === "wait" ? "waiting" : "ready";
  const waiting = n.phase === "wait" && !paused;
  const notes = [companion.waiting, ...fishingWaitNotes];
  const waitingNote = notes[Math.floor(n.elapsedMs / 8000) % notes.length];
  const fish = fishInfo(n.lastFish);
  return <section className="fishing-game" aria-label="池塘钓鱼">
    <header><strong>池塘钓鱼 · {fishingSpots[n.spot]}</strong><span>第 {n.casts} / 3 竿 · {caughtCount} 鱼</span></header>
    <div className="pond-scene" data-motion={state} data-rig={companion.rig} data-method={companion.method}>
      <svg className="pond-background" viewBox="0 0 240 102" preserveAspectRatio="none" aria-hidden="true" shapeRendering="crispEdges">
        <path d="M0 62h240v40H0z" fill="#88ac94" /><path d="M0 0h240v62H0z" fill={scenery?.light.sky ?? "#c6d5ac"} />
        <OutingSky scenery={scenery} />
        <path d="M0 55h75v11h-5v16H0z" fill={scenery?.season.foliage ?? "#839669"} /><path d="M0 51h73v8H0z" fill={scenery?.season.bank ?? "#a8b784"} />
        {n.spot === 0 ? <g stroke="#657c4d" strokeWidth="2"><path d="M214 64V23m8 41V35m9 29V19m-25 45V38" /><path d="M211 19h6v13h-6zm17-5h6v14h-6z" fill="#9c8758" stroke="none" /></g> : n.spot === 1 ? <g fill="#678a5d"><path d="M188 73h27v8h-27zm-37 17h31v7h-31z" /><path d="M198 69h10v6h-10z" fill="#b48c88" /></g> : <g fill="#a5ad8e"><path d="M201 53h18v7h5v10h-29V60h6zm-21 25h10v9h-15v-5h5z" /></g>}
        {n.phase === "wait" && <WaterShadows />}
        <path d="M88 89h19m14-18h13m60 23h19m-68-11h9" stroke="#c5ddbd" strokeWidth="2" />
        {companion.rig === "dolphin" && <path d="M3 72h60v16H3z" fill="#88ac94" />}
        {companion.method === "rest" && <path d="M64 77l5-17 5 17m-5-17v23" fill="none" stroke="#647653" strokeWidth="2" />}
        <g className="fishing-rod"><path d={companion.method === "rest" ? "M69 66L111 21" : "M53 65L111 21"} stroke="#7d6845" strokeWidth="3" /><path d="M111 21l57 10v40" fill="none" stroke="#4f674d" strokeWidth="1" /></g>
        {timed && <g className="fishing-ripples" transform="translate(168 82)" fill="none" stroke="#d9e5c2" strokeWidth="1">
          <path className="fishing-ripple ripple-near" d="M-10-3h20v1h4v4h-4v1h-20v-1h-4v-4h4z" />
          <path className="fishing-ripple ripple-far" d="M-17-6h34v2h5v8h-5v2h-34V4h-5v-8h5z" />
        </g>}
        {timed && <g className="fishing-bobber"><path d="M163 69h10v6h-10z" fill="#b27c68" /><path d="M163 75h10v4h-10z" fill="#eee4bf" /><path d="M157 83h22" stroke="#c8ddbd" strokeWidth="2" /></g>}
      </svg>
      <div className="fishing-companion" aria-label={companion.waiting}><PetArt index={pet.species} stage={petGrowth(pet, pet.lastTick).stage} expression={caught ? "content" : "awake"} motion="fishing" accessory={pet.economy?.equipped.accessory} /></div>
      {!paused && n.phase !== "done" && <OutingCaption scenery={scenery} compact />}
      {caught && <div className="fishing-catch"><FishArt id={n.lastFish!} /></div>}
      {bite && <strong className="fishing-bite" role="status">咬钩啦！按 B 提竿</strong>}
      {paused && <div className="fishing-pause" role="status"><strong>池塘已暂停</strong><ol>{fishingMenu.map((label, i) => <li key={label} className={choice === i ? "selected" : ""}>{choice === i ? "▸ " : "　"}{label}</li>)}</ol><small>A 选择 · B 确认 · C 继续</small></div>}
    </div>
    <p className="fishing-status">{n.phase === "done" ? `三竿完成 · 发现 ${caughtCount} 条鱼，B / C 收好${n.outcome === "early" ? "；提前提竿，这一竿已用掉。" : ""}` : paused ? "等你回来，鱼漂和机会都留在原处。" : bite ? `咬钩提示还剩 ${Math.max(1, Math.ceil((10000 - n.elapsedMs) / 1000))} 秒 · B 提竿` : n.phase === "wait" ? "还没咬钩；鱼影只是风景，等「咬钩啦」再按 B。" : caught ? `${fish?.name}！${pet.pond?.fish?.find(d => d.id === n.lastFish)?.count === 1 ? "初次发现，已记入图鉴。" : "又见到它啦，图鉴次数已更新。"}` : n.outcome === "early" ? "提前提竿，这一竿已用掉。下一竿等咬钩提示再提。" : n.outcome === "missed" ? "小鱼游走了，慢慢来，不用每次都钓到。" : "选一个喜欢的地方，和它一起听水声。"}</p>
    <small className={`fishing-comment${waiting ? " fishing-wait-note" : ""}`}>{paused ? "没有离线钓鱼，也不补跑漏掉的节拍。" : bite ? companion.bite : caught ? fish?.story : waiting ? waitingNote : companion.waiting}</small>
    <small className="fishing-rule">{n.phase === "done" ? caughtCount ? "完成可计陪伴 · 3–6 币（共用今日额度）" : "至少钓到一条并完成三竿才计陪伴 / 金币" : "A 换钓点（收竿后）· B 抛竿 / 提竿 · C 暂停"}</small>
    {(paused || n.phase === "done") && <><FishingCatches fishing={n} /><OutingEncounterNote pet={pet} /><OutingCaption scenery={scenery} /></>}
  </section>;
}

export function FishAlbum({ pet, page }: { pet: PetState; page: number; }) {
  const catalog = fishCatalogFor(pet), selected = page % catalog.length;
  const fish = catalog[selected];
  const discovery = pet.pond?.fish?.find(d => d.id === fish.id);
  return <section className="fish-album" aria-label="池塘鱼图鉴">
    <header data-collection-reading-start><strong>池塘鱼图鉴</strong><span>已发现 {pet.pond?.fish?.filter(d => catalog.some(f => f.id === d.id)).length ?? 0} / {catalog.length}</span></header>
    <div className="fish-album-grid" style={{ gridTemplateColumns: `repeat(${catalog.length}, minmax(0, 1fr))` }}>{catalog.map((f, i) => <div key={f.id} aria-current={i === selected} className={i === selected ? "selected" : ""}><FishArt id={f.id} hidden={!pet.pond?.fish?.some(d => d.id === f.id)} /></div>)}</div>
    <h3>{discovery ? fish.name : "还未遇见的小鱼"}</h3>
    <p>{discovery ? fish.story : "真实钓到以后，才会留下模样和发现日期。"}</p>
    <small>{fish.id === "rain-koi" ? "仅游戏内虚构雨景，三处钓点均可遇见 · 每竿 1/8，不是必出。" : <>可在{fish.spots.map(s => fishingSpots[s]).join(" / ")}遇见 · {pet.schema >= 15 ? "晴 / 云景三种等概率；虚构雨景时每种 7/24。" : "各钓点三种鱼等概率"}</>}</small>
    <p className="fish-record">{discovery ? `初次：${new Date(discovery.firstAt).toLocaleDateString("zh-CN")} · 共遇见 ${discovery.count} 次` : "没有鱼饵付费，也不用按时打卡。"}</p>
    {fish.id === "rain-koi" && <small>不看现实天气，不用按时上线；鱼种不影响金币。</small>}
    <small>A / B 翻页 · C 返回{pet.game?.kind === "fishing" ? "暂停菜单" : "小窝"}</small>
  </section>;
}
