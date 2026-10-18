import { CatRig } from "./CatRig";
import { RabbitRig } from "./RabbitRig";
import { Sprite } from "./Sprite";
import type { Expression } from "./Sprite";
import type { GrowthStage } from "./types";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";

// A single registry keeps scenes, handbook previews and future rigs in sync.
export function petRigKind(index: number, stage: GrowthStage): "rabbit" | "cat" | "original" {
  if (stage === "egg") return "original";
  return index === 2 ? "rabbit" : index === 7 ? "cat" : "original";
}
export function petRigClass(index: number, stage: GrowthStage): string {
  const kind = petRigKind(index, stage);
  return kind === "original" ? "" : `has-${kind}-rig`;
}

export function PetArt({ index, stage, expression, motion, need, className }: {
  index:number; stage:GrowthStage; expression?:Expression; motion?:SceneMotion; need?:NeedKind; className?:string;
}) {
  const Rig = { rabbit: RabbitRig, cat: CatRig, original: null }[petRigKind(index, stage)];
  return Rig
    ? <Rig stage={stage} expression={expression} motion={motion} need={need} className={className} />
    : <Sprite index={index} expression={expression} className={className} />;
}
