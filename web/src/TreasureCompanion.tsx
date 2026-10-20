import { PetArt, petRigKind } from "./PetArt";
import { petGrowth } from "./growth";
import type { PetState } from "./types";
import { treasureItems } from "./treasure";
import type { TreasureReaction } from "./treasure-reaction";

const methods = [
  "用小爪拨开落叶", "低头用喙拨开落叶", "用小爪轻轻翻找", "在林边浅水里摆鳍拨开水草", "歪歪菌盖，用小手翻找",
  "用熊爪轻轻拨叶", "伸出前蹼拨开落叶", "探出猫爪轻轻翻找", "收好翅膀，用爪翻找", "低头嗅嗅，再用前爪拨叶",
];
export function TreasureCompanion({ pet, paused, done, reaction }: {
  pet: PetState; paused: boolean; done: boolean; reaction?: TreasureReaction | null;
}) {
  const stage = petGrowth(pet, pet.lastTick).stage, rig = petRigKind(pet.species, stage);
  const live = reaction && reaction.gameId === pet.game?.id && reaction.step === pet.game?.treasure?.step && !paused ? reaction : null;
  const method = methods[pet.species] ?? "一起看看林间";
  const activity = live ? live.item > 0 ? "found" : "empty" : "quiet";
  return <div className="treasure-companion" data-rig={rig} data-reaction={activity} data-paused={paused}>
    <div className="treasure-actor" key={live?.serial ?? "quiet"} aria-hidden="true">
      <svg className="treasure-ground" viewBox="0 0 96 88" shapeRendering="crispEdges">
        <path d="M4 66h88v17H4z" fill={rig === "dolphin" ? "#9ebfb5" : "#b4c59a"}/>
        <path d={rig === "dolphin" ? "M6 73h21m8 6h22m10-7h23" : "M9 69h10v-5h7v10H13zm53 3h13v-6h9v13H62z"} fill="none" stroke="#6b845c" strokeWidth="2"/>
      </svg>
      <PetArt index={pet.species} stage={stage} expression={activity === "found" ? "content" : "awake"} motion="treasure" accessory={pet.economy?.equipped.accessory}/>
      {live && live.item > 0 && <svg className="treasure-object" viewBox="0 0 32 32" shapeRendering="crispEdges" data-item={live.item}>
        <path d={live.item === 1 ? "M13 3h6v4h5v6h3v10h-6v5H11v-5H5V13h3V7h5z" : live.item === 2 ? "M7 27l3-15L23 3h6v8L17 24l-7 1z" : "M4 22V12h5V7h16v5h4v13l-6 3H10z"} fill={live.item === 1 ? "#a18a64" : live.item === 2 ? "#e8dfba" : "#a1b8ab"} stroke="#536449" strokeWidth="2"/>
        <path d={live.item === 1 ? "M10 13h12m-13 6h14" : live.item === 2 ? "M9 26L24 8" : "M12 13h9"} fill="none" stroke="#536449" strokeWidth="2"/>
      </svg>}
    </div>
    <p className="treasure-companion-note" role="status">{live ? `${method}，${live.item > 0 ? `找到${treasureItems[live.item]}了！` : "这里是空地，把线索记下来。"}` : done ? "不必找齐，每次陪伴都值得收好。" : paused ? "等你准备好，再一起慢慢找。" : `${method}，陪你慢慢找。`}</p>
  </div>;
}
