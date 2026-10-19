import { outingScenery } from "./outing";
import { OutingCaption, OutingEncounterNote, OutingSky } from "./OutingScenery";
import { PetArt, petRigKind } from "./PetArt";
import { petGrowth } from "./growth";
import { parkCatalog, walkMenu, walkingCompanions } from "./walk";
import type { PetState } from "./types";
import "./walking-game.css";

export function ParkArt({id, hidden=false}:{id:string;hidden?:boolean}) {
 const item=parkCatalog.find(p=>p.id===id) ?? parkCatalog[0];
 const paths:Record<string,string>={leaf:"M27 31L4 13l9-7 7 5 7-8 7 8 8-5 10 8-23 17v5h-3z",pinecone:"M24 3h9v5h7v7h5v16h-6v5H17v-5h-6V15h6V8h7z",feather:"M13 34l5-19L37 3h9v9L31 28l-13 3-3 6z",flower:"M23 14V5h10v9h12v10H33v11H23V24H11V14z",shell:"M7 29V16h6V9h9V5h13v4h8v7h6v13l-15 6H22z",pebble:"M8 26V16h6V9h24v6h8v15l-8 5H17z"};
 return <svg className="park-art" viewBox="0 0 56 40" aria-hidden="true" shapeRendering="crispEdges"><path d={paths[item.id]} fill={hidden?"#81916e":item.color} stroke="#526247" strokeWidth="2"/>{hidden?<text x="28" y="28" textAnchor="middle" fill="#e4e9c9" fontSize="20">?</text>:<path d={item.id==="leaf"?"M28 28V15m-1 10L15 16m14 10l12-10":item.id==="pinecone"?"M18 14h18m-19 9h21m-15 7h8":item.id==="shell"?"M28 31V12m-4 18l-8-13m16 13l8-13":item.id==="feather"?"M18 30L39 10":"M23 19h9v5h-9z"} fill="none" stroke="#66764f" strokeWidth="2"/>}</svg>;
}
export function WalkingGame({pet,active,choice}:{pet:PetState;active:boolean;choice:number}) {
 const n=pet.game?.walking;if(!n)return null;
 const scenery=outingScenery(pet.game);
 const done=n.beat===72, paused=!done&&(n.paused||!active);
 const stage=petGrowth(pet,pet.lastTick).stage,rig=petRigKind(pet.species,stage),dolphin=rig==="dolphin";
 const next=n.route[Math.min(11,Math.floor(n.beat/6))];const remaining=6-n.beat%6;
 const pose=paused?"paused":done?"done":n.pose||"moving";
 const found=n.beat>=24 && n.beat%24<4 ? parkCatalog.find(p=>p.id===n.souvenirs[Math.floor(n.beat/24)-1]):undefined;
 const hit=n.beat>0&&n.beat%6===0&&!done;
 return <section className="walking-game" aria-label="公园散步">
  <header><strong>公园散步 · {dolphin?"浅水道":"林荫路"}</strong><span>{n.beat} / 72 步</span></header>
  <div className="park-scene" data-rig={rig} data-pose={pose}>
   <svg className="park-background" viewBox="0 0 240 102" preserveAspectRatio="none" aria-hidden="true" shapeRendering="crispEdges"><path d="M0 0h240v102H0z" fill={scenery?.light.sky??"#c7d7ad"}/><OutingSky scenery={scenery}/><path d="M0 63h240v39H0z" fill={scenery?.season.bank??"#a8b689"}/><path d="M0 82h240v16H0z" fill="#c5ba96"/><path d="M0 70h240v12H0z" fill="#88ac94"/><g fill={scenery?.season.foliage??"#748e60"}><path d="M13 9h25v29H13zM3 23h45v21H3zM158 7h29v32h-29zM147 22h51v24h-51z"/></g><path d="M24 44v24m148-22v22" stroke="#8e825e" strokeWidth="6"/><path d="M6 76h22m62 0h17m35 0h15m40 0h28" stroke="#c5ddbd" strokeWidth="2"/></svg>
   <div className="walking-actor"><PetArt index={pet.species} stage={stage} expression="content" motion="walking" accessory={pet.economy?.equipped.accessory}/></div>
   {!done&&<div className={`park-obstacle obstacle-${next}`} style={{left:`${30+remaining*10}%`}} aria-hidden="true">{next==="rock"?<svg viewBox="0 0 30 24"><path d="M2 23V12h6V5h15v7h5v11z" fill="#879581" stroke="#5b6c50"/></svg>:<svg viewBox="0 0 30 24"><path d="M0 8h30v6H0zM17 8V1h5v7" fill="#8e805a"/><path d="M5 5h9v5H5z" fill="#77935e"/></svg>}</div>}
   {!paused&&!done&&<OutingCaption scenery={scenery} compact/>}
   {paused&&<div className="walk-pause"><strong>慢慢走，不必赶路</strong><div>{walkMenu.map((v,i)=><span key={v} data-selected={choice===i}>{choice===i?"▸":"　"} {v}</span>)}</div><small>A 选择 · B 确认 · C 继续</small></div>}
  </div>
  <p className="walk-warning" aria-live="polite">{done?`到终点啦！避开 ${n.cleared} / 12 处，B / C 收好。`:paused?"刷新或离开后手动继续，不会离线赶路。":`${next==="rock"?dolphin?"前方浅石 · A 跃水":"前方石头 · A 跳跃":dolphin?"前方低枝 · B 下潜":"前方树枝 · B 蹲下"} · 还有 ${remaining} 步`}</p>
  <p className="walk-find">{found?`发现了${found.name}！已留在沿途发现。`:hit?"这一处走过啦，绊到也能继续，不扣状态。":`每 24 步一次发现 · 已走过 ${Math.floor(n.beat/24)} / 3 处`}</p>
  <small className="walk-method">{walkingCompanions[pet.species]}</small>
  <small>走完并收好计陪伴，3–6 币共用每日额度。</small>
  {(paused||done)&&<><OutingEncounterNote pet={pet}/><OutingCaption scenery={scenery}/></>}
 </section>;
}
export function ParkAlbum({pet,page}:{pet:PetState;page:number}) {
 const item=parkCatalog[page%parkCatalog.length],d=pet.park?.finds.find(d=>d.id===item.id);
 return <section className="park-album" aria-label="公园沿途发现"><header><strong>沿途发现</strong><span>{pet.park?.finds.length??0} / 6 种 · {page+1} / 6</span></header><div className="park-discovery"><ParkArt id={item.id} hidden={!d}/></div><h3>{d?item.name:"还未遇见"}</h3><p>{d?item.story:"以后一起散步，看看会遇见什么。"}</p><small>{d?`遇见 ${d.count} 次 · 首次 ${new Date(d.firstAt).toLocaleDateString("zh-CN")}`:"只记录实际到达的发现，不补写过去。"}</small><p>走过 24 / 48 / 72 步才会发现。<br/>放弃仍保留发现，未走完不计陪伴。</p><small>A / B 翻页 · C 返回（不自动继续）</small></section>;
}
