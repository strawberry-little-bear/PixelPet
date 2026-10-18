import { RabbitRig } from "./RabbitRig";
import { Sprite } from "./Sprite";
import type { Expression } from "./Sprite";
import type { GrowthStage } from "./types";
import type { SceneMotion } from "./motion";
import type { NeedKind } from "./needs";

export function PetArt({ index, stage, expression, motion, need, className }: {
  index:number; stage:GrowthStage; expression?:Expression; motion?:SceneMotion; need?:NeedKind; className?:string;
}) {
  return index === 2 && stage !== "egg"
    ? <RabbitRig stage={stage} expression={expression} motion={motion} need={need} className={className} />
    : <Sprite index={index} expression={expression} className={className} />;
}
